async function parseChatCompletionStream(reader, handlers = {}) {
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';
  let hasOutputContent = false;
  let usage = null;
  let finishReason = null;
  const toolCalls = [];

  async function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) return;

    const data = trimmed.slice(6);
    if (data === '[DONE]') return;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      if (handlers.onParseError) handlers.onParseError(trimmed);
      return;
    }

    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    if (!delta && !parsed.usage) return;

    if (parsed.usage) {
      usage = parsed.usage;
      if (handlers.onUsage) handlers.onUsage(parsed.usage);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;

    if (!delta) return;

    if (delta.content) {
      fullContent += delta.content;
      if (handlers.onDelta) {
        if (hasOutputContent) {
          handlers.onDelta(delta.content, false);
        } else {
          const trimmedStart = delta.content.replace(/^\s+/, '');
          if (trimmedStart) {
            hasOutputContent = true;
            handlers.onDelta(trimmedStart, true);
          }
        }
      }
    }

    const reasonChunk = delta.reasoning_content || delta.thinking || delta.reasoning || '';
    if (reasonChunk) {
      fullReasoning += reasonChunk;
      if (handlers.onReasoning) handlers.onReasoning(reasonChunk);
    }

    if (delta.tool_calls) {
      if (handlers.onToolDelta) handlers.onToolDelta();
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCalls[idx]) {
          toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      await processLine(line);
    }
  }

  if (buffer) await processLine(buffer);

  return {
    content: fullContent,
    reasoning: fullReasoning,
    toolCalls: toolCalls.filter(tc => tc && tc.function.name),
    usage,
    finishReason,
  };
}

module.exports = { parseChatCompletionStream };
