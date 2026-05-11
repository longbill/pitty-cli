function formatToolConfirmation(name, args = {}) {
  if (name === 'Bash') {
    const lines = ['Bash', '命令:', args.command || ''];
    if (args.workdir) lines.push('', `工作目录: ${args.workdir}`);
    if (args.timeout) lines.push(`超时: ${args.timeout}ms`);
    return lines.join('\n');
  }

  if (name === 'Write') {
    return ['Write', `路径: ${args.file_path || ''}`, '内容:', args.content || ''].join('\n');
  }

  if (name === 'Edit') {
    return [
      'Edit',
      `路径: ${args.file_path || ''}`,
      '查找:',
      args.old_string || '',
      '',
      '替换为:',
      args.new_string || '',
    ].join('\n');
  }

  return `${name}\n${JSON.stringify(args, null, 2)}`;
}

module.exports = { formatToolConfirmation };
