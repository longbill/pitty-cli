function parseUsage(data) {
  if (!data || typeof data !== 'object') {
    return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  }

  let usage = data.usage ?? data.usageMetadata ?? data;
  if (!usage || typeof usage !== 'object') {
    return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  }

  const output_tokens =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.candidatesTokenCount ?? 0;

  let cached_input_tokens = 0;
  if (typeof usage.cache_read_input_tokens === 'number') {
    cached_input_tokens = usage.cache_read_input_tokens;
  } else if (usage.prompt_tokens_details?.cached_tokens != null) {
    cached_input_tokens = usage.prompt_tokens_details.cached_tokens;
  } else if (typeof usage.cached_tokens === 'number') {
    cached_input_tokens = usage.cached_tokens;
  }

  let input_tokens = 0;
  if (typeof usage.input_tokens === 'number') {
    input_tokens = usage.input_tokens;
  } else if (typeof usage.prompt_tokens === 'number') {
    input_tokens = Math.max(0, usage.prompt_tokens - cached_input_tokens);
  } else if (typeof usage.promptTokenCount === 'number') {
    input_tokens = usage.promptTokenCount;
  }

  return {
    input_tokens,
    output_tokens,
    cached_input_tokens,
  };
}

module.exports = { parseUsage };
