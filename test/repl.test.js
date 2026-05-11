const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createHistory } = require('../lib/inputHistory.js');

describe('REPL stdin handling', () => {
  it('resumes stdin after tool confirmation closes readline', () => {
    const source = fs.readFileSync(path.join(__dirname, '../lib/repl.js'), 'utf-8');
    const finishStart = source.indexOf('const finish = (ok) => {');
    const finishEnd = source.indexOf('};\n    const onAbort', finishStart);
    const finishBody = source.slice(finishStart, finishEnd);

    assert.notEqual(finishStart, -1);
    assert.notEqual(finishEnd, -1);
    assert.ok(finishBody.includes('rl.close();'));
    assert.ok(finishBody.includes('process.stdin.resume();'));
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
