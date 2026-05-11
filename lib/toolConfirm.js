function formatToolConfirmation(name, args = {}) {
  if (name === 'Bash') {
    const lines = [
      '请确认是否执行以下 Bash 命令:',
      `\x1b[32m${args.command || ''}\x1b[0m`,
    ];
    if (args.workdir) lines.push('', `工作目录: ${args.workdir}`);
    if (args.timeout) lines.push(`超时: ${args.timeout}ms`);
    lines.push('按回车确认，输入任何内容拒绝:');
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
