const { chat } = require('./api.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const { t, _ } = require('./lang/index.js');
const { createRenderer } = require('./render.js');
const { createStatusBar } = require('./statusbar.js');
const logger = require('./logger.js');
const config = require('./config.js');

const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function gray(s) { return GRAY + s + RESET; }

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

function formatNum(n) {
  if (n == null) return '?';
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return Math.round(k) + 'k';
  return (Math.round(k * 10) / 10) + 'k';
}

// ── Message repair ──────────────────────────────────────────────────────────

function repairMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;
  const result = [...msgs];

  while (true) {
    let asstIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const m = result[i];
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        asstIdx = i;
        break;
      }
    }

    if (asstIdx === -1) {
      while (result.length > 0 && result[result.length - 1].role === 'tool') {
        result.pop();
      }
      return result;
    }

    const remainingIds = new Set(result[asstIdx].tool_calls.map(tc => tc.id));
    for (let i = asstIdx + 1; i < result.length; i++) {
      if (result[i].role === 'tool' && remainingIds.has(result[i].tool_call_id)) {
        remainingIds.delete(result[i].tool_call_id);
      }
    }

    if (remainingIds.size === 0) return result;

    result.splice(asstIdx);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────

let currentAbort = null;
function isAbortError(err) {
  return err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

async function run(input, opts = {}) {
  const cfg = config.load();
  const messages = opts.messages || [];
  const maxTurns = opts.maxTurns || cfg.maxTurns || 100;
  const tools = getApiTools();
  const enableTools = tools.length > 0;

  let hasOutput = false;
  currentAbort = null;

  const renderer = createRenderer();
  const sb = createStatusBar(_);

  const repaired = repairMessages(messages);
  messages.length = 0;
  messages.push(...repaired);

  messages.push({ role: 'user', content: input });

  let turnTimeline = Date.now();

  let turnCount = 0;
  let totalOutputTokens = 0;
  const maxContext = cfg.maxContext || 256000;

  while (turnCount < maxTurns) {
    turnCount++;

    const ac = new AbortController();
    currentAbort = ac;

    let contentStarted = false;
    let lineBuffer = '';
    let totalOutputChars = 0;
    let reasoningChars = 0;
    let lastUsage = null;
    let estOutputTokens = 0;
    let turnOutputTokens = 0;
    let aborted = false;
    let timingShown = false;

    const showTiming = () => {
      if (timingShown) return;
      timingShown = true;
      const now = Date.now();
      const elapsed = now - turnTimeline;
      if (elapsed >= 5000) {
        sb.barWriteLine(gray(sb.formatElapsed(elapsed)));
      }
      turnTimeline = now;
    };

    sb.setBar(_('chat.thinking'));

    let response;
    try {
      response = await chat(
        messages,
        enableTools ? tools : [],
        (delta) => {
          if (!contentStarted) {
            contentStarted = true;
            hasOutput = true;
            showTiming();
          }
          totalOutputChars += delta.length;
          estOutputTokens = totalOutputTokens + Math.round((reasoningChars + totalOutputChars) / 2.5);
          sb.setBar(_('chat.generating'), _('chat.downPrefix') + formatNum(estOutputTokens));

          lineBuffer += delta;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          for (const line of lines) {
            const rendered = renderer.renderLine(line);
            if (rendered === null) continue;
            for (const r of rendered) {
              sb.barWriteLine(r);
            }
          }
        },
        (chunk) => {
          reasoningChars += chunk.length;
          estOutputTokens = totalOutputTokens + Math.round((reasoningChars + totalOutputChars) / 2.5);
          sb.setBar(_('chat.thinking'), '~' + formatNum(estOutputTokens) + ' ' + _('chat.tokens'));
        },
        (usage) => {
          lastUsage = usage;
          turnOutputTokens = usage.completion_tokens || 0;
          const label = contentStarted ? _('chat.generating') : _('chat.thinking');
          sb.setBar(label,
            _('chat.ctx') + ':' + formatNum((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) + '/' + formatNum(maxContext) +
            ' ' + _('chat.up') + formatNum(usage.prompt_tokens) +
            ' ' + _('chat.down') + formatNum(totalOutputTokens + turnOutputTokens));
        },
        ac.signal,
      );
    } catch (err) {
      if (isAbortError(err)) {
        aborted = true;
        response = null;
      } else {
        sb.barFinalize('');
        throw err;
      }
    }

    if (aborted) {
      currentAbort = null;
      sb.barFinalize('');
      messages.pop();
      return { messages, aborted: true, hasOutput: hasOutput };
    }

    if (lineBuffer) {
      const rendered = renderer.renderLine(lineBuffer);
      if (rendered) {
        for (const r of rendered) {
          sb.barWriteLine(r);
        }
      }
    }
    if (renderer.hasPending()) {
      for (const r of renderer.flush()) {
        sb.barWriteLine(r);
      }
    }

    if (response.usage) {
      turnOutputTokens = response.usage.completion_tokens || 0;
      lastUsage = response.usage;
    } else if ((reasoningChars + totalOutputChars) > 0) {
      turnOutputTokens = Math.round((reasoningChars + totalOutputChars) / 2.5);
    }
    totalOutputTokens += turnOutputTokens;

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
    if (hasToolCalls) hasOutput = true;

    // If model only produced reasoning (no content, no tools), use reasoning as output
    if (!hasToolCalls && response.reasoning && !response.content) {
      const lines = response.reasoning.split('\n');
      for (const line of lines) {
        const rendered = renderer.renderLine(line);
        if (rendered === null) continue;
        for (const r of rendered) {
          sb.barWriteLine(r);
        }
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
      currentAbort = null;
      if (lastUsage && lastUsage.prompt_tokens > 0) {
        const ctx = (lastUsage.prompt_tokens || 0) + (lastUsage.completion_tokens || 0);
        sb.barFinalize(_('chat.ctx') + ':' + formatNum(ctx) + '/' + formatNum(maxContext) +
          ' ' + _('chat.up') + formatNum(lastUsage.prompt_tokens) +
          ' ' + _('chat.down') + formatNum(totalOutputTokens));
      } else if (totalOutputTokens > 0) {
        sb.barFinalize(_('chat.downPrefix') + formatNum(totalOutputTokens));
      } else {
        sb.barFinalize('');
      }
      break;
    }

    sb.setBar(_('chat.running'));

    // Group consecutive same-name tool calls for merged display
    const groups = [];
    for (const tc of response.toolCalls) {
      const last = groups[groups.length - 1];
      if (last && last.name === tc.function.name) {
        last.calls.push(tc);
      } else {
        groups.push({ name: tc.function.name, calls: [tc] });
      }
    }

    showTiming();

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

    const results = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const result = await executeToolCall(tc, ac.signal);
        return { id: tc.id, ...result };
      })
    );

    if (ac.signal.aborted) {
      currentAbort = null;
      sb.barFinalize('');
      messages.pop();
      const repaired = repairMessages(messages);
      messages.length = 0;
      messages.push(...repaired);
      return { messages, aborted: true, hasOutput: hasOutput };
    }

    currentAbort = null;

    for (const { id, name, result } of results) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: formatResult(name, result),
      });
    }
  }

  if (turnCount >= maxTurns) {
    sb.barFinalize('');
    process.stderr.write(_('chat.maxTurns') + '\n');
  }

  currentAbort = null;
  return { messages, aborted: false, hasOutput: hasOutput };
}

module.exports = { run, get currentAbort() { return currentAbort; } };
