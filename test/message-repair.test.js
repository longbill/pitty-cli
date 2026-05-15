const { describe, it } = require('node:test');
const assert = require('node:assert');
const { repairMessages } = require('../lib/messageRepair.js');

describe('repairMessages', () => {
  it('removes assistant tool calls without consecutive tool responses', () => {
    const repaired = repairMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Bash', arguments: '{}' },
        }],
      },
      { role: 'user', content: 'continue' },
    ]);

    assert.deepEqual(repaired, [{ role: 'user', content: 'hi' }]);
  });

  it('keeps complete assistant tool calls with matching tool responses', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{}' },
      { role: 'user', content: 'continue' },
    ];

    assert.deepEqual(repairMessages(messages), messages);
  });

  it('removes orphan tool messages before an incomplete assistant call', () => {
    const repaired = repairMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{}' },
      { role: 'tool', tool_call_id: 'orphan', content: '{}' },
      { role: 'user', content: 'continue' },
    ]);

    assert.deepEqual(repaired, [{ role: 'user', content: 'hi' }]);
  });
});
