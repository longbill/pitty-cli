const fs = require('fs');
const path = require('path');

const tool = {
  name: 'Write',
  description: 'Write content to a file. Creates the file if it does not exist, or overwrites if it does.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['file_path', 'content'],
  },
  execute(args) {
    const filePath = path.resolve(args.file_path);

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, args.content, 'utf-8');
      const stat = fs.statSync(filePath);
      return { path: filePath, size: stat.size, ok: true };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
