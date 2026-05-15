const dns = require('dns');
const net = require('net');

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  return normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:');
}

function isBlockedHostLiteral(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipType = net.isIP(host);
  if (ipType === 4) return isPrivateIPv4(host);
  if (ipType === 6) return isPrivateIPv6(host);
  return false;
}

async function assertAllowedUrl(rawUrl, opts = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL protocol not allowed: ${url.protocol}`);
  }

  if (isBlockedHostLiteral(url.hostname)) {
    throw new Error(`URL host not allowed: ${url.hostname}`);
  }

  if (opts.resolveDns === false) return url;

  let addresses;
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS lookup failed: ${err.message}`);
  }

  for (const item of addresses) {
    if ((item.family === 4 && isPrivateIPv4(item.address)) ||
        (item.family === 6 && isPrivateIPv6(item.address))) {
      throw new Error(`URL resolves to blocked address: ${item.address}`);
    }
  }

  return url;
}

module.exports = { assertAllowedUrl, _test: { isPrivateIPv4, isPrivateIPv6, isBlockedHostLiteral } };
