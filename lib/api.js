const config = require('./config.js');
const logger = require('./logger.js');
const { buildSystemPrompt } = require('./system.js');

async function chat(messages, tools, onDelta, onReasoning, onUsage, signal) {
  const cfg = config.load();
  const url = `${cfg.baseUrl}/chat/completions`;

  // Build system prompt dynamically based on available tools
  const systemPrompt = buildSystemPrompt(tools || []);
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const body = {
    model: cfg.model,
    messages: apiMessages,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    stream: true,
    stream_options: { include_usage: true },
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

  logger.logRequest(body.messages);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.logError('api_error', `HTTP ${resp.status}: ${text}`);
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';
  let hasOutputContent = false;
  let usage = null;
  let finishReason = null;
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
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        if (!delta && !parsed.usage) continue;

        if (parsed.usage) { usage = parsed.usage; if (onUsage) onUsage(parsed.usage); }
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        // Reasoning content — multiple possible field names across providers
        if (delta.content) {
          fullContent += delta.content;
          if (onDelta) {
            if (hasOutputContent) {
              onDelta(delta.content, false);
            } else {
              const trimmedStart = delta.content.replace(/^\s+/, '');
              if (trimmedStart) {
                hasOutputContent = true;
                onDelta(trimmedStart, true);
              }
            }
          }
        } else {
          // No content yet — collect reasoning from any of the known fields
          const reasonChunk = delta.reasoning_content || delta.thinking || delta.reasoning || '';
          if (reasonChunk) {
            fullReasoning += reasonChunk;
            if (onReasoning) onReasoning(reasonChunk);
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
        logger.logError('sse_parse', `Malformed SSE line: ${trimmed.slice(0, 200)}`);
      }
    }
  }

  const result = {
    content: fullContent,
    reasoning: fullReasoning,
    toolCalls: toolCalls.filter(tc => tc && tc.function.name),
    usage,
    finishReason,
  };

  logger.logResponse(result);
  return result;
}

module.exports = { chat };
