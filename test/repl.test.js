const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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
