const fs = require('fs');
const path = require('path');
const { assertAllowedPath } = require('../safePath.js');
const { findLastMtime } = require('./mtime.js');

const MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1GB

const tool = {
  name: 'Edit',
  description: 'Perform a targeted edit on a file by replacing an exact string match. Use this to make surgical changes without rewriting the whole file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to edit' },
      old_string: { type: 'string', description: 'The exact text to find and replace' },
      new_string: { type: 'string', description: 'The replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences instead of just the first. Use only when you are certain all instances should be changed.' },
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

      // Reject files over 1GB
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_BYTES) {
        return { error: `文件 ${filePath} 过大（${stat.size} 字节），无法编辑` };
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Count and validate matches
      let count = 0;
      let idx = -1;
      while ((idx = content.indexOf(args.old_string, idx + 1)) !== -1) count++;

      if (count === 0) {
        const { _ } = require('../lang/index.js');
        return { error: _('toolErrors.notFound', filePath) };
      }

      if (!args.replace_all && count > 1) {
        return { error: `old_string 在文件中匹配了 ${count} 次，请提供更多上下文以确保精确匹配（或设置 replace_all=true）` };
      }

      const newContent = args.replace_all
        ? content.replaceAll(args.old_string, args.new_string)
        : content.replace(args.old_string, args.new_string);

      fs.writeFileSync(filePath, newContent, 'utf-8');

      const newStat = fs.statSync(filePath);
      return { path: filePath, size: newStat.size, replaced: count, ok: true, _mtime: newStat.mtimeMs };
    } catch (err) {
      if (err.message.startsWith('Path not allowed')) {
        return { error: err.message };
      }
      return { error: err.message };
    }
  },
};

module.exports = tool;
