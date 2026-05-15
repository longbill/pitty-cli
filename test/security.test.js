const { describe, it } = require('node:test');
const assert = require('node:assert');
const { _test: urlPolicyTest } = require('../lib/urlPolicy.js');
const { _test: loggerTest } = require('../lib/logger.js');

describe('url policy', () => {
  it('identifies blocked hosts and private IP ranges', () => {
    assert.equal(urlPolicyTest.isBlockedHostLiteral('localhost'), true);
    assert.equal(urlPolicyTest.isBlockedHostLiteral('127.0.0.1'), true);
    assert.equal(urlPolicyTest.isBlockedHostLiteral('10.0.0.5'), true);
    assert.equal(urlPolicyTest.isBlockedHostLiteral('172.16.0.1'), true);
    assert.equal(urlPolicyTest.isBlockedHostLiteral('192.168.1.1'), true);
    assert.equal(urlPolicyTest.isBlockedHostLiteral('169.254.1.1'), true);
    assert.equal(urlPolicyTest.isBlockedHostLiteral('example.com'), false);
  });
});

describe('logger redaction', () => {
  it('redacts secret-like fields and inline values', () => {
    const redacted = loggerTest.redact({
      api_key: 'sk-test',
      nested: { token: 'abc' },
      command: 'curl -H "Authorization: Bearer secret-token" https://example.com',
    });

    assert.equal(redacted.api_key, '[REDACTED]');
    assert.equal(redacted.nested.token, '[REDACTED]');
    assert.equal(redacted.command.includes('secret-token'), false);
    assert.ok(redacted.command.includes('[REDACTED]'));
  });
});
