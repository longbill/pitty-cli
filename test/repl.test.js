const { describe, it } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('stream');
const { createHistory } = require('../lib/inputHistory.js');
const repl = require('../lib/repl.js');
const switchModel = require('../lib/switchModel.js');
const { createConfirmFn } = require('../lib/confirm.js');
const { formatBackgroundTaskReminder, formatShellReminder } = require('../lib/replReminders.js');

function makeTtyInput() {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawModes = [];
  input.pauseCount = 0;
  input.resumeCount = 0;
  input.setRawMode = (value) => { input.rawModes.push(value); return input; };
  const originalPause = input.pause.bind(input);
  const originalResume = input.resume.bind(input);
  input.pause = () => { input.pauseCount++; return originalPause(); };
  input.resume = () => { input.resumeCount++; return originalResume(); };
  return input;
}

describe('REPL stdin handling', () => {
  it('restores raw mode and resumes stdin after confirmation', async () => {
    const input = makeTtyInput();
    const output = new PassThrough();
    const confirm = createConfirmFn({ input, output, showSuccess: true });

    const promise = confirm('confirm? ', undefined, 'done');
    input.write('\n');
    const result = await promise;

    assert.deepEqual(result, { ok: true, userInput: '' });
    assert.deepEqual(input.rawModes, [false, true]);
    assert.ok(input.pauseCount >= 1);
    assert.ok(input.resumeCount >= 1);
  });
});


describe('background task reminders', () => {
  it('formats task output with task metadata and duration', () => {
    const startTime = new Date(2026, 4, 12, 10, 20, 30, 123);
    const endTime = new Date(2026, 4, 12, 10, 22, 35, 456);
    const text = formatBackgroundTaskReminder([{
      id: 'bg_1',
      command: 'watch nvidia-smi',
      cwd: '/root',
      status: 'running',
      startTime,
      endTime,
      exitCode: null,
      output: 'GPU output',
    }]);

    assert.ok(text.includes('<system-reminder>'));
    assert.ok(text.includes('[TASK_ID="bg_1" COMMAND="watch nvidia-smi" CWD="/root" STATUS="running" START_TIME="2026-05-12 10:20:30.123"]'));
    assert.ok(text.includes('GPU output'));
    assert.ok(text.includes('[END_OF_TASK_OUTPUT DURATION_SECONDS="125"]'));
  });
});

describe('shell reminders', () => {
  it('formats recent shell command output', () => {
    const startTime = new Date(2026, 4, 12, 10, 20, 30, 123);
    const endTime = new Date(2026, 4, 12, 10, 20, 31, 456);
    const text = formatShellReminder([{
      command: 'npm test',
      cwd: '/repo',
      output: '\x1b[31mfailed\x1b[0m',
      exitCode: 1,
      startTime,
      endTime,
    }]);

    assert.ok(text.includes('<system-reminder>'));
    assert.ok(text.includes('[COMMAND="npm test" CWD="/repo" TIME="2026-05-12 10:20:30.123"]'));
    assert.ok(text.includes('failed'));
    assert.equal(text.includes('\x1b[31m'), false);
    assert.ok(text.includes('[COMMAND_EXIT_CODE="1" TIME="2026-05-12 10:20:31.456"]'));
  });
});

describe('REPL input history', () => {
  it('moves backward and forward through submitted input', () => {
    const history = createHistory();

    history.push('first');
    history.push('second');

    assert.equal(history.previous('draft'), 'second');
    assert.equal(history.previous('ignored'), 'first');
    assert.equal(history.previous('ignored'), 'first');
    assert.equal(history.next(), 'second');
    assert.equal(history.next(), 'draft');
    assert.equal(history.next(), 'draft');
  });

  it('ignores empty input when saving history', () => {
    const history = createHistory();

    history.push('');
    history.push('   ');

    assert.equal(history.previous('draft'), 'draft');
  });
});

describe('model switching', () => {
  it('lists provider model refs', () => {
    const models = switchModel.getSelectableModels({
      main_model: 'openai/gpt-4.1',
      provider: {
        openai: { models: ['gpt-4.1', 'gpt-4.1-mini'] },
        deepseek: { models: ['deepseek-chat'] },
      },
    });

    assert.deepEqual(models, [
      'openai/gpt-4.1',
      'openai/gpt-4.1-mini',
      'deepseek/deepseek-chat',
    ]);
  });

  it('marks current model in labels', () => {
    assert.equal(switchModel.formatModelLabel('openai/gpt-4.1', 'openai/gpt-4.1'), '* openai/gpt-4.1');
    assert.equal(switchModel.formatModelLabel('openai/gpt-4.1-mini', 'openai/gpt-4.1'), '  openai/gpt-4.1-mini');
  });
});
