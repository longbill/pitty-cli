const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse } = require('../lib/ini.js');

const files = [];

function writeIni(content) {
  const filePath = path.join(os.tmpdir(), `pitty-ini-${process.pid}-${files.length}.ini`);
  fs.writeFileSync(filePath, content, 'utf-8');
  files.push(filePath);
  return filePath;
}

afterEach(() => {
  while (files.length > 0) {
    fs.rmSync(files.pop(), { force: true });
  }
});

describe('ini parser', () => {
  it('parses top-level primitive values', () => {
    const file = writeIni([
      'enabled = true',
      'disabled = false',
      'count = 42',
      'negative = -7',
      'temperature = 0.6',
      'name = pitty',
    ].join('\n'));

    assert.deepEqual(parse(file), {
      enabled: true,
      disabled: false,
      count: 42,
      negative: -7,
      temperature: 0.6,
      name: 'pitty',
    });
  });

  it('parses quoted strings and comma-separated lists', () => {
    const file = writeIni([
      'double_quoted = "hello world"',
      "single_quoted = 'hello world'",
      'models = gpt-4.1, gpt-4.1-mini, deepseek-chat',
    ].join('\n'));

    assert.deepEqual(parse(file), {
      double_quoted: 'hello world',
      single_quoted: 'hello world',
      models: ['gpt-4.1', 'gpt-4.1-mini', 'deepseek-chat'],
    });
  });

  it('parses dotted sections as nested objects', () => {
    const file = writeIni([
      'main_model = openai/gpt-4.1',
      '',
      '[provider.openai]',
      'api_key = sk-test',
      'base_url = https://api.example.com',
      'models = gpt-4.1,gpt-4.1-mini',
      '',
      '[tools]',
      'enabled = true',
    ].join('\n'));

    assert.deepEqual(parse(file), {
      main_model: 'openai/gpt-4.1',
      provider: {
        openai: {
          api_key: 'sk-test',
          base_url: 'https://api.example.com',
          models: ['gpt-4.1', 'gpt-4.1-mini'],
        },
      },
      tools: { enabled: true },
    });
  });

  it('skips blank lines, comments, and malformed lines', () => {
    const file = writeIni([
      '',
      '# comment',
      '; comment',
      'not a key-value line',
      'key = value',
    ].join('\n'));

    assert.deepEqual(parse(file), { key: 'value' });
  });

  it('keeps inline comments as part of raw values', () => {
    const file = writeIni([
      'main_model = openai/gpt-4.1 # inline comment',
      'api_key = sk-test ; inline comment',
    ].join('\n'));

    assert.deepEqual(parse(file), {
      main_model: 'openai/gpt-4.1 # inline comment',
      api_key: 'sk-test ; inline comment',
    });
  });
});
