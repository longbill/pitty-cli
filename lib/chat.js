const { chat } = require('./api.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const logger = require('./logger.js');
const config = require('./config.js');

const CLEAR_LINE = '\r\x1b[K';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function gray(s) { return GRAY + s + RESET; }

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

let barVisible = false;
let barText = '';

function barUpdate(text) {
  if (barVisible) {
    process.stdout.write(CLEAR_LINE);
  }
  barVisible = true;
  barText = text;
  process.stdout.write(gray(text));
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
  if (barVisible) {
    process.stdout.write(CLEAR_LINE);
    if (text) process.stdout.write(gray(text));
    process.stdout.write('\n');
    barVisible = false;
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────

async function run(input, opts = {}) {
  const cfg = config.load();
  const messages = opts.messages || [];
  const maxTurns = opts.maxTurns || 15;
  const tools = getApiTools();
  const enableTools = tools.length > 0;

  messages.push({ role: 'user', content: input });

  let turnCount = 0;
  let totalOutputTokens = 0;
  const maxContext = cfg.maxContext || 256000;

  while (turnCount < maxTurns) {
    turnCount++;

    let contentStarted = false;
    let lineBuffer = '';
    let totalOutputChars = 0;
    let lastUsage = null;
    let estOutputTokens = 0;
    let turnOutputTokens = 0;

    barUpdate('思考中...');

    const response = await chat(
      messages,
      enableTools ? tools : [],
      (delta) => {
        if (!contentStarted) {
          contentStarted = true;
        }
        totalOutputChars += delta.length;
        estOutputTokens = Math.round(totalOutputChars / 2.5);
        barUpdate('生成中... [↓~' + formatNum(estOutputTokens) + ']');

        lineBuffer += delta;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          barWriteLine(line);
        }
      },
      null, // don't show reasoning content
      (usage) => {
        lastUsage = usage;
        turnOutputTokens = usage.completion_tokens || 0;
        const label = contentStarted ? '生成中...' : '思考中...';
        barUpdate(label + ' [' +
          'ctx:' + formatNum((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) + '/' + formatNum(maxContext) +
          ' ↑' + formatNum(usage.prompt_tokens) +
          ' ↓' + formatNum(totalOutputTokens + turnOutputTokens) +
          ']');
      },
    );

    // Flush any remaining buffered content
    if (lineBuffer) {
      barWriteLine(lineBuffer);
    }

    // Accumulate output tokens from this turn
    if (response.usage) {
      turnOutputTokens = response.usage.completion_tokens || 0;
      lastUsage = response.usage;
    } else if (estOutputTokens > 0) {
      turnOutputTokens = estOutputTokens;
    }
    totalOutputTokens += turnOutputTokens;

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

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
      if (lastUsage && lastUsage.prompt_tokens > 0) {
        const ctx = (lastUsage.prompt_tokens || 0) + (lastUsage.completion_tokens || 0);
        barFinalize('[ctx:' + formatNum(ctx) + '/' + formatNum(maxContext) +
          ' ↑' + formatNum(lastUsage.prompt_tokens) +
          ' ↓' + formatNum(totalOutputTokens) + ']');
      } else if (totalOutputTokens > 0) {
        barFinalize('[↓~' + formatNum(totalOutputTokens) + ']');
      } else {
        barFinalize('');
      }
      break;
    }

    // Tool-call turn: clear status bar, show tools
    barFinalize('');

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
      process.stderr.write(`🛠 ${tc.function.name}(${args})\n`);
    }

    const results = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const result = await executeToolCall(tc);
        return { id: tc.id, ...result };
      })
    );

    for (const { id, name, result } of results) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: formatResult(name, result),
      });
    }
  }

  if (turnCount >= maxTurns) {
    process.stderr.write(CLEAR_LINE + '[Reached max turns. Type "continue" to keep going.]\n');
  }

  return messages;
}

module.exports = { run };
