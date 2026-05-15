const { assertAllowedUrl } = require('../urlPolicy.js');

const MAX_RESPONSE_BYTES = 50000;
const MAX_REDIRECTS = 5;
const BLOCKED_CONTENT_TYPES = [
  'application/octet-stream',
  'application/zip',
  'application/x-tar',
  'application/gzip',
];

function isBlockedContentType(contentType) {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return BLOCKED_CONTENT_TYPES.includes(normalized) ||
    normalized.startsWith('image/') ||
    normalized.startsWith('audio/') ||
    normalized.startsWith('video/');
}

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

async function fetchWithPolicy(rawUrl, opts) {
  const signal = opts.signal || AbortSignal.timeout(15000);
  let currentUrl = rawUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const url = await assertAllowedUrl(currentUrl, opts.urlPolicy);
    const resp = await fetch(url.href, {
      headers: { 'User-Agent': 'Pitty/1.0' },
      signal,
      redirect: 'manual',
    });

    if (![301, 302, 303, 307, 308].includes(resp.status)) return { resp, url: url.href, redirects };

    const location = resp.headers.get('location');
    if (!location) return { resp, url: url.href, redirects };
    currentUrl = new URL(location, url.href).href;
  }

  throw new Error(`Too many redirects: ${MAX_REDIRECTS}`);
}

function validateResponse(resp) {
  const contentType = resp.headers.get('content-type') || '';
  if (isBlockedContentType(contentType)) {
    throw new Error(`Response content type not allowed: ${contentType}`);
  }
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
      const { resp, url, redirects } = await fetchWithPolicy(args.url, opts);
      validateResponse(resp);
      const contentLength = Number(resp.headers.get('content-length'));
      const text = await readLimitedText(resp);
      return {
        status: resp.status,
        url,
        redirects,
        content: text.content,
        truncated: text.truncated || (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES),
      };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
module.exports._test = { fetchWithPolicy, readLimitedText, isBlockedContentType, validateResponse, MAX_RESPONSE_BYTES };
