const { spawn } = require('child_process');
const path = require('path');
const backgroundTasks = require('../backgroundTasks.js');

const MAX_OUTPUT = 10 * 1024 * 1024; // 10MB per stream

const tool = {
  name: 'Bash',
  description: 'Execute a shell command. Returns stdout, stderr, and exit code. Use this for running commands, scripts, and CLI tools.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 60000)' },
      workdir: { type: 'string', description: 'Working directory (default: current)' },
      backgroundAfter: { type: 'number', description: 'Move command to background after this many milliseconds (default: 30000)' },
    },
    required: ['command'],
  },
  async execute(args, opts = {}) {
    const cmd = args.command;
    const timeout = args.timeout || 60000;
    const backgroundAfter = args.backgroundAfter || 30000;
    const cwd = path.resolve(args.workdir || process.cwd());
    const start = Date.now();

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], {
        cwd,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        const chunk = d.toString();
        if (stdout.length < MAX_OUTPUT) {
          stdout += chunk;
          if (stdout.length > MAX_OUTPUT) {
            stdout = stdout.slice(0, MAX_OUTPUT);
          }
        }
      });

      child.stderr.on('data', (d) => {
        const chunk = d.toString();
        if (stderr.length < MAX_OUTPUT) {
          stderr += chunk;
          if (stderr.length > MAX_OUTPUT) {
            stderr = stderr.slice(0, MAX_OUTPUT);
          }
        }
      });

      let settled = false;
      const backgroundTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const task = backgroundTasks.registerBackgroundChild({
          command: cmd,
          cwd,
          child,
          stdout,
          stderr,
          startTime: new Date(start),
        });
        resolve({
          background: true,
          taskId: task.id,
          stdout: `命令已转为后台任务运行。\n任务 ID: ${task.id}\n命令: ${cmd}\n停止任务: /bg stop ${task.id}\n查看任务: /bg list\n后续输出会自动注入对话上下文。`,
          stderr: '',
          exitCode: null,
          duration: `${Date.now() - start}ms`,
        });
      }, backgroundAfter);

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeout);

      if (opts.signal) {
        opts.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      }

      child.on('close', (code) => {
        clearTimeout(timer);
        clearTimeout(backgroundTimer);
        if (settled) return;
        settled = true;
        const duration = Date.now() - start;
        const truncated = stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT;
        resolve({
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 50000),
          exitCode: code,
          duration: `${duration}ms`,
          ...(truncated ? { truncated: true } : {}),
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        clearTimeout(backgroundTimer);
        if (settled) return;
        settled = true;
        resolve({ stdout: '', stderr: err.message, exitCode: -1, duration: `${Date.now() - start}ms` });
      });
    });
  },
};

module.exports = tool;
