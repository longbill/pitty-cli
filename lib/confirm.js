const readline = require('readline');

function createConfirmFn({ input = process.stdin, output = process.stdout, showSuccess = false } = {}) {
  return (desc, signal, successLabel) => new Promise((resolve) => {
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      output.write(`\x1b[33m${desc}\x1b[0m\n`);
      resolve({ ok: false, userInput: '' });
      return;
    }

    input.setRawMode(false);
    if (typeof input.pause === 'function') input.pause();

    const rl = readline.createInterface({ input, output });

    let finished = false;
    const restore = () => {
      rl.close();
      input.setRawMode(true);
      if (typeof input.resume === 'function') input.resume();
    };
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      restore();
      const userInput = String(answer || '').trim();
      if (showSuccess && userInput === '') {
        output.write('\x1b[1A\x1b[K\x1b[90m' + (successLabel || '已确认') + '\x1b[0m\n');
      }
      resolve({ ok: userInput === '', userInput });
    };
    const onAbort = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      restore();
      resolve({ ok: false, userInput: '' });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    rl.question(`\x1b[33m${desc}\x1b[0m`, finish);
  });
}

module.exports = { createConfirmFn };
