const fs = require('fs');
const path = require('path');
const { assertAllowedPath } = require('../safePath.js');
const config = require('../config.js');

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

// Read specific lines from a file efficiently without loading the entire file
async function readLines(filePath, offset, limit) {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fd.stat();
    const lines = [];
    let lineCount = 0;
    let buffer = '';
    let position = 0;
    let bomStripped = false;
    const chunkSize = 65536;

    while (position < stat.size) {
      const buf = Buffer.alloc(chunkSize);
      const { bytesRead } = await fd.read(buf, 0, chunkSize, position);
      position += bytesRead;

      let chunk = buf.toString('utf-8', 0, bytesRead);

      // Strip BOM from the very first chunk
      if (!bomStripped) {
        chunk = stripBom(chunk);
        bomStripped = true;
      }

      buffer += chunk;

      // Process complete lines (split by \n)
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (lineCount >= offset && lineCount < offset + limit) {
          // Strip trailing \r for Windows line endings
          lines.push(line.endsWith('\r') ? line.slice(0, -1) : line);
        }
        lineCount++;

        if (lines.length >= limit) {
          return lines;
        }
      }
    }

    // Handle last line without trailing newline
    if (lineCount >= offset && lineCount < offset + limit && buffer.length > 0) {
      lines.push(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    }

    return lines;
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
      limit: { type: 'number', description: 'Number of lines to read. Only used together with offset.' },
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

      const maxTextLength = config.get('max_read_text_length') ?? (256 * 1024);
      const maxLines = config.get('max_read_lines') ?? 2000;

      if (args.offset !== undefined && args.limit !== undefined) {
        // Line-range read
        if (args.limit > maxLines) {
          const { _ } = require('../lang/index.js');
          return { error: _('toolErrors.linesExceed', { lines: args.limit, max: maxLines }) };
        }

        const lines = await readLines(filePath, args.offset, args.limit);
        const content = lines.join('\n');

        if (Buffer.byteLength(content, 'utf-8') > maxTextLength) {
          const { _ } = require('../lang/index.js');
          return { error: _('toolErrors.contentExceeds', { size: stat.size, limit: maxTextLength }) };
        }

        return { content, size: stat.size, path: filePath, _mtime: stat.mtimeMs };
      }

      // Full read
      let content = await fs.promises.readFile(filePath, 'utf-8');
      content = stripBom(content);

      if (Buffer.byteLength(content, 'utf-8') > maxTextLength) {
        const { _ } = require('../lang/index.js');
        return { error: _('toolErrors.contentExceeds', { size: stat.size, limit: maxTextLength }) };
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
