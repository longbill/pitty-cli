const backgroundTasks = require('../backgroundTasks.js');

module.exports = {
  name: 'BackgroundList',
  description: 'List background tasks and their current status.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute() {
    return {
      tasks: backgroundTasks.listTasks().map(task => ({
        taskId: task.id,
        command: task.command,
        cwd: task.cwd,
        status: task.status,
        exitCode: task.exitCode,
        durationSeconds: Math.round(((task.endTime || new Date()) - task.startTime) / 1000),
        hasOutput: Boolean(task.stdout || task.stderr),
      })),
    };
  },
};
