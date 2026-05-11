const os = require('os');
const fs = require('fs');
const { _ } = require('./lang/index.js');
const { buildPittyMdPrompt } = require('./memory.js');

let _cachedPrompt = null;

function buildSystemPrompt(tools) {
  if (_cachedPrompt) return _cachedPrompt;

  const toolNames = tools.map(t => t.name);
  const hasBash = toolNames.includes('Bash');
  const hasRead = toolNames.includes('Read');
  const hasWrite = toolNames.includes('Write');
  const hasEdit = toolNames.includes('Edit');
  const hasGlob = toolNames.includes('Glob');
  const hasGrep = toolNames.includes('Grep');
  const hasWebFetch = toolNames.includes('WebFetch');

  const cwd = process.cwd();
  const isGit = fs.existsSync('.git');

  const pittyMdContent = buildPittyMdPrompt(cwd);

  const sections = [
    _('system.identity'),
    _('system.system'),
    _('system.doingTasks'),
    _('system.codeStyle'),
    _('system.actions'),
    buildUsingToolsSection({ hasBash, hasRead, hasWrite, hasEdit, hasGlob, hasGrep }),
    _('system.toneAndStyle'),
    ...(pittyMdContent ? [pittyMdContent] : []),
    buildEnvSection(cwd, isGit),
  ];

  _cachedPrompt = sections.join('\n\n');
  return _cachedPrompt;
}

function buildUsingToolsSection({ hasBash, hasRead, hasWrite, hasEdit, hasGlob, hasGrep }) {
  const ut = _('system.usingTools');
  const lines = [ut.title];

  // We have to access the lang pack directly for sub-items
  const locale = require('./lang/index.js').getLocale();

  const subItems = [];
  if (hasRead) subItems.push(locale.system.usingTools.read);
  if (hasEdit) subItems.push(locale.system.usingTools.edit);
  if (hasWrite) subItems.push(locale.system.usingTools.write);
  if (hasGlob) subItems.push(locale.system.usingTools.glob);
  if (hasGrep) subItems.push(locale.system.usingTools.grep);
  if (hasBash) subItems.push(locale.system.usingTools.bash);

  if (subItems.length > 0) {
    lines.push(ut.intro);
    for (const item of subItems) {
      lines.push(`  - ${item}`);
    }
  }

  lines.push(ut.ruleCall);
  lines.push(ut.ruleParallel);
  lines.push(ut.ruleOrder);

  return lines.join('\n');
}

function buildEnvSection(cwd, isGit) {
  const { getLocale } = require('./lang/index.js');
  const localeObj = getLocale();
  const dateLocale = localeObj.locale || 'zh-CN';
  const lines = [
    `# ${_('system.env.title')}`,
    `${_('system.env.cwd')}: ${cwd}`,
    `${_('system.env.isGit')}: ${isGit ? _('system.env.yes') : _('system.env.no')}`,
    `${_('system.env.platform')}: ${os.platform()}`,
    `${_('system.env.release')}: ${os.release()}`,
    `${_('system.env.shell')}: ${process.env.SHELL || os.userInfo().shell || 'bash'}`,
    `${_('system.env.date')}: ${new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`,
  ];
  return lines.join('\n');
}

module.exports = { buildSystemPrompt };
