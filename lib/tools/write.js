const fs = require('fs');
const path = require('path');
const { assertAllowedPath } = require('../safePath.js');
const { findLastMtime } = require('./mtime.js');

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
  execute(args, opts) {
    const filePath = path.resolve(args.file_path);

    try {
      assertAllowedPath(filePath);

      // Check mtime if the file already exists
      if (fs.existsSync(filePath)) {
        const lastMtime = findLastMtime(opts?.messages, filePath);
        if (lastMtime == null) {
          return { error: `文件 ${filePath} 尚未被读取，请先用 Read 工具读取后再写入` };
        }
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs !== lastMtime) {
          return { error: `文件 ${filePath} 已被外部修改，请先用 Read 工具重新读取后再编辑` };
        }
      }

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, args.content, 'utf-8');
      const stat = fs.statSync(filePath);
      return { path: filePath, size: stat.size, ok: true, _mtime: stat.mtimeMs };
    } catch (err) {
      if (err.message.startsWith('Path not allowed')) {
        return { error: err.message };
      }
      return { error: err.message };
    }
  },
};

module.exports = tool;
