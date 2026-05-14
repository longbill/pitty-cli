/**
 * 统一解析 usage，支持多种缓存格式
 */
function parseUsage(data) {
  if (!data || typeof data !== 'object') {
    return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  }

  // 支持完整 response 或直接传 usage
  let usage = data.usage ?? data.usageMetadata ?? data;
  if (!usage || typeof usage !== 'object') {
    return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  }

  // ====================== 输出 tokens ======================
  const output_tokens =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.candidatesTokenCount ?? 0;

  // ====================== 缓存 tokens ======================
  let cached_input_tokens = 0;
  if (typeof usage.cache_read_input_tokens === 'number') {
    cached_input_tokens = usage.cache_read_input_tokens;
  } else if (usage.prompt_tokens_details?.cached_tokens != null) {
    cached_input_tokens = usage.prompt_tokens_details.cached_tokens;
  } else if (typeof usage.cached_tokens === 'number') {
    cached_input_tokens = usage.cached_tokens;
  }

  // ====================== 输入 tokens ======================
  let input_tokens = 0;

  if (typeof usage.input_tokens === 'number') {
    // Anthropic 新格式：input_tokens 已经是去掉缓存的
    input_tokens = usage.input_tokens;
  } else if (typeof usage.prompt_tokens === 'number') {
    const prompt = usage.prompt_tokens;
    if (prompt < cached_input_tokens) {
      // prompt_tokens 已经是扣除缓存后的值
      input_tokens = prompt;
    } else {
      // 正常情况：扣除缓存
      input_tokens = prompt - cached_input_tokens;
    }
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
