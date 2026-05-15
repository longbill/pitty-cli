const { assertAllowedUrl } = require('../urlPolicy.js');

const MAX_RESPONSE_BYTES = 50000;

async function readLimitedText(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let bytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) truncated = true;
    if (content.length < MAX_RESPONSE_BYTES) {
      content += decoder.decode(value, { stream: true });
      if (content.length > MAX_RESPONSE_BYTES) content = content.slice(0, MAX_RESPONSE_BYTES);
    }
    if (truncated) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }

  content += decoder.decode();
  if (content.length > MAX_RESPONSE_BYTES) {
    content = content.slice(0, MAX_RESPONSE_BYTES);
    truncated = true;
  }
  return { content, truncated };
}

const tool = {
  name: 'WebFetch',
  description: 'Fetch content from a URL and return its text content. Useful for reading documentation, APIs, and web pages.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  },
  async execute(args, opts = {}) {
    try {
      await assertAllowedUrl(args.url, opts.urlPolicy);
      const signal = opts.signal || AbortSignal.timeout(15000);
      const resp = await fetch(args.url, {
        headers: { 'User-Agent': 'Pitty/1.0' },
        signal,
        redirect: 'follow',
      });
      const text = await readLimitedText(resp);
      return {
        status: resp.status,
        content: text.content,
        truncated: text.truncated,
      };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
