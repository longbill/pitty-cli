const fs = require('fs');
const path = require('path');

const tool = {
  name: 'Edit',
  description: 'Perform a targeted edit on a file by replacing an exact string match. Use this to make surgical changes without rewriting the whole file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to edit' },
      old_string: { type: 'string', description: 'The exact text to find and replace' },
      new_string: { type: 'string', description: 'The replacement text' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  execute(args) {
    const filePath = path.resolve(args.file_path);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const idx = content.indexOf(args.old_string);

      if (idx === -1) {
        return { error: `Could not find old_string in ${filePath}` };
      }

      const newContent = content.replace(args.old_string, args.new_string);
      fs.writeFileSync(filePath, newContent, 'utf-8');

      const stat = fs.statSync(filePath);
      return { path: filePath, size: stat.size, replaced: 1, ok: true };
    } catch (err) {
      return { error: err.message };
    }
  },
};

module.exports = tool;
