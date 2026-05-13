// Permission modes and their available tools.
// The mode determines exactly which tools the LLM sees and can call.

const MODE_TOOLS = {
  'web-only':   ['WebFetch'],
  'read-only':  ['Read', 'Glob', 'Grep', 'WebFetch'],
  'ask':        ['Read', 'Glob', 'Grep', 'WebFetch', 'Write', 'Edit', 'Bash', 'BackgroundCreate', 'BackgroundList', 'BackgroundRead', 'BackgroundStop'],
  'audit':      ['Read', 'Glob', 'Grep', 'WebFetch', 'Write', 'Edit', 'Bash', 'BackgroundCreate', 'BackgroundList', 'BackgroundRead', 'BackgroundStop'],
  'accept-all': ['Read', 'Glob', 'Grep', 'WebFetch', 'Write', 'Edit', 'Bash', 'BackgroundCreate', 'BackgroundList', 'BackgroundRead', 'BackgroundStop'],
};

const VALID_MODES = Object.keys(MODE_TOOLS);

// Tools that require confirmation in ask/accept-all mode
const CONFIRM_TOOLS = ['Write', 'Edit', 'Bash', 'BackgroundCreate', 'BackgroundStop'];

function getToolsForMode(mode) {
  return MODE_TOOLS[mode] || MODE_TOOLS['accept-all'];
}

function check(mode, toolName) {
  const tools = getToolsForMode(mode);
  if (!tools.includes(toolName)) {
    return { allowed: false, reason: `tool not available in ${mode} mode` };
  }

  if (mode === 'ask' && CONFIRM_TOOLS.includes(toolName)) {
    return { allowed: true, needConfirm: true };
  }

  if (mode === 'audit') {
    return { allowed: true, needAudit: true };
  }

  if (mode === 'accept-all' && CONFIRM_TOOLS.includes(toolName)) {
    return { allowed: true, needConfirm: true, autoAccept: true };
  }

  return { allowed: true };
}

module.exports = { MODE_TOOLS, VALID_MODES, CONFIRM_TOOLS, getToolsForMode, check };
