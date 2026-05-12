const backgroundTasks = require('../backgroundTasks.js');

module.exports = {
  name: 'BackgroundStop',
  description: 'Stop a running background task by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Background task ID, such as bg_1' },
    },
    required: ['taskId'],
  },
  execute(args) {
    const task = backgroundTasks.getTask(args.taskId);
    if (!task) return { ok: false, taskId: args.taskId, error: `Background task not found: ${args.taskId}` };
    if (task.status !== 'running') {
      return { ok: true, taskId: task.id, status: task.status, message: 'Task is not running' };
    }
    backgroundTasks.stopTask(task.id);
    return { ok: true, taskId: task.id, status: 'stopped' };
  },
};
