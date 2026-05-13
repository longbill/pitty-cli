const { describe, it } = require('node:test');
const assert = require('node:assert');
const api = require('../lib/api.js');
const config = require('../lib/config.js');

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = '';
  const getOutput = () => output;
  process.stdout.write = (chunk, encoding, cb) => {
    output += String(chunk);
    if (typeof cb === 'function') cb();
    return true;
  };

  return Promise.resolve()
    .then(() => fn(getOutput))
    .then(
      (result) => {
        process.stdout.write = originalWrite;
        return { output, result };
      },
      (error) => {
        process.stdout.write = originalWrite;
        throw error;
      }
    );
}

function reloadChat() {
  delete require.cache[require.resolve('../lib/chat.js')];
  return require('../lib/chat.js');
}

describe('chat status bar', () => {
  it('does not print status bar text when disabled', async () => {
    const originalChat = api.chat;
    api.chat = async (messages, tools, onDelta, onReasoning, onUsage) => {
      onReasoning('thinking');
      onDelta('hello', true);
      onUsage({ prompt_tokens: 1, completion_tokens: 1 });
      return {
        content: 'hello',
        reasoning: 'thinking',
        toolCalls: [],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    };
    const chat = reloadChat();

    try {
      const { output } = await captureStdout(() => chat.run('hi', { statusBar: false }));
      assert.equal(output.includes('思考中'), false);
      assert.equal(output.includes('生成中'), false);
      assert.equal(output.includes('ctx:'), false);
      assert.equal(output.includes('hello'), true);
    } finally {
      api.chat = originalChat;
    }
  });

  it('does not refresh the status bar while waiting for confirmation', async () => {
    const originalChat = api.chat;
    const originalGetPermissionMode = config.getPermissionMode;
    config.getPermissionMode = () => 'ask';

    let calls = 0;
    api.chat = async () => {
      calls++;
      if (calls === 1) {
        return {
          content: '',
          reasoning: '',
          toolCalls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'Bash', arguments: JSON.stringify({ command: 'echo hi' }) },
          }],
          usage: null,
        };
      }
      return {
        content: 'done',
        reasoning: '',
        toolCalls: [],
        usage: null,
      };
    };
    const chat = reloadChat();

    try {
      let outputWhileConfirming = '';
      const { output } = await captureStdout((getOutput) => chat.run('hi', {
        maxTurns: 2,
        confirm: async () => {
          process.stdout.write('CONFIRM?');
          await new Promise(resolve => setTimeout(() => {
            outputWhileConfirming = getOutput();
            resolve();
          }, 250));
          return false;
        },
      }));

      const afterConfirmPrompt = outputWhileConfirming.slice(outputWhileConfirming.indexOf('CONFIRM?') + 'CONFIRM?'.length);
      assert.equal(afterConfirmPrompt.includes('\r\x1b[K'), false);
      assert.equal(calls, 2);
    } finally {
      api.chat = originalChat;
      config.getPermissionMode = originalGetPermissionMode;
    }
  });

  it('does not ask for confirmation after reaching max turns', async () => {
    const originalChat = api.chat;
    const originalGetPermissionMode = config.getPermissionMode;
    config.getPermissionMode = () => 'ask';

    api.chat = async () => ({
      content: '',
      reasoning: '',
      toolCalls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'Bash', arguments: JSON.stringify({ command: 'echo hi' }) },
      }],
      usage: null,
    });
    const chat = reloadChat();

    try {
      let confirmCalled = false;
      await captureStdout(() => chat.run('hi', {
        maxTurns: 1,
        statusBar: false,
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      }));

      assert.equal(confirmCalled, false);
    } finally {
      api.chat = originalChat;
      config.getPermissionMode = originalGetPermissionMode;
    }
  });

  it('returns denied tool result with user input from confirmation', async () => {
    const originalChat = api.chat;
    const originalGetPermissionMode = config.getPermissionMode;
    config.getPermissionMode = () => 'ask';

    let calls = 0;
    api.chat = async (messages, tools, onDelta) => {
      calls++;
      if (calls === 1) {
        return {
          content: '',
          reasoning: '',
          toolCalls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'Bash', arguments: JSON.stringify({ command: 'echo hi' }) },
          }],
          usage: null,
        };
      }

      const toolMessage = messages.find(m => m.role === 'tool' && m.tool_call_id === 'call_1');
      onDelta(toolMessage.content, true);
      return {
        content: toolMessage.content,
        reasoning: '',
        toolCalls: [],
        usage: null,
      };
    };
    const chat = reloadChat();

    try {
      const { output } = await captureStdout(() => chat.run('hi', {
        maxTurns: 2,
        confirm: async () => ({ ok: false, userInput: '请改用 npm test' }),
      }));

      assert.ok(output.includes('用户拒绝执行'));
      assert.ok(output.includes('请改用 npm test'));
    } finally {
      api.chat = originalChat;
      config.getPermissionMode = originalGetPermissionMode;
    }
  });

  it('prints accept-all tool call text only once', async () => {
    const originalChat = api.chat;
    const originalGetPermissionMode = config.getPermissionMode;
    const originalGetAcceptAllWaitSeconds = config.getAcceptAllWaitSeconds;
    config.getPermissionMode = () => 'accept-all';
    config.getAcceptAllWaitSeconds = () => 0;

    let calls = 0;
    api.chat = async () => {
      calls++;
      if (calls === 1) {
        return {
          content: '',
          reasoning: '',
          toolCalls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'Bash', arguments: JSON.stringify({ command: 'echo hi' }) },
          }],
          usage: null,
        };
      }
      return {
        content: 'done',
        reasoning: '',
        toolCalls: [],
        usage: null,
      };
    };
    const chat = reloadChat();

    try {
      const { output } = await captureStdout(() => chat.run('hi', {
        maxTurns: 2,
        statusBar: false,
      }));
      const count = (output.match(/执行命令: echo hi/g) || []).length;
      assert.equal(count, 1);
    } finally {
      api.chat = originalChat;
      config.getPermissionMode = originalGetPermissionMode;
      config.getAcceptAllWaitSeconds = originalGetAcceptAllWaitSeconds;
    }
  });

  it('repairs incomplete tool calls before continuing a conversation', async () => {
    const originalChat = api.chat;
    let sentMessages = null;
    api.chat = async (messages) => {
      sentMessages = messages.map(m => ({ ...m }));
      return {
        content: 'ok',
        reasoning: '',
        toolCalls: [],
        usage: null,
      };
    };
    const chat = reloadChat();

    try {
      await captureStdout(() => chat.run('continue', {
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'Read', arguments: JSON.stringify({ file_path: '/tmp/missing' }) },
            }],
          },
        ],
        statusBar: false,
      }));

      assert.deepEqual(sentMessages, [
        { role: 'user', content: 'hi' },
        { role: 'user', content: 'continue' },
      ]);
    } finally {
      api.chat = originalChat;
    }
  });

  it('removes assistant tool calls without consecutive tool responses', () => {
    const chat = reloadChat();
    const repaired = chat._test.repairMessages([
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
});
