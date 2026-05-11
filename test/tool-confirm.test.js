const { describe, it } = require('node:test');
const assert = require('node:assert');
const { formatToolConfirmation } = require('../lib/toolConfirm.js');

describe('tool confirmation formatting', () => {
  it('shows the full bash command', () => {
    const command = 'node -e "console.log(\'0123456789\'.repeat(20))"';
    const text = formatToolConfirmation('Bash', { command, workdir: '/tmp/project', timeout: 1234 });

    assert.ok(text.includes('Bash'));
    assert.ok(text.includes(command));
    assert.ok(text.includes('/tmp/project'));
    assert.ok(text.includes('1234'));
  });

  it('shows the write path and full content', () => {
    const content = 'line1\nline2\nline3';
    const text = formatToolConfirmation('Write', { file_path: '/tmp/a.txt', content });

    assert.ok(text.includes('Write'));
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

    assert.ok(text.includes('Edit'));
    assert.ok(text.includes('/tmp/a.txt'));
    assert.ok(text.includes(oldString));
    assert.ok(text.includes(newString));
  });
});
