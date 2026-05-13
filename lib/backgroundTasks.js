const { spawn } = require('child_process');

let nextTaskNumber = 1;
const tasks = new Map();
const listeners = new Set();
const outputNotifyTimers = new WeakMap();

function notifyTaskUpdate(event) {
  for (const listener of listeners) listener(event);
}

function notifyTaskOutput(task) {
  if (outputNotifyTimers.has(task)) return;
  const timer = setTimeout(() => {
    outputNotifyTimers.delete(task);
    notifyTaskUpdate({ type: 'output', task });
  }, 100);
  outputNotifyTimers.set(task, timer);
}

function onTaskUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function registerBackgroundChild({ command, cwd, child, stdout = '', stderr = '', startTime = new Date(), captureOutput = true }) {
  const id = `bg_${nextTaskNumber++}`;
  const task = {
    id,
    command,
    cwd,
    startTime,
    endTime: null,
    status: 'running',
    exitCode: null,
    stdout,
    stderr,
    stdoutOffset: 0,
    stderrOffset: 0,
    child,
  };
  tasks.set(id, task);

  if (captureOutput) {
    child.stdout.on('data', (d) => { task.stdout += d.toString(); notifyTaskOutput(task); });
    child.stderr.on('data', (d) => { task.stderr += d.toString(); notifyTaskOutput(task); });
  }
  child.on('close', (code) => {
    task.status = task.status === 'stopped' ? 'stopped' : 'completed';
    task.exitCode = code;
    task.endTime = new Date();
    const outputTimer = outputNotifyTimers.get(task);
    if (outputTimer) {
      clearTimeout(outputTimer);
      outputNotifyTimers.delete(task);
    }
    notifyTaskUpdate({ type: 'exit', task });
  });
  child.on('error', (err) => {
    task.status = 'failed';
    task.exitCode = -1;
    task.endTime = new Date();
    task.stderr += err.message;
    const outputTimer = outputNotifyTimers.get(task);
    if (outputTimer) {
      clearTimeout(outputTimer);
      outputNotifyTimers.delete(task);
    }
    notifyTaskUpdate({ type: 'exit', task });
  });

  return task;
}

function createBackgroundTask({ command, cwd, env }) {
  const child = spawn('bash', ['-c', command], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return registerBackgroundChild({ command, cwd, child });
}

function getTask(id) {
  return tasks.get(id) || null;
}

function listTasks() {
  return [...tasks.values()];
}

function stopTask(id) {
  const task = getTask(id);
  if (!task) return false;
  if (task.status === 'running') {
    task.child.kill('SIGTERM');
    task.status = 'stopped';
    task.endTime = new Date();
  }
  return true;
}

function consumeTaskDeltas() {
  const deltas = [];
  for (const task of tasks.values()) {
    const stdout = task.stdout.slice(task.stdoutOffset);
    const stderr = task.stderr.slice(task.stderrOffset);
    task.stdoutOffset = task.stdout.length;
    task.stderrOffset = task.stderr.length;
    if (!stdout && !stderr && task.status === 'running') continue;
    deltas.push({
      id: task.id,
      command: task.command,
      cwd: task.cwd,
      status: task.status,
      startTime: task.startTime,
      endTime: task.endTime || new Date(),
      exitCode: task.exitCode,
      output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
    });
  }
  return deltas;
}

function resetForTests() {
  for (const task of tasks.values()) {
    if (task.status === 'running') task.child.kill('SIGTERM');
  }
  tasks.clear();
  nextTaskNumber = 1;
}

function formatDurationSeconds(startTime, endTime = new Date()) {
  return Math.round((endTime - startTime) / 1000);
}

function formatTaskOutput(task, output) {
  const attrs = [`TASK_ID="${task.id}"`, `COMMAND="${task.command}"`, `CWD="${task.cwd}"`, `STATUS="${task.status}"`];
  if (task.status !== 'running') attrs.push(`EXIT_CODE="${task.exitCode}"`);
  attrs.push(`START_TIME="${task.startTime.toISOString()}"`);
  return `[${attrs.join(' ')}]\n${output}\n[END_OF_TASK_OUTPUT DURATION_SECONDS="${formatDurationSeconds(task.startTime, task.endTime || new Date())}"]`;
}

function readTaskOutput(id, opts = {}) {
  const task = getTask(id);
  if (!task) return null;
  const maxChars = opts.maxChars || 10000;
  const stdout = task.stdout;
  const stderr = task.stderr ? `\n[stderr]\n${task.stderr}` : '';
  let output = stdout + stderr;
  let truncated = false;
  if (output.length > maxChars) {
    output = output.slice(-maxChars);
    truncated = true;
  }
  return {
    task,
    output,
    truncated,
    formatted: formatTaskOutput(task, output),
  };
}

module.exports = {
  createBackgroundTask,
  registerBackgroundChild,
  getTask,
  listTasks,
  stopTask,
  readTaskOutput,
  formatTaskOutput,
  consumeTaskDeltas,
  notifyTaskUpdate,
  notifyTaskOutput,
  onTaskUpdate,
  resetForTests,
};
