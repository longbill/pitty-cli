const fs = require('fs');
const path = require('path');

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
      // Simple recursive glob implementation for basic patterns
      const walkDir = (dirPath, relativePath = '') => {
        let entries;
        try {
          entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

          if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            walkDir(fullPath, relPath);
          } else {
            results.push(fullPath);
          }
        }
      };

      if (pattern.startsWith('**/')) {
        walkDir(dir);
        const suffix = pattern.slice(3);
        const filtered = results.filter(f => f.endsWith(suffix) || f.includes(suffix));
        return { files: filtered.slice(0, 200), count: filtered.length };
      }

      if (pattern.includes('*')) {
        walkDir(dir);
        const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
        const filtered = results.filter(f => regex.test(f));
        return { files: filtered.slice(0, 200), count: filtered.length };
      }

      const fullPath = path.resolve(dir, pattern);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          results.push(fullPath);
        }
      }
      return { files: results.slice(0, 200), count: results.length };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
