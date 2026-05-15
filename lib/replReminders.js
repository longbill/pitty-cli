function truncateShellOutput(text) {
  const clean = text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
  if (clean.length <= 2000) return clean;
  return clean.slice(0, 1000) + '\n...\n' + clean.slice(-1000);
}

function fmtTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatBackgroundTaskReminder(deltas) {
  const filtered = deltas.filter(d => d.output.trim());
  if (filtered.length === 0) return '';
  const body = filtered.map(({ id, command, cwd, status, startTime, endTime, exitCode, output }) => {
    const attrs = [`TASK_ID="${id}"`, `COMMAND="${command}"`, `CWD="${cwd}"`, `STATUS="${status}"`];
    if (status !== 'running') attrs.push(`EXIT_CODE="${exitCode}"`);
    attrs.push(`START_TIME="${fmtTime(startTime)}"`);
    const durationSeconds = Math.round((endTime - startTime) / 1000);
    return `[${attrs.join(' ')}]\n${truncateShellOutput(output.trim())}\n[END_OF_TASK_OUTPUT DURATION_SECONDS="${durationSeconds}"]`;
  }).join('\n\n');
  return `<system-reminder>\n后台任务有新的输出:\n${body}\n</system-reminder>`;
}

function formatShellReminder(outputs) {
  if (outputs.length === 0) return '';
  const body = outputs.map(({ command, output, cwd, exitCode, startTime, endTime }) => {
    const header = `[COMMAND="${command}" CWD="${cwd}" TIME="${fmtTime(startTime)}"]`;
    const footer = `[COMMAND_EXIT_CODE="${exitCode}" TIME="${fmtTime(endTime)}"]`;
    return `${header}\n${truncateShellOutput(output)}\n${footer}`;
  }).join('\n\n');
  return `<system-reminder>\n用户最近在终端中执行了以下命令及输出:\n${body}\n</system-reminder>`;
}

module.exports = { truncateShellOutput, fmtTime, formatBackgroundTaskReminder, formatShellReminder };
