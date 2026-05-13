const { spawn } = require('child_process');
const path = require('path');
const backgroundTasks = require('../backgroundTasks.js');
const config = require('../config.js');

const MAX_OUTPUT = 10 * 1024 * 1024; // 10MB per stream

function parseDurationMs(value, unit = 's') {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return n * 1000;
}

function estimateBashCommandDuration(command, thresholdMs = config.getBashBackgroundAfterMs()) {
  const cmd = String(command || '').trim();
  if (!cmd) return { mayExceedThreshold: false, estimatedMs: 0, reason: 'empty command' };

  const sleepMatches = [...cmd.matchAll(/(?:^|[;&|({\s])sleep\s+([0-9]+(?:\.[0-9]+)?)([smhd]?)(?=$|[;&|)}\s])/g)];
  if (sleepMatches.length > 0) {
    const totalMs = sleepMatches.reduce((sum, match) => sum + (parseDurationMs(match[1], match[2] || 's') || 0), 0);
    if (totalMs > thresholdMs) {
      return { mayExceedThreshold: true, estimatedMs: totalMs, reason: 'sleep duration exceeds configured threshold' };
    }
  }

  const longRunningPatterns = [
    { regex: /(?:^|\s)(tail\s+-(?:f|F)|tail\s+.*\s-(?:f|F))(?:\s|$)/, reason: 'tail follow command' },
    { regex: /(?:^|\s)watch\s+/, reason: 'watch command' },
    { regex: /(?:^|\s)(top|htop|btop)(?:\s|$)/, reason: 'interactive monitor command' },
    { regex: /(?:^|\s)yes(?:\s|$)/, reason: 'continuous output command' },
    { regex: /(?:^|\s)ping\s+(?![^;&|]*\s-c\s*\d+)/, reason: 'ping without count limit' },
    { regex: /(?:^|\s)(npm|pnpm|yarn|bun)\s+run\s+(dev|serve|start)(?:\s|$)/, reason: 'development server command' },
    { regex: /(?:^|\s)(npm|pnpm|yarn|bun)\s+(dev|serve|start)(?:\s|$)/, reason: 'development server command' },
    { regex: /(?:^|\s)(vite|next\s+dev|nuxt\s+dev|astro\s+dev)(?:\s|$)/, reason: 'development server command' },
    { regex: /(?:^|\s)(python3?|uvicorn|gunicorn)\s+.*(?:http\.server|--reload|runserver)/, reason: 'server command' },
    { regex: /(?:^|\s)docker\s+compose\s+up(?![^;&|]*\s-d(?:\s|$))/, reason: 'foreground docker compose command' },
  ];

  for (const pattern of longRunningPatterns) {
    if (pattern.regex.test(cmd)) {
      return { mayExceedThreshold: true, estimatedMs: null, reason: pattern.reason };
    }
  }

  return { mayExceedThreshold: false, estimatedMs: null, reason: 'no long-running pattern matched' };
}

function formatBackgroundMessage({ taskId, command, reason }) {
  return `${reason}\n任务 ID: ${taskId}\n命令: ${command}\n后台任务运行结束后，会自动通知你。你现在不需要做任何操作。`;
}

function formatSeconds(ms) {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(2)));
}

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
    const configuredBackgroundAfter = config.getBashBackgroundAfterMs();
    const backgroundAfter = args.backgroundAfter || configuredBackgroundAfter;
    const cwd = path.resolve(args.workdir || process.cwd());
    const start = Date.now();
    const estimate = estimateBashCommandDuration(cmd, configuredBackgroundAfter);

    if (estimate.mayExceedThreshold) {
      const task = backgroundTasks.createBackgroundTask({
        command: cmd,
        cwd,
        env: { ...process.env, TERM: 'dumb' },
      });
      return {
        background: true,
        taskId: task.id,
        stdout: formatBackgroundMessage({
          taskId: task.id,
          command: cmd,
          reason: `预计命令可能会运行超过${formatSeconds(configuredBackgroundAfter)}秒，已转为后台继续运行。`,
        }),
        stderr: '',
        exitCode: null,
        duration: `${Date.now() - start}ms`,
      };
    }

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], {
        cwd,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let backgroundTask = null;

      child.stdout.on('data', (d) => {
        const chunk = d.toString();
        if (stdout.length < MAX_OUTPUT) {
          stdout += chunk;
          if (stdout.length > MAX_OUTPUT) {
            stdout = stdout.slice(0, MAX_OUTPUT);
          }
        }
        if (backgroundTask) {
          backgroundTask.stdout += chunk;
          backgroundTasks.notifyTaskOutput(backgroundTask);
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
        if (backgroundTask) {
          backgroundTask.stderr += chunk;
          backgroundTasks.notifyTaskOutput(backgroundTask);
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
          captureOutput: false,
        });
        backgroundTask = task;
        resolve({
          background: true,
          taskId: task.id,
          stdout: formatBackgroundMessage({
            taskId: task.id,
            command: cmd,
            reason: `命令已经运行了${formatSeconds(backgroundAfter)}秒，已转为后台任务继续运行。`,
          }),
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
