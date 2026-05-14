const os = require('os');
const fs = require('fs');
const { _, getLocale } = require('./lang/index.js');
const { buildPittyMdPrompt } = require('./memory.js');
const config = require('./config.js');

function getDistribution() {
  try {
    const content = fs.readFileSync('/etc/os-release', 'utf-8');
    const match = content.match(/^PRETTY_NAME="(.+)"$/m);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

let _cache = null; // { cwd, prompt }

function buildSystemPrompt(tools) {
  const cwd = process.cwd();
  if (_cache && _cache.cwd === cwd) return _cache.prompt;

  const toolNames = tools.map(t => t.name);
  const hasBash = toolNames.includes('Bash');
  const hasRead = toolNames.includes('Read');
  const hasWrite = toolNames.includes('Write');
  const hasEdit = toolNames.includes('Edit');
  const hasGlob = toolNames.includes('Glob');
  const hasGrep = toolNames.includes('Grep');

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
    buildEnvSection(cwd, isGit, toolNames),
  ];

  _cache = { cwd, prompt: sections.join('\n\n') };
  return _cache.prompt;
}

function buildUsingToolsSection({ hasBash, hasRead, hasWrite, hasEdit, hasGlob, hasGrep }) {
  const ut = _('system.usingTools');
  const lines = [ut.title];

  const subItems = [];
  if (hasRead) subItems.push(_('system.usingTools.read'));
  if (hasEdit) subItems.push(_('system.usingTools.edit'));
  if (hasWrite) subItems.push(_('system.usingTools.write'));
  if (hasGlob) subItems.push(_('system.usingTools.glob'));
  if (hasGrep) subItems.push(_('system.usingTools.grep'));
  if (hasBash) subItems.push(_('system.usingTools.bash'));

  if (subItems.length > 0) {
    lines.push(ut.intro);
    for (const item of subItems) {
      lines.push(`  - ${item}`);
    }
  }

  if (hasBash && ut.background) {
    lines.push(`- ${ut.background}`);
  }
  if (!hasBash && ut.noBash) {
    lines.push(`- ${ut.noBash}`);
  }

  lines.push(ut.ruleCall);
  lines.push(ut.ruleParallel);
  lines.push(ut.ruleOrder);

  return lines.join('\n');
}

function buildEnvSection(cwd, isGit, toolNames) {
  const localeObj = getLocale();
  const dateLocale = localeObj.locale || 'zh-CN';
  const mode = config.getPermissionMode();
  const lines = [
    `# ${_('system.env.title')}`,
    `${_('system.env.cwd')}: ${cwd}`,
    `${_('system.env.isGit')}: ${isGit ? _('system.env.yes') : _('system.env.no')}`,
    `${_('system.env.platform')}: ${os.platform()}`,
    `${_('system.env.distribution')}: ${getDistribution()}`,
    `${_('system.env.shell')}: ${process.env.SHELL || os.userInfo().shell || 'bash'}`,
    `${_('system.env.date')}: ${new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`,
    `${_('system.env.mode')}: ${mode}（${_('cli.modeDesc.' + mode) || ''}）`,
    `${_('system.env.tools')}: ${toolNames.join(', ')}`,
    `用户可以使用的命令（你在对话中提及即可，由用户在输入框输入）：\n${_('cli.cmdHelp')}`,
  ];
  return lines.join('\n');
}

module.exports = { buildSystemPrompt };
