const { spawn } = require('child_process');
const path = require('path');

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
    },
    required: ['command'],
  },
  async execute(args, opts = {}) {
    const cmd = args.command;
    const timeout = args.timeout || 60000;
    const cwd = args.workdir || process.cwd();
    const start = Date.now();

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], {
        cwd: path.resolve(cwd),
        timeout,
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

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeout);

      if (opts.signal) {
        opts.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      }

      child.on('close', (code) => {
        clearTimeout(timer);
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
        resolve({ stdout: '', stderr: err.message, exitCode: -1, duration: `${Date.now() - start}ms` });
      });
    });
  },
};

module.exports = tool;
