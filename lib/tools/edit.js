const fs = require('fs');
const path = require('path');
const { assertAllowedPath } = require('../safePath.js');
const { findLastMtime } = require('./mtime.js');

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
  execute(args, opts) {
    const filePath = path.resolve(args.file_path);

    try {
      assertAllowedPath(filePath);

      // Check mtime before editing
      const lastMtime = findLastMtime(opts?.messages, filePath);
      if (lastMtime != null) {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs !== lastMtime) {
          return { error: `文件 ${filePath} 已被外部修改，请先用 Read 工具重新读取后再编辑` };
        }
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const idx = content.indexOf(args.old_string);

      if (idx === -1) {
        const { _ } = require('../lang/index.js');
        return { error: _('toolErrors.notFound', filePath) };
      }

      const newContent = content.replace(args.old_string, args.new_string);
      fs.writeFileSync(filePath, newContent, 'utf-8');

      const stat = fs.statSync(filePath);
      return { path: filePath, size: stat.size, replaced: 1, ok: true, _mtime: stat.mtimeMs };
    } catch (err) {
      if (err.message.startsWith('Path not allowed')) {
        return { error: err.message };
      }
      return { error: err.message };
    }
  },
};

module.exports = tool;
