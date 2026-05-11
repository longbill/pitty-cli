const config = require('../config.js');

const locales = { zh: require('./zh.js'), en: require('./en.js') };

function getLocale() {
  const lang = config.get('lang') || 'zh';
  return locales[lang] || locales.zh;
}

// Tool label: t('Read', { file_path: '...' })
function t(name, args) {
  const locale = getLocale();
  const fn = locale[name] || locale.default;
  return fn === locale.default ? fn(name, args) : fn(args);
}

// UI string lookup: _('ui.chat.thinking') or _('system.identity')
// Supports dot-path traversal and function calls with args
function _(path, ...args) {
  const locale = getLocale();
  const keys = path.split('.');
  let val = locale;
  for (const key of keys) {
    if (val == null) return path;
    val = val[key];
  }
  if (typeof val === 'function') return val(...args);
  return val ?? path;
}

// For template strings that need interpolation: _fmt('ui.cli.error', { msg: '...' })
function _fmt(path, vars) {
  let template = _(path);
  for (const [key, val] of Object.entries(vars || {})) {
    template = template.replace(`{${key}}`, val);
  }
  return template;
}

module.exports = { t, _, _fmt, getLocale };
