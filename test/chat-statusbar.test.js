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
    };
    const chat = reloadChat();

    try {
      let outputWhileConfirming = '';
      const { output } = await captureStdout((getOutput) => chat.run('hi', {
        maxTurns: 1,
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
      assert.equal(calls, 1);
    } finally {
      api.chat = originalChat;
      config.getPermissionMode = originalGetPermissionMode;
    }
  });
});
