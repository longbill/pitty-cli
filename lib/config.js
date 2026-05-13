const fs = require('fs');
const path = require('path');
const os = require('os');
const { parse: parseIni } = require('./ini.js');

const CONFIG_PATH = path.join(os.homedir(), '.pitty.ini');

let _config = null;
let _permissionOverride = null;

function load() {
  if (_config) return _config;

  try {
    _config = parseIni(CONFIG_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') {
      _config = { tools: {} };
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

function reload() {
  _config = null;
  return load();
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
      // tools section no longer supported — skip
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

function setPermissionOverride(mode) {
  _permissionOverride = mode;
}

function getPermissionMode() {
  const { VALID_MODES } = require('./permission.js');
  const mode = _permissionOverride || load().permission_mode || 'read-only';
  return VALID_MODES.includes(mode) ? mode : 'read-only';
}

function getAcceptAllWaitSeconds() {
  return load().accept_all_wait_seconds || 5;
}

function getBashBackgroundAfterMs() {
  const value = load().bash_background_after_ms;
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function getMainModel() {
  return load().main_model || '';
}

function setMainModel(modelRef) {
  const cfg = load();
  cfg.main_model = modelRef;
  save(cfg);
}

function listModelRefs(cfg = load()) {
  const providers = cfg.provider || {};
  const refs = [];
  for (const [providerName, provider] of Object.entries(providers)) {
    const models = Array.isArray(provider.models) ? provider.models : [];
    for (const model of models) {
      refs.push(`${providerName}/${model}`);
    }
  }
  return refs;
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
  load, reload, save, get, CONFIG_PATH,
  resolveModel, getPermissionMode, setPermissionOverride,
  getMainModel, setMainModel, listModelRefs, getAuditModel, getMaxTurns,
  getAcceptAllWaitSeconds, getBashBackgroundAfterMs,
};
