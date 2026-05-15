const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LIMIT = 5000;
const MAX_BACKGROUND_READ_CHARS = 1024 * 1024;
const MAX_CONTEXT_LINES = 1000;

function typeName(value) {
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : typeof value;
}

function expectString(args, key, errors) {
  if (args[key] !== undefined && typeof args[key] !== 'string') {
    errors.push(`${key} must be a string, got ${typeName(args[key])}`);
  }
}

function expectBoolean(args, key, errors) {
  if (args[key] !== undefined && typeof args[key] !== 'boolean') {
    errors.push(`${key} must be a boolean, got ${typeName(args[key])}`);
  }
}

function expectNonNegativeInteger(args, key, max, errors) {
  if (args[key] === undefined) return;
  if (!Number.isInteger(args[key]) || args[key] < 0) {
    errors.push(`${key} must be a non-negative integer`);
    return;
  }
  if (max != null && args[key] > max) {
    errors.push(`${key} must be <= ${max}`);
  }
}

function expectPositiveInteger(args, key, max, errors) {
  if (args[key] === undefined) return;
  if (!Number.isInteger(args[key]) || args[key] <= 0) {
    errors.push(`${key} must be a positive integer`);
    return;
  }
  if (max != null && args[key] > max) {
    errors.push(`${key} must be <= ${max}`);
  }
}

function validateToolArgs(toolName, args) {
  const errors = [];

  switch (toolName) {
    case 'Bash':
    case 'BackgroundCreate':
      expectString(args, 'command', errors);
      expectString(args, 'workdir', errors);
      expectPositiveInteger(args, 'timeout', MAX_TIMEOUT_MS, errors);
      break;
    case 'Read':
      expectString(args, 'file_path', errors);
      expectNonNegativeInteger(args, 'offset', MAX_LIMIT, errors);
      expectPositiveInteger(args, 'limit', MAX_LIMIT, errors);
      break;
    case 'Write':
      expectString(args, 'file_path', errors);
      expectString(args, 'content', errors);
      break;
    case 'Edit':
      expectString(args, 'file_path', errors);
      expectString(args, 'old_string', errors);
      expectString(args, 'new_string', errors);
      expectBoolean(args, 'replace_all', errors);
      break;
    case 'Glob':
      expectString(args, 'pattern', errors);
      expectString(args, 'path', errors);
      expectPositiveInteger(args, 'limit', MAX_LIMIT, errors);
      expectNonNegativeInteger(args, 'offset', MAX_LIMIT, errors);
      break;
    case 'Grep':
      expectString(args, 'pattern', errors);
      expectString(args, 'path', errors);
      expectString(args, 'glob', errors);
      expectString(args, 'output_mode', errors);
      expectBoolean(args, '-i', errors);
      expectBoolean(args, 'multiline', errors);
      expectPositiveInteger(args, 'head_limit', MAX_LIMIT, errors);
      expectNonNegativeInteger(args, 'offset', MAX_LIMIT, errors);
      expectNonNegativeInteger(args, '-A', MAX_CONTEXT_LINES, errors);
      expectNonNegativeInteger(args, '-B', MAX_CONTEXT_LINES, errors);
      expectNonNegativeInteger(args, '-C', MAX_CONTEXT_LINES, errors);
      expectNonNegativeInteger(args, 'context', MAX_CONTEXT_LINES, errors);
      break;
    case 'WebFetch':
      expectString(args, 'url', errors);
      break;
    case 'BackgroundRead':
      expectString(args, 'taskId', errors);
      expectPositiveInteger(args, 'maxChars', MAX_BACKGROUND_READ_CHARS, errors);
      break;
    case 'BackgroundStop':
      expectString(args, 'taskId', errors);
      break;
  }

  return errors.length > 0 ? { error: `Invalid tool arguments: ${errors.join('; ')}` } : null;
}

module.exports = { validateToolArgs, _test: { MAX_TIMEOUT_MS, MAX_LIMIT, MAX_CONTEXT_LINES, MAX_BACKGROUND_READ_CHARS } };
