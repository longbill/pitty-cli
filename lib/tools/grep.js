const fs = require('fs');
const path = require('path');

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
  execute(args) {
    const searchPath = args.path || process.cwd();
    const maxResults = args.maxResults || 50;
    const results = [];

    // Compile regex once for both file and directory paths
    const regex = compilePattern(args.pattern);
    const useRegex = regex !== null;

    function lineMatches(line) {
      if (useRegex) return regex.test(line);
      return line.includes(args.pattern);
    }

    try {
      const stat = fs.statSync(searchPath);

      if (stat.isFile()) {
        const content = fs.readFileSync(searchPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (lineMatches(lines[i])) {
            results.push({ file: searchPath, line: i + 1, content: lines[i].trim() });
          }
        }
        return { results, count: results.length };
      }

      const walkDir = (dirPath) => {
        let entries;
        try {
          entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) return;
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile()) {
            if (args.include && !entry.name.endsWith(args.include.replace('*', ''))) continue;

            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (lineMatches(lines[i])) {
                  results.push({ file: fullPath, line: i + 1, content: lines[i].trim() });
                }
              }
            } catch {
              // skip binary files
            }
          }
        }
      };

      if (stat.isDirectory()) {
        walkDir(searchPath);
      }

      return { results, count: results.length };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
