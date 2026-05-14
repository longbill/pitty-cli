const { chat } = require('./api.js');
const { parseUsage } = require('./usage.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const { check: checkPerm, CONFIRM_TOOLS } = require('./permission.js');
const config = require('./config.js');
const { t, _ } = require('./lang/index.js');
const { createRenderer, gray, formatNum } = require('./render.js');
const { createStatusBar } = require('./statusbar.js');
const { auditToolCalls } = require('./audit.js');
const { formatToolConfirmation } = require('./toolConfirm.js');
const logger = require('./logger.js');


// ── Helpers ────────────────────────────────────────────────────────────

let currentAbort = null;
function isAbortError(err) {
  return err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

function formatResult(name, result) {
  let content;
  if (result.error) {
    const extra = { ...result };
    delete extra.error;
    content = _('chat.error') + result.error;
    if (Object.keys(extra).length > 0) {
      content += '\n' + JSON.stringify(extra, null, 2);
    }
  } else {
    content = JSON.stringify(result, null, 2);
    if (content.length > 16000) {
      content = content.slice(0, 16000) + '\n' + _('chat.truncated');
    }
  }
  return content;
}

let estCharsPerToken = 10.0;

function updateEstRatio(chars, tokens) {
  if (tokens > 20 && chars > 0) estCharsPerToken = Math.max(chars / tokens, 1.0);
}

function estimateTokens(chars) {
  return Math.round(chars / estCharsPerToken);
}

function abortRun(sb, messages, hasOutput) {
  currentAbort = null;
  sb.barFinalize('');
  messages.pop();
  const repaired = repairMessages(messages);
  messages.length = 0;
  messages.push(...repaired);
  return { messages, aborted: true, hasOutput };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Message repair ─────────────────────────────────────────────────────

function repairMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;

  let cutoff = msgs.length;
  let foundIncomplete = false;

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const expectedIds = m.tool_calls.map(tc => tc.id);
      const following = msgs.slice(i + 1, i + 1 + expectedIds.length);
      const followingIds = following.map(toolMsg => toolMsg.tool_call_id);
      const hasCompleteConsecutiveTools = following.length === expectedIds.length &&
        following.every(toolMsg => toolMsg.role === 'tool') &&
        expectedIds.every(id => followingIds.includes(id));

      if (!hasCompleteConsecutiveTools) {
        cutoff = i;
        foundIncomplete = true;
        break;
      }

      const next = msgs[i + 1 + expectedIds.length];
      if (next && next.role === 'tool') {
        cutoff = i;
        foundIncomplete = true;
        break;
      }
    }
  }

  if (foundIncomplete) {
    while (cutoff > 0 && msgs[cutoff - 1].role === 'tool') {
      cutoff--;
    }
  }

  return msgs.slice(0, cutoff);
}

// ── Tool approval pipeline ──────────────────────────────────────────

async function resolveToolApprovals(toolCalls, messages, confirm, sb, ac) {
  const mode = config.getPermissionMode();

  // Classify each tool call by execution behavior
  const classified = toolCalls.map(tc => {
    const perm = checkPerm(mode, tc.function.name);
    return { tc, ...perm };
  });

  // ── Audit mode: review all tool calls ──
  let auditResult = null;
  if (mode === 'audit') {
    sb.setBar(_('chat.auditing'));

    for (const item of classified) {
      let args = {};
      try { args = JSON.parse(item.tc.function.arguments); } catch {}
      sb.barWriteLine(gray(t(item.tc.function.name, args)));
    }

    auditResult = await auditToolCalls(
      classified.map(c => c.tc),
      messages
    );

    for (const review of auditResult.reviews) {
      if (review.safe) {
        sb.barWriteLine(gray(`  ${_('chat.auditSafe')} ${review.name}: ${review.reason}`));
      } else {
        sb.barWriteLine(gray(`  ${_('chat.auditRisky')} ${review.name}: ${review.reason}`));
      }
    }
  }

  const denied = [];
  const approved = [];

  for (const item of classified.filter(c => !c.allowed)) {
    denied.push({
      id: item.tc.id,
      name: item.tc.function.name,
      result: { error: item.reason || _('chat.denied') },
    });
  }

  for (const item of classified.filter(c => c.allowed && !c.needConfirm && !c.needAudit)) {
    approved.push(item.tc);
  }

  const confirmItems = classified.filter(c => c.allowed && c.needConfirm && !c.autoAccept);
  for (const item of confirmItems) {
    let args = {};
    try { args = JSON.parse(item.tc.function.arguments); } catch {}
    let confirmed = confirm;
    if (typeof confirm === 'function') {
      sb.pause();
      try {
        confirmed = await confirm(formatToolConfirmation(item.tc.function.name, args), ac.signal);
      } finally {
        sb.resume();
      }
    }
    const ok = typeof confirmed === 'object' ? confirmed.ok : confirmed;
    const userInput = typeof confirmed === 'object' ? confirmed.userInput : '';

    if (ok) {
      approved.push(item.tc);
    } else {
      denied.push({
        id: item.tc.id,
        name: item.tc.function.name,
        result: {
          error: _('chat.denied'),
          ...(userInput ? { userInput } : {}),
        },
      });
    }
  }

  // ── accept-all: countdown for confirm tools ──
  const autoAcceptItems = classified.filter(c => c.autoAccept);
  if (autoAcceptItems.length > 0) {
    const waitSec = config.getAcceptAllWaitSeconds();

    for (let i = waitSec; i > 0; i--) {
      if (ac.signal.aborted) break;
      sb.setBar(_('chat.autoAcceptCountdown', { seconds: i }));
      await sleep(1000);
    }

    if (ac.signal.aborted) {
      for (const item of autoAcceptItems) {
        denied.push({
          id: item.tc.id, name: item.tc.function.name,
          result: { error: _('chat.canceledByUser') },
        });
      }
    } else {
      for (const item of autoAcceptItems) {
        approved.push(item.tc);
      }
    }
  }

  return { approved, results: denied };
}

function displayToolCalls(toolCalls, sb) {
  const skipConfirm = config.getPermissionMode() === 'ask';
  let i = 0;
  while (i < toolCalls.length) {
    // In ask mode, skip tools that will go through confirmation flow
    if (skipConfirm && CONFIRM_TOOLS.includes(toolCalls[i].function.name)) {
      i++;
      continue;
    }

    // Group consecutive Read calls
    if (toolCalls[i].function.name === 'Read') {
      const files = [];
      while (i < toolCalls.length && toolCalls[i].function.name === 'Read') {
        let args = {};
        try { args = JSON.parse(toolCalls[i].function.arguments); } catch {}
        if (args.file_path) files.push(args.file_path);
        i++;
      }
      if (files.length === 1) {
        sb.barWriteLine(gray(t('Read', { file_path: files[0] })));
      } else {
        sb.barWriteLine(gray(t('ReadGroup', files)));
      }
      continue;
    }
    let args = {};
    try { args = JSON.parse(toolCalls[i].function.arguments); } catch {}
    sb.barWriteLine(gray(t(toolCalls[i].function.name, args)));
    i++;
  }
}

function buildUsageHandler(ctx, tokenState) {
  return (usage) => {
    if (!usage) return;
    const parsed = parseUsage(usage);
    if (parsed.input_tokens === 0 && parsed.output_tokens === 0 && parsed.cached_input_tokens === 0) return;
    updateEstRatio(ctx.reasoningChars + ctx.totalOutputChars, parsed.output_tokens);
    ctx.lastUsage = usage;

    if (tokenState) {
      tokenState.realIn += parsed.input_tokens;
      tokenState.realOut += parsed.output_tokens;
      tokenState.dispIn = tokenState.realIn;
      tokenState.dispOut = tokenState.realOut;
      tokenState.lastPromptTotal = parsed.input_tokens + parsed.cached_input_tokens;
      ctx.sb.setTokenInfo(tokenState.dispIn, tokenState.dispOut);
    }
  };
}

function buildReasoningHandler(ctx, tokenState) {
  return (chunk) => {
    if (!chunk) return;
    ctx.reasoningChars += chunk.length;
    ctx.reasoningChunks++;
    // Update display output token estimate during streaming
    if (tokenState) {
      tokenState.dispOut = tokenState.realOut + ctx.contentChunks + ctx.reasoningChunks + ctx.toolChunks;
      ctx.sb.setTokenInfo(tokenState.dispIn, tokenState.dispOut);
    }
  };
}

function buildToolDeltaHandler(ctx, tokenState) {
  return () => {
    ctx.toolChunks++;
    if (tokenState) {
      tokenState.dispOut = tokenState.realOut + ctx.contentChunks + ctx.reasoningChunks + ctx.toolChunks;
      ctx.sb.setTokenInfo(tokenState.dispIn, tokenState.dispOut);
    }
  };
}

function buildContentHandler(ctx, maxContext, tokenState) {
  return (chunk) => {
    if (!chunk) return;
    ctx.totalOutputChars += chunk.length;
    ctx.contentChunks++;
    if (!ctx.contentStarted) {
      ctx.contentStarted = true;
      ctx.hasOutput = true;
      ctx.sb.setBar(_('chat.generating'));
    }

    ctx.lineBuffer += chunk;
    while (true) {
      const nl = ctx.lineBuffer.indexOf('\n');
      if (nl === -1) break;
      const line = ctx.lineBuffer.slice(0, nl);
      ctx.lineBuffer = ctx.lineBuffer.slice(nl + 1);
      const rendered = ctx.renderer.renderLine(line);
      if (rendered) for (const r of rendered) ctx.sb.barWriteLine(r);
    }
    // Update display output token estimate during streaming, using SSE chunk count
    if (tokenState) {
      tokenState.dispOut = tokenState.realOut + ctx.contentChunks + ctx.reasoningChunks + ctx.toolChunks;
      ctx.sb.setTokenInfo(tokenState.dispIn, tokenState.dispOut);
    }
  };
}

// ── Session-level state ────────────────────────────────────────────────

let sessionRealIn = 0;
let sessionRealOut = 0;
let currentContextSize = 0;

function getSessionTotals() {
  return { sessionRealIn, sessionRealOut, currentContextSize };
}

// ── Main entry ──────────────────────────────────────────────────────────

async function run(input, messagesOrOpts = [], opts = {}) {
  let messages = messagesOrOpts;
  if (!Array.isArray(messagesOrOpts)) {
    opts = messagesOrOpts || {};
    messages = opts.messages || [];
  }

  const confirm = opts.confirm === undefined ? true : opts.confirm;
  const maxTurns = opts.maxTurns || config.getMaxTurns();
  const maxContext = config.get('maxContext') || 256000;
  const tools = getApiTools();
  const enableTools = tools.length > 0;
  const providerConfig = config.resolveModel(config.getMainModel());

  let hasOutput = false;
  currentAbort = null;

  const renderer = createRenderer();
  const sb = createStatusBar(_, { enabled: opts.statusBar !== false });

  const repaired = repairMessages(messages);
  messages.length = 0;
  messages.push(...repaired);
  messages.push({ role: 'user', content: input });

  let totalOutputTokens = 0;
  let realIn = 0, realOut = 0, dispIn = 0, dispOut = 0;
  let lastPromptTotal = 0;
  let turnTimeline = Date.now();
  let turnCount = 0;

  const showTiming = () => {
    const now = Date.now();
    const elapsed = now - turnTimeline;
    if (elapsed >= 5000) {
      sb.barWriteLine(gray(sb.formatElapsed(elapsed)));
    }
    turnTimeline = now;
  };

  while (turnCount < maxTurns) {
    turnCount++;

    const ac = new AbortController();
    currentAbort = ac;

    const ctx = {
      renderer,
      sb,
      contentStarted: false,
      lineBuffer: '',
      totalOutputChars: 0,
      reasoningChars: 0,
      contentChunks: 0,
      reasoningChunks: 0,
      toolChunks: 0,
      lastUsage: null,
      totalOutputTokens,
      turnOutputTokens: 0,
      hasOutput,
      showTiming,
    };

    const tokenState = { realIn, realOut, dispIn, dispOut, lastPromptTotal };

    // Estimate input tokens for the last message before sending
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.content) {
      tokenState.dispIn = tokenState.realIn + estimateTokens(lastMsg.content.length);
    }
    sb.setTokenInfo(tokenState.dispIn, tokenState.dispOut);
    sb.setBar(_('chat.thinking'));

    let response;
    try {
      response = await chat(
        messages,
        enableTools ? tools : [],
        buildContentHandler(ctx, maxContext, tokenState),
        buildReasoningHandler(ctx, tokenState),
        buildUsageHandler(ctx, tokenState),
        ac.signal,
        providerConfig,
        buildToolDeltaHandler(ctx, tokenState),
      );
    } catch (err) {
      if (isAbortError(err)) return abortRun(sb, messages, hasOutput);
      sb.barFinalize('');
      throw err;
    }

    // Sync accumulated tokens back to local variables for next turn
    realIn = tokenState.realIn;
    realOut = tokenState.realOut;
    dispIn = tokenState.dispIn;
    dispOut = tokenState.dispOut;
    lastPromptTotal = tokenState.lastPromptTotal || 0;

    if (ctx.lineBuffer) {
      const rendered = renderer.renderLine(ctx.lineBuffer);
      if (rendered) for (const r of rendered) sb.barWriteLine(r);
    }
    if (renderer.hasPending()) {
      for (const r of renderer.flush()) sb.barWriteLine(r);
    }

    hasOutput = ctx.hasOutput;

    if (response.usage) {
      ctx.turnOutputTokens = response.usage.completion_tokens || 0;
      ctx.lastUsage = response.usage;
    } else if ((ctx.reasoningChars + ctx.totalOutputChars) > 0) {
      ctx.turnOutputTokens = estimateTokens(ctx.reasoningChars + ctx.totalOutputChars);
    }
    totalOutputTokens += ctx.turnOutputTokens;

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
    if (hasToolCalls) hasOutput = true;

    if (!hasToolCalls && response.reasoning && !response.content) {
      const lines = response.reasoning.split('\n');
      for (const line of lines) {
        const rendered = renderer.renderLine(line);
        if (rendered === null) continue;
        for (const r of rendered) sb.barWriteLine(r);
      }
      hasOutput = true;
      response.content = response.reasoning;
    }

    const assistantMsg = {
      role: 'assistant',
      content: response.content || null,
      reasoning_content: response.reasoning || null,
    };
    if (hasToolCalls) assistantMsg.tool_calls = response.toolCalls;
    messages.push(assistantMsg);

    if (hasToolCalls && turnCount >= maxTurns) {
      if (typeof confirm === 'function') {
        sb.pause();
        try {
          const confirmed = await confirm('已到达最大轮数，按回车继续，输入其他内容结束: ', ac.signal, '已继续');
          if (!confirmed.ok) {
            for (const tc of response.toolCalls) {
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: formatResult(tc.function.name, {
                  error: _('chat.denied'),
                  ...(confirmed.userInput ? { userInput: confirmed.userInput } : {}),
                }),
              });
            }
            hasOutput = true;
            continue;
          }
          turnCount = 0;
        } finally {
          sb.resume();
        }
      } else {
        break;
      }
    }

    if (!hasToolCalls) {
      // Update session-level totals from this round
      sessionRealIn += tokenState.realIn;
      sessionRealOut += tokenState.realOut;

      // Track current context size from last turn's total prompt tokens (new + cached)
      if (tokenState.lastPromptTotal) {
        if (tokenState.lastPromptTotal > currentContextSize) {
          // Absolute reporting — use directly
          currentContextSize = tokenState.lastPromptTotal;
        } else if (tokenState.lastPromptTotal < currentContextSize) {
          // API reported less than before, likely incremental mode — accumulate
          currentContextSize += tokenState.realIn;
        }
      }

      if (tokenState && (tokenState.realIn > 0 || tokenState.realOut > 0)) {
        sb.barFinalize(
          '~' + sb.getElapsedStr() + ' ' + formatNum(currentContextSize) + '/' + formatNum(maxContext) +
          ' ↑' + formatNum(tokenState.realIn) +
          ' ↓' + formatNum(tokenState.realOut)
        );
      } else {
        sb.barFinalize('');
      }
      break;
    }

    sb.setBar(_('chat.running'));
    showTiming();
    displayToolCalls(response.toolCalls, sb);

    // Permission + audit pipeline
    const { approved, results: preResults } = await resolveToolApprovals(
      response.toolCalls, messages, confirm, sb, ac
    );

    if (ac.signal.aborted) return abortRun(sb, messages, hasOutput);

    for (const { id, name, result } of preResults) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: formatResult(name, result),
      });
    }

    if (approved.length > 0) {
      const results = await Promise.all(
        approved.map(async (tc) => {
          if (tc.function.name === 'Bash') sb.setBar(_('chat.commandRunning'));
          const result = await executeToolCall(tc, ac.signal, messages, typeof confirm === 'function' ? confirm : undefined, sb);
          return { id: tc.id, ...result };
        })
      );

      if (ac.signal.aborted) return abortRun(sb, messages, hasOutput);

      for (const { id, name, result } of results) {
        messages.push({
          role: 'tool',
          tool_call_id: id,
          content: formatResult(name, result),
        });
      }
    }

    currentAbort = null;
  }

  if (turnCount >= maxTurns) {
    sessionRealIn += realIn;
    sessionRealOut += realOut;
    if (lastPromptTotal) {
      if (lastPromptTotal > currentContextSize) {
        currentContextSize = lastPromptTotal;
      } else if (lastPromptTotal < currentContextSize) {
        currentContextSize += realIn;
      }
    }
    sb.barFinalize(_('chat.maxTurns'));
    const repaired = repairMessages(messages);
    messages.length = 0;
    messages.push(...repaired);
  }

  currentAbort = null;
  return { messages, aborted: false, hasOutput };
}

module.exports = { run, get currentAbort() { return currentAbort; }, getSessionTotals, _test: { repairMessages } };
