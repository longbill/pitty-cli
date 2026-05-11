const fs = require('fs');

function parseValue(raw) {
  const v = raw.trim();

  // Quoted string
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }

  // Booleans
  if (v === 'true') return true;
  if (v === 'false') return false;

  // Integer
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);

  // Float
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);

  // Comma-separated list
  if (v.includes(',')) return v.split(',').map(s => s.trim());

  return v;
}

function parse(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {};
  let currentPath = null;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    // Section header
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentPath = trimmed.slice(1, -1).trim().split('.');
      continue;
    }

    // Key-value pair
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1);
    const value = parseValue(raw);

    if (!currentPath) {
      result[key] = value;
      continue;
    }

    // Navigate to the target object, creating intermediate objects as needed
    let obj = result;
    for (const seg of currentPath) {
      if (!obj[seg] || typeof obj[seg] !== 'object' || Array.isArray(obj[seg])) {
        obj[seg] = {};
      }
      obj = obj[seg];
    }
    obj[key] = value;
  }

  return result;
}

module.exports = { parse };
