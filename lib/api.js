const config = require('./config.js');

async function chat(messages, tools, onDelta) {
  const cfg = config.load();
  const url = `${cfg.baseUrl}/chat/completions`;

  const body = {
    model: cfg.model,
    messages,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
    body.tool_choice = 'auto';
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let contentStripped = false;
  let hasOutputContent = false;
  const toolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // DeepSeek sometimes sends content that is actually a tool call wrapper
        if (delta.content) {
          // Some providers wrap tool calls as content like '<tool_call>...'
          if (delta.content.includes('<tool_call')) {
            contentStripped = true;
            continue;
          }
          fullContent += delta.content;
          // Suppress leading whitespace-only content before real output
          if (onDelta) {
            if (hasOutputContent) {
              onDelta(delta.content);
            } else {
              const trimmedStart = delta.content.replace(/^\s+/, '');
              if (trimmedStart) {
                hasOutputContent = true;
                onDelta(trimmedStart);
              }
            }
          }
        }

        if (delta.tool_calls) {
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
      } catch {
        // skip malformed lines
      }
    }
  }

  return {
    content: fullContent,
    toolCalls: toolCalls.filter(Boolean),
  };
}

module.exports = { chat };
