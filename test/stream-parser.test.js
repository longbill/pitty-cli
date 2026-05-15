const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseChatCompletionStream } = require('../lib/streamParser.js');

function makeReader(chunks) {
  const encoder = new TextEncoder();
  let idx = 0;
  return {
    async read() {
      if (idx >= chunks.length) return { done: true };
      return { done: false, value: encoder.encode(chunks[idx++]) };
    },
  };
}

function sse(payload) {
  return 'data: ' + JSON.stringify(payload) + '\n';
}

describe('parseChatCompletionStream', () => {
  it('parses content, reasoning, usage, and finish reason', async () => {
    const deltas = [];
    const reasonings = [];
    const usages = [];
    const reader = makeReader([
      sse({ choices: [{ delta: { content: '  hello', reasoning_content: 'think' } }] }),
      sse({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] }),
      sse({ usage: { prompt_tokens: 3, completion_tokens: 2 } }),
      'data: [DONE]\n',
    ]);

    const result = await parseChatCompletionStream(reader, {
      onDelta: (chunk, first) => deltas.push({ chunk, first }),
      onReasoning: chunk => reasonings.push(chunk),
      onUsage: usage => usages.push(usage),
    });

    assert.equal(result.content, '  hello world');
    assert.equal(result.reasoning, 'think');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2 });
    assert.deepEqual(deltas, [
      { chunk: 'hello', first: true },
      { chunk: ' world', first: false },
    ]);
    assert.deepEqual(reasonings, ['think']);
    assert.equal(usages.length, 1);
  });

  it('joins tool call deltas split across chunks', async () => {
    let toolDeltaCount = 0;
    const first = sse({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            function: { name: 'Re', arguments: '{"file_' },
          }],
        },
      }],
    });
    const second = sse({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { name: 'ad', arguments: 'path":"/tmp/a"}' },
          }],
        },
      }],
    });
    const reader = makeReader([first.slice(0, 15), first.slice(15) + second]);

    const result = await parseChatCompletionStream(reader, {
      onToolDelta: () => { toolDeltaCount++; },
    });

    assert.equal(toolDeltaCount, 2);
    assert.deepEqual(result.toolCalls, [{
      id: 'call_1',
      type: 'function',
      function: { name: 'Read', arguments: '{"file_path":"/tmp/a"}' },
    }]);
  });

  it('reports malformed SSE lines without failing the stream', async () => {
    const errors = [];
    const reader = makeReader([
      'data: {bad json}\n',
      sse({ choices: [{ delta: { content: 'ok' } }] }),
    ]);

    const result = await parseChatCompletionStream(reader, {
      onParseError: line => errors.push(line),
    });

    assert.equal(errors.length, 1);
    assert.equal(result.content, 'ok');
  });
});
