const fs = require('fs');
const path = require('path');
const { assertAllowedPath } = require('../safePath.js');

const MAX_BYTES = 1 * 1024 * 1024; // 1MB

async function readBounded(filePath, maxBytes) {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fd.read(buf, 0, maxBytes, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    await fd.close();
  }
}

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
  async execute(args) {
    const filePath = path.resolve(args.file_path);

    try {
      assertAllowedPath(filePath);

      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        const { _ } = require('../lang/index.js');
        return { error: _('toolErrors.notFile', filePath) };
      }

      let content;
      if (args.offset !== undefined && args.limit !== undefined) {
        // For offset/limit, need full line structure — use bounded approach
        if (stat.size > MAX_BYTES) {
          const { _ } = require('../lang/index.js');
          return { error: _('toolErrors.fileTooLarge', filePath) };
        }
        const allLines = fs.readFileSync(filePath, 'utf-8').split('\n');
        content = allLines.slice(args.offset, args.offset + args.limit).join('\n');
      } else {
        content = await readBounded(filePath, MAX_BYTES);
      }

      if (stat.size > MAX_BYTES) {
        const { _ } = require('../lang/index.js');
        content += '\n' + _('toolErrors.truncatedAt', MAX_BYTES);
      }

      return { content, size: stat.size, path: filePath, _mtime: stat.mtimeMs };
    } catch (err) {
      if (err.message.startsWith('Path not allowed')) {
        return { error: err.message };
      }
      return { error: err.message };
    }
  },
};

module.exports = tool;
