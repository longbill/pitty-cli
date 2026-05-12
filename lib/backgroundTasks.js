const { spawn } = require('child_process');

let nextTaskNumber = 1;
const tasks = new Map();
const listeners = new Set();

function notifyTaskUpdate(event) {
  for (const listener of listeners) listener(event);
}

function onTaskUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function registerBackgroundChild({ command, cwd, child, stdout = '', stderr = '', startTime = new Date() }) {
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

  child.stdout.on('data', (d) => { task.stdout += d.toString(); notifyTaskUpdate({ type: 'output', task }); });
  child.stderr.on('data', (d) => { task.stderr += d.toString(); notifyTaskUpdate({ type: 'output', task }); });
  child.on('close', (code) => {
    task.status = task.status === 'stopped' ? 'stopped' : 'completed';
    task.exitCode = code;
    task.endTime = new Date();
    notifyTaskUpdate({ type: 'exit', task });
  });
  child.on('error', (err) => {
    task.status = 'failed';
    task.exitCode = -1;
    task.endTime = new Date();
    task.stderr += err.message;
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

module.exports = {
  createBackgroundTask,
  registerBackgroundChild,
  getTask,
  listTasks,
  stopTask,
  consumeTaskDeltas,
  onTaskUpdate,
  resetForTests,
};
