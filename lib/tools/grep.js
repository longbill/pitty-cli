const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_RESULTS = 50;
const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_FILES_SCANNED = 1000;
const MAX_DIRS_SCANNED = 200;
const MAX_DEPTH = 12;
const MAX_DURATION_MS = 3000;
const SKIP_DIRS = new Set([
  '.cache',
  '.config',
  '.git',
  '.local',
  '.npm',
  '.pnpm-store',
  '.ssh',
  '.vscode-server',
  'Library',
  'dist',
  'build',
  'coverage',
  'node_modules',
]);

// Detect if a pattern looks like a regex: starts and ends with /
// Must be at least 2 chars like /a/, and the first char after opening / should not be a common path-start char
function looksLikeRegex(str) {
  if (typeof str !== 'string' || str.length < 3) return false;
  if (str[0] !== '/' || str[str.length - 1] !== '/') return false;
  // If stripping the slashes yields empty, not a regex
  const inner = str.slice(1, -1);
  if (!inner) return false;
  // If the inner part starts with a typical path character, treat as string
  if (/^[a-zA-Z0-9._~-]/.test(inner) && !/[\\^$*+?()|{}[\]]/.test(inner)) return false;
  return true;
}

function compilePattern(pattern) {
  if (looksLikeRegex(pattern)) {
    try {
      return new RegExp(pattern.slice(1, -1));
    } catch {
      return null;
    }
  }
  return null;
}

const tool = {
  name: 'Grep',
  description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (string or regex like /pattern/)' },
      path: { type: 'string', description: 'File or directory to search (default: current dir)' },
      include: { type: 'string', description: 'File pattern to include (e.g. "*.js")' },
      maxResults: { type: 'number', description: 'Maximum results to return (default: 50)' },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const searchPath = path.resolve(args.path || process.cwd());
    const maxResults = args.maxResults || DEFAULT_MAX_RESULTS;
    const results = [];
    const startedAt = Date.now();
    const stats = { filesScanned: 0, dirsScanned: 0, filesSkipped: 0 };
    let stoppedReason = null;

    // Compile regex once for both file and directory paths
    const regex = compilePattern(args.pattern);
    const useRegex = regex !== null;

    function lineMatches(line) {
      if (useRegex) return regex.test(line);
      return line.includes(args.pattern);
    }

    function shouldStop() {
      if (results.length >= maxResults) return true;
      if (stats.filesScanned >= MAX_FILES_SCANNED) {
        stoppedReason = `Stopped after scanning ${MAX_FILES_SCANNED} files. Narrow path/include or increase specificity.`;
        return true;
      }
      if (stats.dirsScanned >= MAX_DIRS_SCANNED) {
        stoppedReason = `Stopped after scanning ${MAX_DIRS_SCANNED} directories. Narrow the search path.`;
        return true;
      }
      if (Date.now() - startedAt > MAX_DURATION_MS) {
        stoppedReason = `Stopped after ${MAX_DURATION_MS}ms. Narrow the search path.`;
        return true;
      }
      return false;
    }

    function includeFile(fileName) {
      if (!args.include) return true;
      if (args.include.startsWith('*.')) return fileName.endsWith(args.include.slice(1));
      return fileName.endsWith(args.include.replace('*', ''));
    }

    async function searchFile(filePath) {
      if (shouldStop()) return;

      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        return;
      }

      if (!stat.isFile()) return;
      if (stat.size > MAX_FILE_BYTES) {
        stats.filesSkipped += 1;
        return;
      }

      stats.filesScanned += 1;

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (lineMatches(lines[i])) {
            results.push({ file: filePath, line: i + 1, content: lines[i].trim() });
          }
        }
      } catch {
        stats.filesSkipped += 1;
      }
    }

    try {
      const stat = await fs.promises.stat(searchPath);

      if (stat.isFile()) {
        await searchFile(searchPath);
        return { results, count: results.length, ...stats };
      }

      const walkDir = async (dirPath, depth = 0) => {
        if (shouldStop()) return;
        if (depth > MAX_DEPTH) {
          stoppedReason = `Stopped at maximum directory depth ${MAX_DEPTH}. Narrow the search path.`;
          return;
        }

        let entries;
        try {
          entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
          stats.dirsScanned += 1;
        } catch {
          return;
        }

        for (const entry of entries) {
          if (shouldStop()) return;
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            await walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            if (!includeFile(entry.name)) continue;
            await searchFile(fullPath);
          }
        }
      };

      if (stat.isDirectory()) {
        await walkDir(searchPath);
      }

      return { results, count: results.length, stoppedReason, ...stats };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
