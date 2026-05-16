// Polyfill fetch for Node.js 16.
// Node 18+ has native fetch, Node 16 needs undici.
// Both provide the same WHATWG Fetch API with ReadableStream.getReader().

let _undici = null;

async function getFetch() {
  // Always check globalThis.fetch first — tests mock it dynamically
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  if (!_undici) {
    _undici = await import('undici');
  }
  return _undici.fetch;
}

async function fetch(url, opts) {
  const f = await getFetch();
  return f(url, opts);
}

module.exports = { fetch };
