const fs = require('fs');
const path = require('path');

const tool = {
  name: 'Grep',
  description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (string or regex)' },
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

    try {
      const stat = fs.statSync(searchPath);

      if (stat.isFile()) {
        const content = fs.readFileSync(searchPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (lines[i].includes(args.pattern) || (args.pattern.startsWith('/') && new RegExp(args.pattern.slice(1, -1)).test(lines[i]))) {
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
                if (lines[i].includes(args.pattern)) {
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
