const fs = require('fs');
const path = require('path');
const os = require('os');

function isAllowedPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const allowed = [
    process.cwd(),
    os.homedir(),
    '/tmp',
  ];

  // Resolve symlinks too (/tmp may be a symlink)
  const realPaths = allowed.map(p => {
    try { return fs.realpathSync(p); } catch { return p; }
  });
  const allPrefixes = allowed.concat(realPaths).map(p => path.resolve(p));
  // Remove root prefix '/' since it would allow everything
  const filtered = allPrefixes.filter(p => p !== '/');
  const unique = [...new Set(filtered)];

  return unique.some(prefix => resolved === prefix || resolved.startsWith(prefix + path.sep));
}

function assertAllowedPath(targetPath) {
  if (!isAllowedPath(targetPath)) {
    throw new Error(`Path not allowed: ${targetPath}`);
  }
}

module.exports = { isAllowedPath, assertAllowedPath };
