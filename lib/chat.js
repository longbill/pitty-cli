const { chat } = require('./api.js');
const { getApiTools, executeToolCall, filterByPermission } = require('./tools.js');
const { t, _ } = require('./lang/index.js');
const { createRenderer, gray, formatNum } = require('./render.js');
const { createStatusBar } = require('./statusbar.js');
const { auditToolCalls, shouldAskUser, resetRiskyStreak } = require('./audit.js');
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
    content = _('chat.error') + result.error;
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
  if (tokens > 20) {
    estCharsPerToken = chars / tokens;
  }
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

// ── Message repair ─────────────────────────────────────────────────────

function repairMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;

  let cutoff = msgs.length;

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const neededIds = new Set(m.tool_calls.map(tc => tc.id));
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].role === 'assistant') break;
        if (msgs[j].role === 'tool' && neededIds.has(msgs[j].tool_call_id)) {
          neededIds.delete(msgs[j].tool_call_id);
        }
      }
      if (neededIds.size > 0) {
        cutoff = i;
        break;
      }
    }
  }

  while (cutoff > 0 && msgs[cutoff - 1].role === 'tool') {
    cutoff--;
  }

  return msgs.slice(0, cutoff);
}

// ── Tool approval pipeline ──────────────────────────────────────────

async function resolveToolApprovals(toolCalls, messages, confirm, sb) {
  const mode = config.getPermissionMode();
  const filtered = filterByPermission(mode, toolCalls);

  // Collect blocked-by-permission results
  const blocked = [];
  const pending = [];

  for (const item of filtered) {
    if (!item.allowed) {
      let args = {};
      try { args = JSON.parse(item.tc.function.arguments); } catch {}
      blocked.push({
        id: item.tc.id, name: item.tc.function.name,
        result: { error: item.reason || 'blocked by permission mode' },
      });
    } else {
      pending.push(item);
    }
  }

  // Run audit if any tools need it
  const needAuditItems = pending.filter(p => p.needAudit);
  let auditResult = null;

  if (needAuditItems.length > 0) {
    sb.setBar(_('chat.auditing'));

    // Show what's being audited
    for (const item of needAuditItems) {
      let args = {};
      try { args = JSON.parse(item.tc.function.arguments); } catch {}
      sb.barWriteLine(gray(t(item.tc.function.name, args)));
    }

    auditResult = await auditToolCalls(
      needAuditItems.map(p => p.tc),
      messages
    );

    // Display audit results
    for (const review of auditResult.reviews) {
      if (review.safe) {
        sb.barWriteLine(gray(`  ${_('chat.auditSafe')} ${review.name}: ${review.reason}`));
      } else {
        sb.barWriteLine(gray(`  ${_('chat.auditRisky')} ${review.name}: ${review.reason}`));
      }
    }
  }

  // Process confirmations
  const denied = [];
  const approved = [];

  for (const item of pending) {
    let needsConfirm = item.needConfirm;
    let denyReason = null;

    // Audit-based decisions
    if (item.needAudit && auditResult) {
      const review = auditResult.reviews.find(r => r.name === item.tc.function.name);
      const isSafe = review ? review.safe : false;

      if (shouldAskUser(mode, auditResult.allSafe)) {
        needsConfirm = true;
      } else if (!isSafe && mode === 'audit-ask') {
        needsConfirm = true;
      }
    }

    if (needsConfirm) {
      let args = {};
      try { args = JSON.parse(item.tc.function.arguments); } catch {}
      const desc = t(item.tc.function.name, args) || `${item.tc.function.name}: ${JSON.stringify(args)}`;
      const ok = confirm ? await confirm(desc) : false;
      if (!ok) {
        denied.push({
          id: item.tc.id, name: item.tc.function.name,
          result: { error: _('chat.denied') },
        });
        continue;
      }
    }

    approved.push(item.tc);
  }

  return { approved, results: [...blocked, ...denied] };
}

// ── Streaming callbacks ──────────────────────────────────────────────

function buildContentHandler(ctx, maxContext) {
  return (delta) => {
    if (!ctx.contentStarted) {
      ctx.contentStarted = true;
      ctx.hasOutput = true;
      ctx.showTiming();
    }
    ctx.totalOutputChars += delta.length;
    ctx.estTokens = ctx.totalOutputTokens + estimateTokens(ctx.reasoningChars + ctx.totalOutputChars);
    ctx.sb.setBar(_('chat.generating'), _('chat.downPrefix') + formatNum(ctx.estTokens));

    ctx.lineBuffer += delta;
    const lines = ctx.lineBuffer.split('\n');
    ctx.lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const rendered = ctx.renderer.renderLine(line);
      if (rendered === null) continue;
      for (const r of rendered) {
        ctx.sb.barWriteLine(r);
      }
    }
  };
}

function buildReasoningHandler(ctx) {
  return (chunk) => {
    ctx.reasoningChars += chunk.length;
    ctx.estTokens = ctx.totalOutputTokens + estimateTokens(ctx.reasoningChars + ctx.totalOutputChars);
    ctx.sb.setBar(_('chat.thinking'), '~' + formatNum(ctx.estTokens) + ' ' + _('chat.tokens'));
  };
}

function buildUsageHandler(ctx, maxContext) {
  return (usage) => {
    ctx.lastUsage = usage;
    ctx.turnOutputTokens = usage.completion_tokens || 0;
    if (ctx.reasoningChars + ctx.totalOutputChars > 0) {
      updateEstRatio(ctx.reasoningChars + ctx.totalOutputChars, ctx.turnOutputTokens);
    }
    const label = ctx.contentStarted ? _('chat.generating') : _('chat.thinking');
    ctx.sb.setBar(label,
      _('chat.ctx') + ':' + formatNum((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) + '/' + formatNum(maxContext) +
      ' ' + _('chat.up') + formatNum(usage.prompt_tokens) +
      ' ' + _('chat.down') + formatNum(ctx.totalOutputTokens + ctx.turnOutputTokens));
  };
}

function displayToolCalls(toolCalls, sb) {
  const groups = [];
  for (const tc of toolCalls) {
    const last = groups[groups.length - 1];
    if (last && last.name === tc.function.name) {
      last.calls.push(tc);
    } else {
      groups.push({ name: tc.function.name, calls: [tc] });
    }
  }

  for (const group of groups) {
    if (group.calls.length > 1 && group.name === 'Read') {
      const cwd = process.cwd();
      const paths = group.calls.map(tc => {
        try {
          const args = JSON.parse(tc.function.arguments);
          const full = args.file_path || '';
          return full.startsWith(cwd + '/') ? full.slice(cwd.length + 1) : full;
        } catch { return ''; }
      }).filter(Boolean);
      sb.barWriteLine(gray(_('ReadGroup', paths)));
    } else {
      for (const tc of group.calls) {
        let parsed = {};
        try { parsed = JSON.parse(tc.function.arguments); } catch {}
        sb.barWriteLine(gray(t(tc.function.name, parsed)));
      }
    }
  }
}

// ── Main loop ─────────────────────────────────────────────────────────

async function run(input, opts = {}) {
  const messages = opts.messages || [];
  const maxTurns = opts.maxTurns || config.getMaxTurns();
  const confirm = opts.confirm || null;
  const maxContext = config.get('maxContext') || 256000;
  const tools = getApiTools();
  const enableTools = tools.length > 0;
  const providerConfig = config.resolveModel(config.getMainModel());

  let hasOutput = false;
  currentAbort = null;

  const renderer = createRenderer();
  const sb = createStatusBar(_);

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
        buildUsageHandler(ctx, maxContext),
        ac.signal,
        providerConfig,
      );
    } catch (err) {
      if (isAbortError(err)) return abortRun(sb, messages, hasOutput);
      sb.barFinalize('');
      throw err;
    }

    currentAbort = null;

    // Flush remaining buffered content
    if (ctx.lineBuffer) {
      const rendered = renderer.renderLine(ctx.lineBuffer);
      if (rendered) {
        for (const r of rendered) sb.barWriteLine(r);
      }
    }
    if (renderer.hasPending()) {
      for (const r of renderer.flush()) {
        sb.barWriteLine(r);
      }
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
    if (hasToolCalls) {
      assistantMsg.tool_calls = response.toolCalls;
    }
    messages.push(assistantMsg);

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
    displayToolCalls(response.toolCalls, sb);

    // Permission + audit pipeline
    const { approved, results: preResults } = await resolveToolApprovals(
      response.toolCalls, messages, confirm, sb
    );

    // Push pre-resolved results (blocked/denied) to messages
    for (const { id, name, result } of preResults) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: formatResult(name, result),
      });
    }

    // Execute approved tools
    if (approved.length > 0) {
      const results = await Promise.all(
        approved.map(async (tc) => {
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

    // Reset audit streak after successful cycle
    resetRiskyStreak();
    currentAbort = null;
  }

  if (turnCount >= maxTurns) {
    sb.barFinalize('');
    process.stderr.write(_('chat.maxTurns') + '\n');
  }

  currentAbort = null;
  return { messages, aborted: false, hasOutput };
}

module.exports = { run, get currentAbort() { return currentAbort; } };
