const { chat } = require('./api.js');
const { getApiTools, executeToolCall } = require('./tools.js');
const config = require('./config.js');

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

async function run(input, opts = {}) {
  const cfg = config.load();
  const messages = opts.messages || [];
  const maxTurns = opts.maxTurns || 10;
  const tools = getApiTools();
  const enableTools = tools.length > 0;

  messages.push({ role: 'user', content: input });

  let turnCount = 0;

  while (turnCount < maxTurns) {
    turnCount++;

    const response = await chat(messages, enableTools ? tools : [], (delta) => {
      process.stdout.write(delta);
    });

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

    // Build assistant message
    const assistantMsg = {
      role: 'assistant',
      content: response.content || null,
    };
    if (hasToolCalls) {
      assistantMsg.tool_calls = response.toolCalls;
    }
    messages.push(assistantMsg);

    if (!hasToolCalls) {
      process.stdout.write('\n');
      break;
    }

    process.stdout.write('\n');

    // Execute tool calls in parallel
    const results = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const result = await executeToolCall(tc);
        return { id: tc.id, ...result };
      })
    );

    // Add tool results to messages
    for (const { id, name, result } of results) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: formatResult(name, result),
      });
    }
  }

  if (turnCount >= maxTurns) {
    process.stdout.write('\n[Reached max turns. Type "continue" to keep going.]\n');
  }

  return messages;
}

module.exports = { run };
