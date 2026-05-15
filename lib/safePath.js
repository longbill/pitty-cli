const fs = require('fs');
const path = require('path');

const DEFAULT_DENY_SEGMENTS = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
]);

function pathSegments(targetPath) {
  return path.resolve(targetPath).split(path.sep).filter(Boolean);
}

function isDeniedPath(targetPath, denySegments = DEFAULT_DENY_SEGMENTS) {
  return pathSegments(targetPath).some(segment => denySegments.has(segment));
}

function resolveExistingPath(targetPath) {
  try { return fs.realpathSync(targetPath); } catch { return targetPath; }
}

function isPathInside(targetPath, rootPath) {
  const target = path.resolve(targetPath);
  const root = path.resolve(rootPath);
  if (root === '/') return false;
  return target === root || target.startsWith(root + path.sep);
}

function getAllowedRoots(opts = {}) {
  return opts.allowedRoots || [
    opts.cwd || process.cwd(),
    opts.tmpDir || '/tmp',
  ];
}

function isAllowedPath(targetPath, opts = {}) {
  const resolved = path.resolve(targetPath);
  const realTarget = resolveExistingPath(resolved);
  const denySegments = opts.denySegments || DEFAULT_DENY_SEGMENTS;

  if (isDeniedPath(resolved, denySegments) || isDeniedPath(realTarget, denySegments)) return false;

  const allowed = getAllowedRoots(opts);
  const realPaths = allowed.map(resolveExistingPath);
  const allPrefixes = allowed.concat(realPaths).map(p => path.resolve(p));
  const filtered = allPrefixes.filter(p => p !== '/' && !isDeniedPath(p, denySegments));
  const unique = [...new Set(filtered)];

  return unique.some(prefix => isPathInside(resolved, prefix) && isPathInside(realTarget, prefix));
}

function assertAllowedPath(targetPath, opts = {}) {
  if (!isAllowedPath(targetPath, opts)) {
    throw new Error(`Path not allowed: ${targetPath}`);
  }
}

function resolvePathForPolicy(targetPath) {
  const resolved = path.resolve(targetPath);
  return {
    path: resolved,
    realPath: resolveExistingPath(resolved),
  };
}

module.exports = { isAllowedPath, assertAllowedPath, resolvePathForPolicy, _test: { isDeniedPath, isPathInside, getAllowedRoots } };
