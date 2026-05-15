const { spawn } = require('child_process');
const path = require('path');
const backgroundTasks = require('../backgroundTasks.js');
const { assertAllowedPath } = require('../safePath.js');
const { killProcessTree, forceKillProcessTree } = require('../processKill.js');

const MAX_OUTPUT = 10 * 1024 * 1024; // 10MB per stream

let currentRun = null;

function formatBackgroundMessage({ taskId, command }) {
  return `已转为后台任务继续运行。\n任务 ID: ${taskId}\n命令: ${command}\n后台任务运行结束后，会自动通知你。你现在不需要做任何操作。`;
}

function moveCurrentRunToBackground() {
  if (!currentRun || currentRun.settled) return null;

  const run = currentRun;
  run.settled = true;
  clearTimeout(run.timer);

  const task = backgroundTasks.registerBackgroundChild({
    command: run.command,
    cwd: run.cwd,
    child: run.child,
    stdout: run.stdout,
    stderr: run.stderr,
    startTime: new Date(run.start),
    captureOutput: false,
  });
  run.backgroundTask = task;
  currentRun = null;

  run.resolve({
    background: true,
    taskId: task.id,
    stdout: formatBackgroundMessage({ taskId: task.id, command: run.command }),
    stderr: '',
    exitCode: null,
    duration: `${Date.now() - run.start}ms`,
  });

  return task;
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
    },
    required: ['command'],
  },
  async execute(args, opts = {}) {
    const cmd = args.command;
    const timeout = args.timeout || 60000;
    const cwd = path.resolve(args.workdir || process.cwd());
    const start = Date.now();

    try {
      assertAllowedPath(cwd);
    } catch (err) {
      return { stdout: '', stderr: err.message, exitCode: -1, duration: '0ms', error: err.message };
    }

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], {
        cwd,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      const run = {
        command: cmd,
        cwd,
        child,
        stdout: '',
        stderr: '',
        start,
        timer: null,
        settled: false,
        backgroundTask: null,
        resolve,
      };
      currentRun = run;

      child.stdout.on('data', (d) => {
        const chunk = d.toString();
        if (run.stdout.length < MAX_OUTPUT) {
          run.stdout += chunk;
          if (run.stdout.length > MAX_OUTPUT) {
            run.stdout = run.stdout.slice(0, MAX_OUTPUT);
          }
        }
        if (run.backgroundTask) {
          run.backgroundTask.stdout += chunk;
          backgroundTasks.notifyTaskOutput(run.backgroundTask);
        }
      });

      child.stderr.on('data', (d) => {
        const chunk = d.toString();
        if (run.stderr.length < MAX_OUTPUT) {
          run.stderr += chunk;
          if (run.stderr.length > MAX_OUTPUT) {
            run.stderr = run.stderr.slice(0, MAX_OUTPUT);
          }
        }
        if (run.backgroundTask) {
          run.backgroundTask.stderr += chunk;
          backgroundTasks.notifyTaskOutput(run.backgroundTask);
        }
      });

      run.timer = setTimeout(() => {
        killProcessTree(child, 'SIGTERM');
        forceKillProcessTree(child);
      }, timeout);

      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          killProcessTree(child, 'SIGTERM');
          forceKillProcessTree(child);
        }, { once: true });
      }

      child.on('close', (code) => {
        clearTimeout(run.timer);
        if (run.settled) return;
        run.settled = true;
        if (currentRun === run) currentRun = null;
        const duration = Date.now() - start;
        const truncated = run.stdout.length >= MAX_OUTPUT || run.stderr.length >= MAX_OUTPUT;
        resolve({
          stdout: run.stdout.slice(0, 50000),
          stderr: run.stderr.slice(0, 50000),
          exitCode: code,
          duration: `${duration}ms`,
          ...(truncated ? { truncated: true } : {}),
        });
      });

      child.on('error', (err) => {
        clearTimeout(run.timer);
        if (run.settled) return;
        run.settled = true;
        if (currentRun === run) currentRun = null;
        resolve({ stdout: '', stderr: err.message, exitCode: -1, duration: `${Date.now() - start}ms` });
      });
    });
  },
  moveCurrentRunToBackground,
};

module.exports = tool;
