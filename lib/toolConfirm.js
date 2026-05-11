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
    return [
      '请确认是否写入以下文件:',
      `文件路径: \x1b[32m${args.file_path || ''}\x1b[0m`,
      '文件内容:',
      `\x1b[32m${args.content || ''}\x1b[0m`,
      '按回车确认，输入任何内容拒绝:',
    ].join('\n');
  }

  if (name === 'Edit') {
    return [
      '请确认是否编辑以下文件:',
      `文件路径: \x1b[32m${args.file_path || ''}\x1b[0m`,
      '查找内容:',
      `\x1b[31m${args.old_string || ''}\x1b[0m`,
      '替换为:',
      `\x1b[32m${args.new_string || ''}\x1b[0m`,
      '按回车确认，输入任何内容拒绝:',
    ].join('\n');
  }

  return [
    `请确认是否执行以下 ${name} 工具调用:`,
    `\x1b[32m${JSON.stringify(args, null, 2)}\x1b[0m`,
    '按回车确认，输入任何内容拒绝:',
  ].join('\n');
}

module.exports = { formatToolConfirmation };
