const { describe, it } = require('node:test');
const assert = require('node:assert');
const api = require('../lib/api.js');

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk, encoding, cb) => {
    output += String(chunk);
    if (typeof cb === 'function') cb();
    return true;
  };

  return Promise.resolve()
    .then(fn)
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
    delete require.cache[require.resolve('../lib/chat.js')];
    const chat = require('../lib/chat.js');

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
});
