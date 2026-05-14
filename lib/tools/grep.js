const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 20 * 1024 * 1024; // 20MB
const RG_TIMEOUT = 30000;

let rgChecked = false;
let rgAvailable = false;

async function ensureRg() {
  if (rgChecked) return rgAvailable;
  rgChecked = true;
  try {
    await execFileAsync('rg', ['--version'], { timeout: 3000 });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

/**
 * Parse ripgrep content-mode output into grouped results.
 * rg outputs `file:line:content` for multi-file searches, `line:content` for single-file.
 */
function parseContentOutput(stdout) {
  const groups = [];
  let currentFile = null;
  let currentLines = [];

  function flush() {
    if (currentFile && currentLines.length > 0) {
      groups.push({ file: currentFile, lines: currentLines });
      currentLines = [];
    }
  }

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const first = line.slice(0, idx);
    const rest = line.slice(idx + 1);
    // If first part is a pure integer → single-file format: line:content
    if (String(parseInt(first, 10)) === first) {
      const file = currentFile || '(unknown)';
      currentLines.push({ line: parseInt(first, 10), content: rest });
      if (!currentFile) currentFile = file;
    } else {
      // Multi-file format: file:line:content
      const idx2 = rest.indexOf(':');
      if (idx2 === -1) continue;
      const lineNum = rest.slice(0, idx2);
      const content = rest.slice(idx2 + 1);
      if (first !== currentFile) {
        flush();
        currentFile = first;
      }
      currentLines.push({ line: parseInt(lineNum, 10), content });
    }
  }
  flush();
  return groups;
}

/**
 * Build rg arguments from tool call args.
 */
function buildRgArgs(args) {
  const rgArgs = ['--no-heading', '--color', 'never'];

  if (args.output_mode === 'files_with_matches') {
    rgArgs.push('--files-with-matches');
  } else if (args.output_mode === 'count') {
    rgArgs.push('--count');
  } else {
    rgArgs.push('--line-number');
  }

  if (args['-i']) rgArgs.push('--ignore-case');
  if (args.multiline) rgArgs.push('--multiline', '--multiline-dotall');

  if (args.glob) {
    for (const g of args.glob.split(/\s+/)) {
      if (g) rgArgs.push('--glob', g);
    }
  }

  // Context lines
  if (args['-C'] != null || args.context != null) {
    rgArgs.push('-C', String(args['-C'] ?? args.context));
  } else {
    if (args['-B'] != null) rgArgs.push('-B', String(args['-B']));
    if (args['-A'] != null) rgArgs.push('-A', String(args['-A']));
  }

  // Pattern
  rgArgs.push('--', args.pattern);

  // Path (rg requires file/dir as last positional arg after --)
  if (args.path) {
    rgArgs.push(path.resolve(args.path));
  }

  return rgArgs;
}

/**
 * Apply offset and head_limit to results array.
 */
function sliceResults(results, offset, headLimit) {
  const start = offset || 0;
  const end = headLimit != null ? start + headLimit : undefined;
  return results.slice(start, end);
}

const tool = {
  name: 'Grep',
  description: `Search for patterns in file contents using ripgrep. Supports regex, glob filtering, and multiple output modes.

Usage:
- Always use Grep for search tasks instead of running \`grep\` or \`rg\` via Bash.
- Supports full regex syntax (e.g. "log.*Error", "function\\\\s+\\\\w+").
- Filter files with the glob parameter (e.g. "*.js", "*.{ts,tsx}").
- Output modes: "content" (default, shows matching lines with line numbers), "files_with_matches" (only file paths), "count" (match counts per file).
- If ripgrep is not installed, this tool will error and you should fall back to using the Bash tool with \`grep\`.`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The pattern to search for. Supports regex syntax.' },
      path: { type: 'string', description: 'File or directory to search. Defaults to current working directory.' },
      glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: '"content" shows matching lines with line numbers (default), "files_with_matches" shows only file paths, "count" shows match counts per file.',
      },
      '-B': { type: 'number', description: 'Number of lines to show before each match.' },
      '-A': { type: 'number', description: 'Number of lines to show after each match.' },
      '-C': { type: 'number', description: 'Number of lines to show before and after each match.' },
      context: { type: 'number', description: 'Alias for -C.' },
      '-i': { type: 'boolean', description: 'Case insensitive search.' },
      head_limit: { type: 'number', description: 'Maximum number of results to return. Default: 50.' },
      offset: { type: 'number', description: 'Skip first N results.' },
      multiline: { type: 'boolean', description: 'Enable multiline mode where . matches newlines and patterns can span lines.' },
    },
    required: ['pattern'],
  },
  async execute(args, opts) {
    const available = await ensureRg();
    if (!available) {
      return {
        error: '系统未安装 ripgrep (rg)，无法使用 Grep 工具。请使用 Bash 工具执行 grep 命令，或安装 ripgrep（https://github.com/BurntSushi/ripgrep#installation）以加速搜索。',
        rgAvailable: false,
      };
    }

    try {
      const rgArgs = buildRgArgs(args);
      const searchPath = path.resolve(args.path || process.cwd());

      // Check that the search path exists
      try {
        await fs.promises.stat(searchPath);
      } catch {
        return { error: `路径不存在: ${searchPath}` };
      }

      const { stdout } = await execFileAsync('rg', rgArgs, {
        maxBuffer: MAX_BUFFER,
        timeout: RG_TIMEOUT,
        signal: opts?.signal,
      });

      const headLimit = args.head_limit ?? 50;
      const offset = args.offset || 0;

      if (args.output_mode === 'files_with_matches') {
        const files = stdout.trim().split('\n').filter(Boolean);
        const sliced = sliceResults(files, offset, headLimit);
        return {
          results: sliced,
          count: sliced.length,
          fileCount: sliced.length,
          rgAvailable: true,
        };
      }

      if (args.output_mode === 'count') {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const counts = [];
        let total = 0;
        for (const line of lines) {
          const idx = line.lastIndexOf(':');
          if (idx === -1) continue;
          const file = line.slice(0, idx);
          const num = parseInt(line.slice(idx + 1), 10) || 0;
          counts.push({ file, count: num });
          total += num;
        }
        const sliced = sliceResults(counts, offset, headLimit);
        return {
          results: sliced,
          count: total,
          fileCount: sliced.length,
          rgAvailable: true,
        };
      }

      // Content mode
      const groups = parseContentOutput(stdout);

      // Flatten all matches across groups, apply offset/head_limit, then re-group
      const allMatches = [];
      for (const group of groups) {
        for (const l of group.lines) {
          allMatches.push({ file: group.file, line: l.line, content: l.content });
        }
      }
      const totalMatchesAll = allMatches.length;
      const sliced = sliceResults(allMatches, offset, headLimit);

      // Format output (re-group by file for display)
      const formatted = [];
      let currentFile = null;
      for (const m of sliced) {
        if (m.file !== currentFile) {
          if (formatted.length > 0) formatted.push('--');
          formatted.push(`File: ${m.file}`);
          currentFile = m.file;
        }
        formatted.push(`  ${m.line}\t${m.content}`);
      }

      // Collect unique file count after slicing
      const fileSet = new Set(sliced.map(m => m.file));

      return {
        results: formatted.join('\n'),
        count: sliced.length,
        fileCount: fileSet.size,
        totalFileCount: groups.length,
        rgAvailable: true,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { error: '搜索已被取消' };
      }
      if (err.code === 2) {
        return { error: `rg 参数错误，请检查 pattern 语法: ${err.stderr?.trim() || err.message}` };
      }
      return { error: `搜索失败: ${err.message}` };
    }
  },
};

module.exports = tool;
