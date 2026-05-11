const fs = require('fs');
const path = require('path');

function escapeRegex(str) {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(pattern) {
  let result = '^';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        // **/ matches zero or more directory levels
        result += '(.*/)?';
        i += 3;
      } else {
        // ** at end matches everything
        result += '.*';
        i += 2;
      }
    } else if (pattern[i] === '*') {
      // single * matches anything except /
      result += '[^/]*';
      i += 1;
    } else if (pattern[i] === '?') {
      // ? matches single char except /
      result += '[^/]';
      i += 1;
    } else {
      result += escapeRegex(pattern[i]);
      i += 1;
    }
  }
  result += '$';
  return new RegExp(result);
}

const tool = {
  name: 'Glob',
  description: 'Search for files matching a glob pattern. Returns matching file paths.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to search (e.g. "**/*.js")' },
      directory: { type: 'string', description: 'Directory to start from (default: current)' },
    },
    required: ['pattern'],
  },
  execute(args) {
    const dir = args.directory || process.cwd();
    const pattern = args.pattern;
    const results = [];

    try {
      // If no glob metacharacters, check exact path match
      if (!pattern.includes('*') && !pattern.includes('?')) {
        const fullPath = path.resolve(dir, pattern);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            return { files: [fullPath], count: 1 };
          }
        } catch {
          // File doesn't exist
        }
        return { files: [], count: 0 };
      }

      // Verify directory exists before walking
      try {
        fs.accessSync(dir, fs.constants.R_OK);
      } catch {
        return { error: `Directory not accessible: ${dir}` };
      }

      // Walk directory and collect relative paths
      const walkDir = (dirPath, relativePath = '') => {
        let entries;
        try {
          entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dirPath, entry.name);
          const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

          if (entry.isDirectory()) {
            walkDir(fullPath, relPath);
          } else {
            results.push(relPath);
          }
        }
      };

      walkDir(dir);

      const regex = globToRegex(pattern);
      const filtered = results.filter(f => regex.test(f));
      const filePaths = filtered.slice(0, 200).map(f => path.resolve(dir, f));

      return { files: filePaths, count: filtered.length };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
