const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const config = require('../lib/config.js');
const { resolveToolApprovals } = require('../lib/toolApproval.js');

const originalGetPermissionMode = config.getPermissionMode;
const originalGetAcceptAllWaitSeconds = config.getAcceptAllWaitSeconds;

function toolCall(name, args = {}, id = 'call_1') {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeStatusBar() {
  return {
    paused: 0,
    resumed: 0,
    bars: [],
    lines: [],
    pause() { this.paused++; },
    resume() { this.resumed++; },
    setBar(text) { this.bars.push(text); },
    barWriteLine(text) { this.lines.push(text); },
  };
}

describe('resolveToolApprovals', () => {
  beforeEach(() => {
    config.getPermissionMode = originalGetPermissionMode;
    config.getAcceptAllWaitSeconds = originalGetAcceptAllWaitSeconds;
  });

  afterEach(() => {
    config.getPermissionMode = originalGetPermissionMode;
    config.getAcceptAllWaitSeconds = originalGetAcceptAllWaitSeconds;
  });

  it('denies write tools in read-only mode', async () => {
    config.getPermissionMode = () => 'read-only';
    const sb = makeStatusBar();
    const ac = new AbortController();

    const res = await resolveToolApprovals([
      toolCall('Write', { file_path: '/tmp/a.txt', content: 'x' }),
    ], [], true, sb, ac);

    assert.deepEqual(res.approved, []);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].id, 'call_1');
    assert.equal(res.results[0].name, 'Write');
    assert.ok(res.results[0].result.error.includes('read-only'));
  });

  it('asks for confirmation in ask mode and preserves rejection input', async () => {
    config.getPermissionMode = () => 'ask';
    const sb = makeStatusBar();
    const ac = new AbortController();
    let prompt = '';

    const res = await resolveToolApprovals([
      toolCall('Bash', { command: 'npm test', workdir: '/tmp' }),
    ], [], async (desc) => {
      prompt = desc;
      return { ok: false, userInput: '先不要运行' };
    }, sb, ac);

    assert.deepEqual(res.approved, []);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].result.userInput, '先不要运行');
    assert.ok(prompt.includes('npm test'));
    assert.equal(sb.paused, 1);
    assert.equal(sb.resumed, 1);
  });

  it('approves confirmed tools in ask mode', async () => {
    config.getPermissionMode = () => 'ask';
    const sb = makeStatusBar();
    const ac = new AbortController();
    const tc = toolCall('Edit', { file_path: '/tmp/a.txt', old_string: 'a', new_string: 'b' });

    const res = await resolveToolApprovals([tc], [], async () => ({ ok: true, userInput: '' }), sb, ac);

    assert.deepEqual(res.approved, [tc]);
    assert.deepEqual(res.results, []);
    assert.equal(sb.paused, 1);
    assert.equal(sb.resumed, 1);
  });

  it('auto-approves confirm tools in accept-all mode when countdown is zero', async () => {
    config.getPermissionMode = () => 'accept-all';
    config.getAcceptAllWaitSeconds = () => 0;
    const sb = makeStatusBar();
    const ac = new AbortController();
    const tc = toolCall('Bash', { command: 'echo hi' });

    const res = await resolveToolApprovals([tc], [], true, sb, ac);

    assert.deepEqual(res.approved, [tc]);
    assert.deepEqual(res.results, []);
  });

  it('denies accept-all tools when aborted during countdown', async () => {
    config.getPermissionMode = () => 'accept-all';
    config.getAcceptAllWaitSeconds = () => 1;
    const sb = makeStatusBar();
    const ac = new AbortController();
    ac.abort();

    const res = await resolveToolApprovals([
      toolCall('Bash', { command: 'echo hi' }),
    ], [], true, sb, ac);

    assert.deepEqual(res.approved, []);
    assert.equal(res.results.length, 1);
    assert.ok(res.results[0].result.error);
  });
});
