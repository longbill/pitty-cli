const { chat } = require('./api.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const logger = require('./logger.js');
const config = require('./config.js');

// ANSI escape: clear current line
const CLEAR_LINE = '\r\x1b[K';

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

function startThinking() {
  let start = Date.now();
  let reasoning = '';
  let interval = setInterval(() => {
    let elapsed = Math.floor((Date.now() - start) / 1000);
    if (reasoning) {
      // Show last snippet of reasoning in the status line
      const snippet = reasoning.replace(/\n/g, ' ').slice(-60);
      process.stderr.write(CLEAR_LINE + `思考中 ${elapsed}s  ${snippet}`);
    } else {
      process.stderr.write(CLEAR_LINE + `思考中 ${elapsed}s`);
    }
  }, 200);

  return {
    setReasoning(chunk) {
      reasoning += chunk;
    },
    done() {
      clearInterval(interval);
      process.stderr.write(CLEAR_LINE);
    },
    ready() {
      clearInterval(interval);
      process.stderr.write(CLEAR_LINE);
    },
  };
}

function showTokenUsage(usage) {
  if (!usage) return;
  const { prompt_tokens, completion_tokens, total_tokens } = usage;
  if (!total_tokens) return;
  process.stderr.write(
    `\n[tokens: ${total_tokens}  ↑${prompt_tokens || '?'}  ↓${completion_tokens || '?'}]`
  );
}

async function run(input, opts = {}) {
  const cfg = config.load();
  const messages = opts.messages || [];
  const maxTurns = opts.maxTurns || 15;
  const tools = getApiTools();
  const enableTools = tools.length > 0;

  messages.push({ role: 'user', content: input });

  let turnCount = 0;
  let totalUsage = null;

  while (turnCount < maxTurns) {
    turnCount++;

    const thinking = startThinking();

    const response = await chat(
      messages,
      enableTools ? tools : [],
      (delta, isFirst) => {
        if (isFirst) thinking.ready();
        process.stdout.write(delta);
      },
      (chunk) => thinking.setReasoning(chunk),
    );

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

    // Build assistant message
    const assistantMsg = {
      role: 'assistant',
      content: response.content || null,
      reasoning_content: response.reasoning || null,
    };
    if (hasToolCalls) {
      assistantMsg.tool_calls = response.toolCalls;
    }
    messages.push(assistantMsg);

    // If no output content was streamed, clear thinking
    if (!response.content) {
      thinking.done();
    }

    // Accumulate usage across turns (only show at the end)
    if (response.usage) {
      if (totalUsage) {
        totalUsage = {
          prompt_tokens: (totalUsage.prompt_tokens || 0) + (response.usage.prompt_tokens || 0),
          completion_tokens: (totalUsage.completion_tokens || 0) + (response.usage.completion_tokens || 0),
          total_tokens: (totalUsage.total_tokens || 0) + (response.usage.total_tokens || 0),
        };
      } else {
        totalUsage = { ...response.usage };
      }
    }

    if (!hasToolCalls) {
      showTokenUsage(totalUsage);
      break;
    }

    process.stdout.write('\n');

    // Show tool calls being executed
    for (const tc of response.toolCalls) {
      let args = '';
      try {
        const parsed = JSON.parse(tc.function.arguments);
        // Show first 2 key-value pairs as summary
        const entries = Object.entries(parsed).slice(0, 2);
        args = entries.map(([k, v]) => {
          const s = String(v);
          return `${k}: "${s.slice(0, 60)}${s.length > 60 ? '...' : ''}"`;
        }).join(', ');
      } catch {
        args = tc.function.arguments.slice(0, 80);
      }
      process.stderr.write(`→ ${tc.function.name}(${args})\n`);
    }

    // Execute tool calls in parallel
    const results = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const result = await executeToolCall(tc);
        return { id: tc.id, ...result };
      })
    );

    // Show tool results and add to messages
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

  // Ensure cursor is on a fresh line before the next REPL prompt
  process.stdout.write('\n');
  return messages;
}

module.exports = { run };
