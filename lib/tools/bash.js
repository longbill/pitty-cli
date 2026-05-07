const { execSync, spawn } = require('child_process');
const path = require('path');

const tool = {
  name: 'Bash',
  description: 'Execute a shell command. Returns stdout, stderr, and exit code. Use this for running commands, scripts, and CLI tools.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      workdir: { type: 'string', description: 'Working directory (default: current)' },
    },
    required: ['command'],
  },
  async execute(args) {
    const cmd = args.command;
    const timeout = args.timeout || 30000;
    const cwd = args.workdir || process.cwd();
    const start = Date.now();

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], {
        cwd: path.resolve(cwd),
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        const duration = Date.now() - start;
        resolve({
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 50000),
          exitCode: code,
          duration: `${duration}ms`,
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
