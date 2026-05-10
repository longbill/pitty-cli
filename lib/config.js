const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.pitty.json');

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  maxTokens: 4096,
  maxContext: 256000,
  maxTurns: 30,
  temperature: 0,
  lang: 'zh',
  tools: {
    Bash: true,
    Read: true,
    Write: true,
    Edit: true,
    Glob: true,
    Grep: true,
    WebFetch: true,
  },
};

let _config = null;

function load() {
  if (_config) return _config;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    _config = { ...DEFAULTS, ...parsed, tools: { ...DEFAULTS.tools, ...(parsed.tools || {}) } };
  } catch (err) {
    if (err.code === 'ENOENT') {
      _config = { ...DEFAULTS };
      save(_config);
    } else {
      const { _ } = require('./lang/index.js');
      console.error(_('config.loadFailed', CONFIG_PATH, err.message));
      process.exit(1);
    }
  }

  // Environment variable overrides
  if (process.env.PITTY_API_KEY) _config.apiKey = process.env.PITTY_API_KEY;
  if (process.env.PITTY_MODEL_NAME) _config.model = process.env.PITTY_MODEL_NAME;
  if (process.env.PITTY_API_URL) _config.baseUrl = process.env.PITTY_API_URL;

  return _config;
}

function save(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (err) {
    const { _ } = require('./lang/index.js');
    console.error(_('config.saveFailed', CONFIG_PATH, err.message));
  }
}

function get(key) {
  const cfg = load();
  return key ? cfg[key] : cfg;
}

module.exports = { load, save, get, CONFIG_PATH };
