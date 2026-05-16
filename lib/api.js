const config = require('./config.js');
const logger = require('./logger.js');
const { buildSystemPrompt } = require('./system.js');
const { parseChatCompletionStream } = require('./streamParser.js');
const { fetch } = require('./fetch.js');

async function chat(messages, tools, onDelta, onReasoning, onUsage, signal, providerConfig, onToolDelta) {
  const cfg = config.load();
  const apiKey = (providerConfig && providerConfig.apiKey) || cfg.apiKey;
  const baseUrl = (providerConfig && providerConfig.baseUrl) || cfg.baseUrl;
  const model = (providerConfig && providerConfig.model) || cfg.model;
  const maxTokens = (providerConfig && providerConfig.maxTokens) || cfg.maxTokens || 4096;
  const temperature = (providerConfig && providerConfig.temperature != null) ? providerConfig.temperature : (cfg.temperature != null ? cfg.temperature : 0.6);

  const url = `${baseUrl}/chat/completions`;

  // Build system prompt dynamically based on available tools
  const systemPrompt = buildSystemPrompt(tools || []);
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const body = {
    model,
    messages: apiMessages,
    max_tokens: maxTokens,
    temperature,
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

  if (providerConfig && providerConfig.reasoningEffort) {
    body.reasoning_effort = providerConfig.reasoningEffort;
    body.thinking = { type: 'enabled' };
  }

  logger.logRequest(body.messages);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.logError('api_error', `HTTP ${resp.status}: ${text}`);
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const result = await parseChatCompletionStream(resp.body.getReader(), {
    onDelta,
    onReasoning,
    onUsage,
    onToolDelta,
    onParseError: (line) => logger.logError('sse_parse', `Malformed SSE line: ${line.slice(0, 200)}`),
  });

  logger.logResponse(result);
  return result;
}

module.exports = { chat };
