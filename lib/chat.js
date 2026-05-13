const { chat } = require('./api.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const { check: checkPerm } = require('./permission.js');
const { t, _ } = require('./lang/index.js');
const { createRenderer, gray, formatNum } = require('./render.js');
const { createStatusBar } = require('./statusbar.js');
const { auditToolCalls } = require('./audit.js');
const { formatToolConfirmation } = require('./toolConfirm.js');
const logger = require('./logger.js');
const config = require('./config.js');

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

let estCharsPerToken = 3.0;

function updateEstRatio(chars, tokens) {
  if (tokens > 20) estCharsPerToken = chars / tokens;
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
      sb.setBar(t('chat.autoAcceptCountdown', { seconds: i }));
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
  for (const tc of toolCalls) {
    let args = {};
    try { args = JSON.parse(tc.function.arguments); } catch {}
    sb.barWriteLine(gray(t(tc.function.name, args)));
  }
}

function buildUsageHandler(ctx) {
  return (usage) => {
    if (usage && usage.prompt_tokens && usage.completion_tokens) {
      updateEstRatio(ctx.reasoningChars + ctx.totalOutputChars, usage.completion_tokens);
      ctx.lastUsage = usage;
      ctx.estTokens = estimateTokens(ctx.totalOutputChars + ctx.reasoningChars);
    }
  };
}

function buildReasoningHandler(ctx) {
  return (chunk) => {
    if (!chunk) return;
    ctx.reasoningChars += chunk.length;
  };
}

function buildContentHandler(ctx, maxContext) {
  return (chunk) => {
    if (!chunk) return;
    ctx.totalOutputChars += chunk.length;
    ctx.estTokens = estimateTokens(ctx.totalOutputChars + ctx.reasoningChars);
    if (!ctx.contentStarted) {
      ctx.contentStarted = true;
      ctx.hasOutput = true;
      // clear the line with status bar
      process.stdout.write('\x1b[2K\r');
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
    ctx.estTokens = estimateTokens(ctx.totalOutputChars + ctx.reasoningChars);
    const total = (ctx.lastUsage ? (ctx.lastUsage.prompt_tokens || 0) : 0) + ctx.estTokens;
    if (total > 0) {
      ctx.sb.setBar(_('chat.generating') + ` ${Math.round(total * 100 / maxContext)}% ${formatNum(total)}/${formatNum(maxContext)}`);
    }
  };
}

// ── Main entry ──────────────────────────────────────────────────────────

async function run(input, messagesOrOpts = [], opts = {}) {
  let messages = messagesOrOpts;
  if (!Array.isArray(messagesOrOpts)) {
    opts = messagesOrOpts || {};
    messages = opts.messages || [];
  }

  const confirm = opts.confirm === undefined ? true : opts.confirm;
  const maxTurns = opts.maxTurns || 10;
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
      lastUsage: null,
      estTokens: 0,
      totalOutputTokens,
      turnOutputTokens: 0,
      hasOutput,
      showTiming,
    };

    sb.setBar(_('chat.thinking'));

    let response;
    try {
      response = await chat(
        messages,
        enableTools ? tools : [],
        buildContentHandler(ctx, maxContext),
        buildReasoningHandler(ctx),
        buildUsageHandler(ctx),
        ac.signal,
        providerConfig,
      );
    } catch (err) {
      if (isAbortError(err)) return abortRun(sb, messages, hasOutput);
      sb.barFinalize('');
      throw err;
    }

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
          const confirmed = await confirm('已到达最大轮数，按回车继续，输入其他内容结束', ac.signal);
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
        } finally {
          sb.resume();
        }
      } else {
        break;
      }
    }

    if (!hasToolCalls) {
      if (ctx.lastUsage && ctx.lastUsage.prompt_tokens > 0) {
        const ctxTokens = (ctx.lastUsage.prompt_tokens || 0) + (ctx.lastUsage.completion_tokens || 0);
        sb.barFinalize(_('chat.ctx') + ':' + formatNum(ctxTokens) + '/' + formatNum(maxContext) +
          ' ' + _('chat.up') + formatNum(ctx.lastUsage.prompt_tokens) +
          ' ' + _('chat.down') + formatNum(totalOutputTokens));
      } else if (totalOutputTokens > 0) {
        sb.barFinalize(_('chat.downPrefix') + formatNum(totalOutputTokens));
      } else {
        sb.barFinalize('');
      }
      break;
    }

    sb.setBar(_('chat.running'));
    showTiming();
    if (config.getPermissionMode() !== 'ask') {
      displayToolCalls(response.toolCalls, sb);
    }

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
          const result = await executeToolCall(tc, ac.signal);
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
    sb.barFinalize(_('chat.maxTurns'));
    const repaired = repairMessages(messages);
    messages.length = 0;
    messages.push(...repaired);
  }

  currentAbort = null;
  return { messages, aborted: false, hasOutput };
}

module.exports = { run, get currentAbort() { return currentAbort; }, _test: { repairMessages } };
