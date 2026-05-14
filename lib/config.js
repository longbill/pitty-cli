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
  try {
    let existingLines = null;
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      existingLines = content.split('\n');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const newLines = [];
    if (!existingLines) {
      // New file — write from scratch
      for (const [key, value] of Object.entries(cfg)) {
        if (key === 'tools' || key === 'provider') continue;
        newLines.push(`${key} = ${value}`);
      }
      if (cfg.provider) {
        for (const [name, p] of Object.entries(cfg.provider)) {
          newLines.push(`\n[provider.${name}]`);
          for (const [k, v] of Object.entries(p)) {
            if (Array.isArray(v)) newLines.push(`${k} = ${v.join(',')}`);
            else newLines.push(`${k} = ${v}`);
          }
        }
      }
      fs.writeFileSync(CONFIG_PATH, newLines.join('\n'), 'utf-8');
      return;
    }

    // ── Update existing file, preserving comments ──

    // Helper: replace a key=value line, skip comments/sections
    function replaceVal(lines, targetKey, newVal, start, end) {
      for (let i = start; i < end; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('[')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        if (trimmed.slice(0, eqIdx).trim() !== targetKey) continue;
        const rest = trimmed.slice(eqIdx + 1);
        const comment = rest.includes(';') ? ' ;' + rest.split(';').slice(1).join(';') : '';
        lines[i] = `${targetKey} = ${newVal}${comment}`;
        return true;
      }
      return false;
    }

    // 1. Top-level keys
    const topStart = 0;
    let topEnd = existingLines.findIndex(l => l.trim().startsWith('['));
    if (topEnd === -1) topEnd = existingLines.length;

    const pendingTop = [];
    for (const [key, value] of Object.entries(cfg)) {
      if (key === 'tools' || key === 'provider') continue;
      const strVal = String(value);
      if (!replaceVal(existingLines, key, strVal, topStart, topEnd)) {
        pendingTop.push(`${key} = ${strVal}`);
      }
    }
    if (pendingTop.length > 0) {
      existingLines.splice(topEnd, 0, ...pendingTop);
      topEnd += pendingTop.length;
    }

    // 2. Provider sections
    if (cfg.provider) {
      for (const [name, p] of Object.entries(cfg.provider)) {
        const header = `[provider.${name}]`;
        let secStart = -1;
        for (let i = 0; i < existingLines.length; i++) {
          if (existingLines[i].trim() === header) { secStart = i; break; }
        }

        if (secStart !== -1) {
          let secEnd = existingLines.length;
          for (let i = secStart + 1; i < existingLines.length; i++) {
            if (existingLines[i].trim().startsWith('[')) { secEnd = i; break; }
          }
          const pending = [];
          for (const [k, v] of Object.entries(p)) {
            const strVal = Array.isArray(v) ? v.join(',') : String(v);
            if (!replaceVal(existingLines, k, strVal, secStart + 1, secEnd)) {
              pending.push(`${k} = ${strVal}`);
            }
          }
          if (pending.length > 0) {
            existingLines.splice(secEnd, 0, ...pending);
          }
        } else {
          existingLines.push('', header);
          for (const [k, v] of Object.entries(p)) {
            const strVal = Array.isArray(v) ? v.join(',') : String(v);
            existingLines.push(`${k} = ${strVal}`);
          }
        }
      }
    }

    fs.writeFileSync(CONFIG_PATH, existingLines.join('\n'), 'utf-8');
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
  const val = load().accept_all_wait_seconds;
  return val != null ? val : 5;
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
