const backgroundTasks = require('../backgroundTasks.js');

module.exports = {
  name: 'BackgroundRead',
  description: 'Read output from a background task. Returns task metadata and captured output.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Background task ID, such as bg_1' },
      maxChars: { type: 'number', description: 'Maximum output characters to return (default: 10000)' },
    },
    required: ['taskId'],
  },
  execute(args) {
    const read = backgroundTasks.readTaskOutput(args.taskId, { maxChars: args.maxChars });
    if (!read) return { error: `Background task not found: ${args.taskId}` };
    return {
      taskId: read.task.id,
      command: read.task.command,
      cwd: read.task.cwd,
      status: read.task.status,
      exitCode: read.task.exitCode,
      output: read.output,
      formatted: read.formatted,
      truncated: read.truncated,
    };
  },
};
