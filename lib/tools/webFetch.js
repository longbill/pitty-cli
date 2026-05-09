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
  async execute(args) {
    try {
      const resp = await fetch(args.url, {
        headers: { 'User-Agent': 'Pitty/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      const text = await resp.text();
      return {
        status: resp.status,
        content: text.slice(0, 50000),
        truncated: text.length > 50000,
      };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
