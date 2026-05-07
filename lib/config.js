const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.dsc.json');

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  maxTokens: 4096,
  temperature: 0,
  systemPrompt: `You are a coding assistant that helps users with software engineering tasks. You have access to a set of tools you can use to answer the user's question.

When the user asks you to do something, use the tools available to complete the task. You can use multiple tools in parallel if the operations are independent.

When using BashTool, execute commands directly. If a command fails, diagnose the issue and fix it.

When the task is done, summarize what you did for the user.`,
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
    return _config;
  } catch (err) {
    if (err.code === 'ENOENT') {
      _config = { ...DEFAULTS };
      save(_config);
      return _config;
    }
    console.error(`[config] Failed to load ${CONFIG_PATH}: ${err.message}`);
    process.exit(1);
  }
}

function save(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[config] Failed to save ${CONFIG_PATH}: ${err.message}`);
  }
}

function get(key) {
  const cfg = load();
  return key ? cfg[key] : cfg;
}

module.exports = { load, save, get, CONFIG_PATH };
