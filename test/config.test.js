const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalHome = process.env.HOME;
const originalApiKey = process.env.PITTY_API_KEY;
const originalModelName = process.env.PITTY_MODEL_NAME;

function loadConfigInTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pitty-config-test-'));
  process.env.HOME = home;
  delete require.cache[require.resolve('../lib/config.js')];
  const config = require('../lib/config.js');
  return { home, config, configPath: path.join(home, '.pitty.ini') };
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
  delete require.cache[require.resolve('../lib/config.js')];
}

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalApiKey === undefined) delete process.env.PITTY_API_KEY;
  else process.env.PITTY_API_KEY = originalApiKey;
  if (originalModelName === undefined) delete process.env.PITTY_MODEL_NAME;
  else process.env.PITTY_MODEL_NAME = originalModelName;
  delete require.cache[require.resolve('../lib/config.js')];
});

describe('config', () => {
  it('creates config files with owner-only permissions', () => {
    const { home, config, configPath } = loadConfigInTempHome();
    try {
      config.save({ main_model: 'openai/gpt-4.1' });
      const mode = fs.statSync(configPath).mode & 0o777;
      assert.equal(mode, 0o600);
    } finally {
      cleanup(home);
    }
  });

  it('updates existing config while preserving comments', () => {
    const { home, config, configPath } = loadConfigInTempHome();
    try {
      fs.writeFileSync(configPath, [
        '# top comment',
        'main_model = openai/old ; keep me',
        '',
        '[provider.openai]',
        '; provider comment',
        'api_key = old-key',
        'models = old',
      ].join('\n'), 'utf-8');

      config.save({
        main_model: 'openai/new',
        provider: { openai: { api_key: 'new-key', models: ['new', 'mini'] } },
      });

      const content = fs.readFileSync(configPath, 'utf-8');
      assert.ok(content.includes('# top comment'));
      assert.ok(content.includes('; provider comment'));
      assert.ok(content.includes('main_model = openai/new ; keep me'));
      assert.ok(content.includes('api_key = new-key'));
      assert.ok(content.includes('models = new,mini'));
    } finally {
      cleanup(home);
    }
  });

  it('applies environment overrides for api key and main model', () => {
    const { home, config, configPath } = loadConfigInTempHome();
    try {
      fs.writeFileSync(configPath, [
        'main_model = openai/from-file',
        '[provider.openai]',
        'api_key = file-key',
        'base_url = https://api.example.com',
        'models = from-env,from-file',
      ].join('\n'), 'utf-8');
      process.env.PITTY_API_KEY = 'env-key';
      process.env.PITTY_MODEL_NAME = 'openai/from-env';

      const cfg = config.reload();
      assert.equal(cfg.main_model, 'openai/from-env');
      assert.equal(cfg.provider.openai.api_key, 'env-key');
      assert.equal(config.resolveModel(config.getMainModel()).apiKey, 'env-key');
    } finally {
      cleanup(home);
    }
  });

  it('falls back to read-only for invalid permission mode', () => {
    const { home, config, configPath } = loadConfigInTempHome();
    try {
      fs.writeFileSync(configPath, 'permission_mode = root-access\n', 'utf-8');
      assert.equal(config.getPermissionMode(), 'read-only');
    } finally {
      cleanup(home);
    }
  });

  it('lists provider model references', () => {
    const { home, config } = loadConfigInTempHome();
    try {
      assert.deepEqual(config.listModelRefs({
        provider: {
          openai: { models: ['gpt-4.1', 'gpt-4.1-mini'] },
          deepseek: { models: ['deepseek-chat'] },
        },
      }), [
        'openai/gpt-4.1',
        'openai/gpt-4.1-mini',
        'deepseek/deepseek-chat',
      ]);
    } finally {
      cleanup(home);
    }
  });
});
