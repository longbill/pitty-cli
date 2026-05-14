const { describe, it } = require('node:test');
const assert = require('node:assert');
const { formatToolConfirmation } = require('../lib/toolConfirm.js');

describe('tool confirmation formatting', () => {
  it('shows the full bash command with the confirmation prompt', () => {
    const command = 'node -e "console.log(\'0123456789\'.repeat(20))"';
    const text = formatToolConfirmation('Bash', { command, timeout: 1234 });

    assert.ok(text.includes('请确认是否执行这条 Bash 命令(1秒超时):'));
    assert.ok(text.includes(`\x1b[32m${command}\x1b[0m`));
    assert.ok(text.includes('按回车确认，输入任何内容拒绝:'));
  });

  it('shows the write path and full content', () => {
    const content = 'line1\nline2\nline3';
    const text = formatToolConfirmation('Write', { file_path: '/tmp/a.txt', content });

    assert.ok(text.includes('请确认是否写入以下文件:'));
    assert.ok(text.includes('/tmp/a.txt'));
    assert.ok(text.includes(content));
  });

  it('shows the edit path, old string, and new string', () => {
    const oldString = 'old line 1\nold line 2';
    const newString = 'new line 1\nnew line 2';
    const text = formatToolConfirmation('Edit', {
      file_path: '/tmp/a.txt',
      old_string: oldString,
      new_string: newString,
    });

    assert.ok(text.includes('请确认是否编辑以下文件:'));
    assert.ok(text.includes('/tmp/a.txt'));
    assert.ok(text.includes(oldString));
    assert.ok(text.includes(newString));
  });
});
