const path = require('path');
const backgroundTasks = require('../backgroundTasks.js');

module.exports = {
  name: 'BackgroundCreate',
  description: 'Create a background shell task. Use this for long-running commands that should continue while the conversation proceeds.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run in the background' },
      workdir: { type: 'string', description: 'Working directory (default: current)' },
    },
    required: ['command'],
  },
  async execute(args) {
    const cwd = path.resolve(args.workdir || process.cwd());
    const task = backgroundTasks.createBackgroundTask({
      command: args.command,
      cwd,
      env: { ...process.env, TERM: 'dumb' },
    });
    return {
      taskId: task.id,
      command: task.command,
      cwd: task.cwd,
      status: task.status,
      message: `后台任务已创建。任务 ID: ${task.id}。停止任务: BackgroundStop({ taskId: "${task.id}" })。读取输出: BackgroundRead({ taskId: "${task.id}" })。`,
    };
  },
};
