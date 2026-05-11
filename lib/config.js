const fs = require('fs');
const path = require('path');
const os = require('os');
const { parse: parseIni } = require('./ini.js');

const CONFIG_PATH = path.join(os.homedir(), '.pitty.ini');
const JSON_FALLBACK_PATH = path.join(os.homedir(), '.pitty.json');

let _config = null;

function load() {
  if (_config) return _config;

  try {
    _config = parseIni(CONFIG_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Fallback to legacy JSON config
      try {
        const raw = fs.readFileSync(JSON_FALLBACK_PATH, 'utf-8');
        _config = JSON.parse(raw);
      } catch {
        _config = { tools: {} };
      }
    } else {
      const { _ } = require('./lang/index.js');
      console.error(_('config.loadFailed', CONFIG_PATH, err.message));
      process.exit(1);
    }
  }

  // Environment variable overrides
  if (process.env.PITTY_API_KEY && _config.provider) {
    for (const p of Object.values(_config.provider)) {
      p.api_key = process.env.PITTY_API_KEY;
    }
  }
  if (process.env.PITTY_MODEL_NAME) {
    _config.main_model = process.env.PITTY_MODEL_NAME;
  }

  return _config;
}

function save(cfg) {
  // Write INI format for --init
  try {
    const lines = [];
    for (const [key, value] of Object.entries(cfg)) {
      if (key === 'tools' || key === 'provider') continue;
      lines.push(`${key} = ${value}`);
    }
    if (cfg.provider) {
      for (const [name, p] of Object.entries(cfg.provider)) {
        lines.push(`\n[provider.${name}]`);
        for (const [k, v] of Object.entries(p)) {
          if (Array.isArray(v)) lines.push(`${k} = ${v.join(',')}`);
          else lines.push(`${k} = ${v}`);
        }
      }
    }
    if (cfg.tools) {
      lines.push('\n[tools]');
      for (const [k, v] of Object.entries(cfg.tools)) {
        lines.push(`${k} = ${v}`);
      }
    }
    fs.writeFileSync(CONFIG_PATH, lines.join('\n'), 'utf-8');
  } catch (err) {
    const { _ } = require('./lang/index.js');
    console.error(_('config.saveFailed', CONFIG_PATH, err.message));
  }
}

// ── New API ───────────────────────────────────────────────────────────

function resolveModel(modelRef) {
  if (!modelRef) return null;

  const slashIdx = modelRef.indexOf('/');
  if (slashIdx === -1) return null;

  const providerName = modelRef.slice(0, slashIdx);
  const modelName = modelRef.slice(slashIdx + 1);

  const cfg = load();
  const provider = cfg.provider && cfg.provider[providerName];
  if (!provider) return null;

  // Check model is in provider's model list
  if (provider.models && !provider.models.includes(modelName)) return null;

  return {
    apiKey: provider.api_key,
    baseUrl: provider.base_url,
    model: modelName,
    maxTokens: provider.max_tokens || 4096,
    temperature: provider.temperature != null ? provider.temperature : 0.6,
  };
}

function getPermissionMode() {
  return load().permission_mode || 'pass-all';
}

function getToolPermissions() {
  return load().tools || {};
}

function getMainModel() {
  return load().main_model || '';
}

function getAuditModel() {
  return load().audit_model || '';
}

function getMaxTurns() {
  return load().max_turns || 100;
}

function get(key) {
  return load()[key];
}

module.exports = {
  load, save, get, CONFIG_PATH,
  resolveModel, getPermissionMode, getToolPermissions,
  getMainModel, getAuditModel, getMaxTurns,
};
