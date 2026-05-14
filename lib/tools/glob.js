const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { ensureRg } = require('../rg.js');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20 * 1024 * 1024;
const RG_TIMEOUT = 30000;
const DEFAULT_LIMIT = 100;

const tool = {
  name: 'Glob',
  description: 'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time. If ripgrep is not installed, use the Bash tool with \`find\` instead.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The glob pattern to match files against (e.g. "**/*.js")' },
      path: { type: 'string', description: 'The directory to search in (default: current working directory)' },
      limit: { type: 'number', description: 'Maximum number of results to return (default: 100)' },
      offset: { type: 'number', description: 'Skip the first N results. Used with limit for pagination.' },
    },
    required: ['pattern'],
  },
  async execute(args, opts) {
    const available = await ensureRg();
    if (!available) {
      return {
        error: '系统未安装 ripgrep (rg)，无法使用 Glob 工具。请使用 Bash 工具执行 find 命令，或安装 ripgrep（https://github.com/BurntSushi/ripgrep#installation）以加速搜索。',
        rgAvailable: false,
      };
    }

    try {
      const searchDir = args.path ? path.resolve(args.path) : process.cwd();
      const limit = args.limit ?? DEFAULT_LIMIT;
      const offset = args.offset || 0;

      // Verify directory exists
      try {
        const stat = await fs.promises.stat(searchDir);
        if (!stat.isDirectory()) {
          return { error: `路径不是目录: ${searchDir}` };
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { error: `目录不存在: ${searchDir}` };
        }
        throw err;
      }

      // Build rg args: list files matching the glob pattern
      const rgArgs = [
        '--files',
        '--glob', args.pattern,
        searchDir,
      ];

      const { stdout } = await execFileAsync('rg', rgArgs, {
        maxBuffer: MAX_BUFFER,
        timeout: RG_TIMEOUT,
        signal: opts?.signal,
      });

      // Filter out hidden files and node_modules (rg doesn't exclude these by default)
      const allPaths = stdout.trim().split('\n').filter(Boolean)
        .filter(p => !p.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules'));

      const truncated = allPaths.length > offset + limit;
      const sliced = allPaths.slice(offset, offset + limit);

      // Convert to absolute paths
      const files = sliced.map(p => path.resolve(searchDir, p));

      return {
        files,
        count: allPaths.length,
        truncated,
        rgAvailable: true,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { error: '搜索已被取消' };
      }
      // Exit code 1 means "no matches found" — return empty, not an error
      if (err.code === 1) {
        return { files: [], count: 0, truncated: false, rgAvailable: true };
      }
      return { error: `搜索失败: ${err.message}` };
    }
  },
};

module.exports = tool;
