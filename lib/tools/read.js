const fs = require('fs');
const path = require('path');

const tool = {
  name: 'Read',
  description: 'Read the contents of a file. Lines are numbered for reference.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to read' },
      offset: { type: 'number', description: 'Starting line number (0-indexed)' },
      limit: { type: 'number', description: 'Number of lines to read' },
    },
    required: ['file_path'],
  },
  execute(args) {
    const filePath = path.resolve(args.file_path);
    const maxBytes = 1 * 1024 * 1024;

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { error: `Not a file: ${filePath}` };

      let content;
      if (args.offset !== undefined && args.limit !== undefined) {
        const allLines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const lines = allLines.slice(args.offset, args.offset + args.limit);
        content = lines.join('\n');
      } else {
        content = fs.readFileSync(filePath, 'utf-8', { maxBytes });
      }

      if (content.length > maxBytes) {
        content = content.slice(0, maxBytes) + `\n... [truncated at ${maxBytes} bytes]`;
      }

      return { content, size: stat.size, path: filePath };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
