const READONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch'];
const WRITABLE_TOOLS = ['Write', 'Edit', 'Bash'];

const VALID_MODES = ['read-only', 'ask', 'audit-ask', 'audit-pass', 'pass-all'];

function validate(mode) {
  if (!VALID_MODES.includes(mode)) {
    return 'pass-all';
  }
  return mode;
}

function check(mode, toolName) {
  const m = validate(mode);

  if (m === 'read-only') {
    if (WRITABLE_TOOLS.includes(toolName)) {
      return { allowed: false, reason: 'read-only mode prohibits write tools' };
    }
    return { allowed: true, needConfirm: false, needAudit: false };
  }

  if (m === 'ask') {
    if (WRITABLE_TOOLS.includes(toolName)) {
      return { allowed: true, needConfirm: true, needAudit: false };
    }
    return { allowed: true, needConfirm: false, needAudit: false };
  }

  if (m === 'audit-ask') {
    return { allowed: true, needConfirm: false, needAudit: true };
  }

  if (m === 'audit-pass') {
    return { allowed: true, needConfirm: false, needAudit: true, autoPass: true };
  }

  // pass-all
  return { allowed: true, needConfirm: false, needAudit: false };
}

module.exports = { READONLY_TOOLS, WRITABLE_TOOLS, VALID_MODES, validate, check };
