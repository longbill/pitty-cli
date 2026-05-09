const { chat } = require('./api.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const { Table } = require('./table.js');
const logger = require('./logger.js');
const config = require('./config.js');

const CLEAR_LINE = '\r\x1b[K';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function gray(s) { return GRAY + s + RESET; }

const TOOL_EMOJI = {
  Bash: '💻',
  Read: '📖',
  Write: '✏️',
  Edit: '🔧',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
};

// ── Simple Markdown renderer ───────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const GREEN = '\x1b[32m';

let mdInCodeBlock = false;
let mdTableBuffer = [];

function parseTableRow(line) {
  // Strip leading/trailing pipe and whitespace, split by |
  return line.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').split(/\s*\|\s*/).map(c => c.trim());
}

function isTableSeparator(cell) {
  return /^:?-{3,}:?$/.test(cell);
}

function flushTable() {
  if (mdTableBuffer.length < 2) {
    const lines = mdTableBuffer.map(l => l);
    mdTableBuffer = [];
    return lines;
  }

  // Parse rows: render inline formatting, detect separator
  const parsed = mdTableBuffer.map(line => ({
    cells: parseTableRow(line).map(renderInline),
    isSep: parseTableRow(line).every(isTableSeparator),
  }));

  const sepIdx = parsed.findIndex(r => r.isSep);
  const headRow = sepIdx > 0 ? parsed[sepIdx - 1].cells : (parsed[0].isSep ? [] : parsed[0].cells);
  const dataStart = sepIdx >= 0 ? sepIdx + 1 : (headRow.length ? 1 : 0);
  const dataRows = parsed.slice(dataStart).filter(r => !r.isSep).map(r => r.cells);

  const table = new Table({ head: headRow.length ? headRow : undefined });
  for (const row of dataRows) {
    table.push(row);
  }

  mdTableBuffer = [];
  return table.toString().split('\n');
}

function renderLine(line) {
  // Returns null (buffered), [] (nothing to output), or [lines...]

  // Fenced code block toggle — hide the fences
  if (/^\s*```/.test(line)) {
    if (mdTableBuffer.length > 0) return flushTable().concat('');
    mdInCodeBlock = !mdInCodeBlock;
    return [];
  }

  if (mdInCodeBlock) {
    return [GREEN + line + RESET];
  }

  // Table detection
  if (/^\s*\|/.test(line) && line.includes('|', line.indexOf('|') + 1)) {
    mdTableBuffer.push(line);
    return null; // buffering
  }
  if (mdTableBuffer.length > 0) {
    return flushTable().concat(line ? [renderSingleLine(line)] : []);
  }

  return [renderSingleLine(line)];
}

function renderInline(text) {
  // Bold before italic to avoid conflict
  text = text.replace(/\*\*(.+?)\*\*/g, BOLD + '$1' + RESET);
  text = text.replace(/\*(.+?)\*/g, ITALIC + '$1' + RESET);
  text = text.replace(/`(.+?)`/g, GREEN + '$1' + RESET);
  return text;
}

function renderSingleLine(line) {
  // Blockquote
  if (/^\s*>/.test(line)) {
    return gray(line);
  }

  // Headings
  const h = line.match(/^(#{1,6})\s+(.+)$/);
  if (h) {
    return gray(h[1]) + ' ' + BOLD + h[2] + RESET;
  }

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return gray(line);
  }

  line = renderInline(line);

  // List markers
  line = line.replace(/^(\s*)([-*+])\s+/, '$1' + gray('$2') + ' ');
  line = line.replace(/^(\s*)(\d+\.)\s+/, '$1' + gray('$2') + ' ');

  return line;
}

function formatResult(name, result) {
  let content;
  if (result.error) {
    content = `Error: ${result.error}`;
  } else {
    content = JSON.stringify(result, null, 2);
    if (content.length > 16000) {
      content = content.slice(0, 16000) + '\n...[truncated]';
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

// ── Status bar (always shown on the bottom line) ──────────────────────────

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let barVisible = false;
let barText = '';
let spinnerIndex = 0;
let spinnerTimer = null;
let turnStartTime = 0;
let barState = '';
let barTokenInfo = '';

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return totalSec + 's';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + 'm' + s + 's';
}

function refreshBar() {
  const elapsed = Date.now() - turnStartTime;
  const spinner = SPINNER[spinnerIndex];
  spinnerIndex = (spinnerIndex + 1) % SPINNER.length;
  const text = spinner + ' ' + barState + ' ' + formatTime(elapsed) + (barTokenInfo ? ' ' + barTokenInfo : '');

  if (barVisible) {
    process.stdout.write(CLEAR_LINE);
  }
  barVisible = true;
  barText = text;
  process.stdout.write(gray(text));
}

function startSpinner() {
  if (spinnerTimer) return;
  spinnerIndex = 0;
  turnStartTime = Date.now();
  refreshBar();
  spinnerTimer = setInterval(refreshBar, 100);
}

function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

function setBar(state, tokenInfo) {
  barState = state;
  barTokenInfo = tokenInfo || '';
  if (!spinnerTimer) startSpinner();
}

// Write a full line of content above the status bar.
// If status bar is visible, clear it first, write the line, then redraw below.
function barWriteLine(line) {
  if (!barVisible) {
    process.stdout.write(line + '\n');
    return;
  }
  process.stdout.write(CLEAR_LINE);
  process.stdout.write(line + '\n');
  process.stdout.write(gray(barText));
}

// End-of-turn: replace status prefix with just the final usage line.
function barFinalize(text) {
  stopSpinner();
  if (barVisible) {
    process.stdout.write(CLEAR_LINE);
    if (text) process.stdout.write(gray(text));
    process.stdout.write(text ? '\n\n' : '\n');
    barVisible = false;
  }
}

// ── Message repair ──────────────────────────────────────────────────────────

function repairMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;
  const result = [...msgs];

  while (true) {
    // Find the last assistant message with tool_calls
    let asstIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const m = result[i];
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        asstIdx = i;
        break;
      }
    }

    if (asstIdx === -1) {
      // No tool_calls found — remove any trailing orphaned tool messages
      while (result.length > 0 && result[result.length - 1].role === 'tool') {
        result.pop();
      }
      return result;
    }

    // Check which tool_call_ids have corresponding tool responses
    const remainingIds = new Set(result[asstIdx].tool_calls.map(tc => tc.id));
    for (let i = asstIdx + 1; i < result.length; i++) {
      if (result[i].role === 'tool' && remainingIds.has(result[i].tool_call_id)) {
        remainingIds.delete(result[i].tool_call_id);
      }
    }

    // All tool calls have responses — valid
    if (remainingIds.size === 0) return result;

    // Orphaned tool_calls — remove this assistant and everything after it
    result.splice(asstIdx);
    // Loop again in case there are more orphaned tool_calls further up
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────

let currentAbort = null;
let _hasOutput = false;

function isAbortError(err) {
  return err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

async function run(input, opts = {}) {
  const cfg = config.load();
  const messages = opts.messages || [];
  const maxTurns = opts.maxTurns || cfg.maxTurns || 30;
  const tools = getApiTools();
  const enableTools = tools.length > 0;

  mdInCodeBlock = false;
  _hasOutput = false;
  currentAbort = null;

  // Repair any existing corruption in the message list
  const repaired = repairMessages(messages);
  messages.length = 0;
  messages.push(...repaired);

  messages.push({ role: 'user', content: input });

  let turnCount = 0;
  let totalOutputTokens = 0;
  const maxContext = cfg.maxContext || 256000;

  while (turnCount < maxTurns) {
    turnCount++;

    // Create abort controller for this API call
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

    setBar('思考中...');

    let response;
    try {
      response = await chat(
        messages,
        enableTools ? tools : [],
        (delta) => {
          if (!contentStarted) {
            contentStarted = true;
            _hasOutput = true;
          }
          totalOutputChars += delta.length;
          estOutputTokens = totalOutputTokens + Math.round((reasoningChars + totalOutputChars) / 2.5);
          setBar('生成中...', '↓~' + formatNum(estOutputTokens));

          lineBuffer += delta;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          for (const line of lines) {
            const rendered = renderLine(line);
            if (rendered === null) continue;
            for (const r of rendered) {
              barWriteLine(r);
            }
          }
        },
        (chunk) => {
          reasoningChars += chunk.length;
          estOutputTokens = totalOutputTokens + Math.round((reasoningChars + totalOutputChars) / 2.5);
          setBar('思考中...', '~' + formatNum(estOutputTokens) + ' tokens');
        },
        (usage) => {
          lastUsage = usage;
          turnOutputTokens = usage.completion_tokens || 0;
          const label = contentStarted ? '生成中...' : '思考中...';
          setBar(label,
            'ctx:' + formatNum((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) + '/' + formatNum(maxContext) +
            ' ↑' + formatNum(usage.prompt_tokens) +
            ' ↓' + formatNum(totalOutputTokens + turnOutputTokens));
        },
        ac.signal,
      );
    } catch (err) {
      if (isAbortError(err)) {
        aborted = true;
        response = null;
      } else {
        barFinalize('');
        throw err;
      }
    }

    if (aborted) {
      currentAbort = null;
      barFinalize('');
      messages.pop(); // Remove user message
      return { messages, aborted: true, hasOutput: _hasOutput };
    }

    // Flush any remaining buffered content
    if (lineBuffer) {
      const rendered = renderLine(lineBuffer);
      if (rendered) {
        for (const r of rendered) {
          barWriteLine(r);
        }
      }
    }
    // Flush any buffered table rows
    if (mdTableBuffer.length > 0) {
      for (const r of flushTable()) {
        barWriteLine(r);
      }
    }

    // Accumulate output tokens from this turn
    if (response.usage) {
      turnOutputTokens = response.usage.completion_tokens || 0;
      lastUsage = response.usage;
    } else if ((reasoningChars + totalOutputChars) > 0) {
      turnOutputTokens = Math.round((reasoningChars + totalOutputChars) / 2.5);
    }
    totalOutputTokens += turnOutputTokens;

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
    if (hasToolCalls) _hasOutput = true;

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
        barFinalize('ctx:' + formatNum(ctx) + '/' + formatNum(maxContext) +
          ' ↑' + formatNum(lastUsage.prompt_tokens) +
          ' ↓' + formatNum(totalOutputTokens));
      } else if (totalOutputTokens > 0) {
        barFinalize('↓~' + formatNum(totalOutputTokens));
      } else {
        barFinalize('');
      }
      break;
    }

    // Tool-call turn: keep status bar, switch to 运行中...
    setBar('运行中...');

    for (const tc of response.toolCalls) {
      let args = '';
      try {
        const parsed = JSON.parse(tc.function.arguments);
        const entries = Object.entries(parsed).slice(0, 2);
        args = entries.map(([k, v]) => {
          const s = String(v);
          return `${k}: "${s.slice(0, 60)}${s.length > 60 ? '...' : ''}"`;
        }).join(', ');
      } catch {
        args = tc.function.arguments.slice(0, 80);
      }
      const emoji = TOOL_EMOJI[tc.function.name] || '🔧';
      barWriteLine(`${emoji} ${tc.function.name}(${args})`);
    }

    const results = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const result = await executeToolCall(tc);
        return { id: tc.id, ...result };
      })
    );

    // Ctrl+C during tool execution — discard results, remove orphaned tool_calls
    if (ac.signal.aborted) {
      currentAbort = null;
      barFinalize('');
      messages.pop(); // Remove the orphaned assistant msg with tool_calls
      const repaired = repairMessages(messages);
      messages.length = 0;
      messages.push(...repaired);
      return { messages, aborted: true, hasOutput: _hasOutput };
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
    barFinalize('');
    process.stderr.write('[Reached max turns. Type "continue" to keep going.]\n');
  }

  currentAbort = null;
  return { messages, aborted: false, hasOutput: _hasOutput };
}

module.exports = { run, get currentAbort() { return currentAbort; } };
