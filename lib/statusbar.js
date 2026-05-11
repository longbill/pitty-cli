const CLEAR_LINE = '\r\x1b[K';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function gray(s) { return GRAY + s + RESET; }

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatTime(ms, _) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return totalSec + _('chat.second');
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + _('chat.minute') + s + _('chat.second');
}

function formatElapsedStr(ms, _) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return '+' + totalSec + _('chat.second');
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return '+' + m + _('chat.minute') + s + _('chat.second');
}

function createStatusBar(_) {
  let barVisible = false;
  let barText = '';
  let spinnerIndex = 0;
  let spinnerTimer = null;
  let turnStartTime = 0;
  let barState = '';
  let barTokenInfo = '';

  function refreshBar() {
    const elapsed = Date.now() - turnStartTime;
    const spinner = SPINNER[spinnerIndex];
    spinnerIndex = (spinnerIndex + 1) % SPINNER.length;
    const text = spinner + ' ' + barState + ' ' + formatTime(elapsed, _) + (barTokenInfo ? ' ' + barTokenInfo : '');

    if (barVisible) {
      process.stdout.write(CLEAR_LINE);
    }
    barVisible = true;
    barText = text;
    process.stdout.write(gray(text));
  }

  function startSpinner() {
    if (spinnerTimer) return;
    spinnerIndex = 0;
    turnStartTime = Date.now();
    refreshBar();
    spinnerTimer = setInterval(refreshBar, 100);
  }

  function stopSpinner() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  function setBar(state, tokenInfo) {
    barState = state;
    barTokenInfo = tokenInfo || '';
    if (!spinnerTimer) startSpinner();
  }

  function barWriteLine(line) {
    if (!barVisible) {
      process.stdout.write(line + '\n');
      return;
    }
    process.stdout.write(CLEAR_LINE);
    process.stdout.write(line + '\n');
    process.stdout.write(gray(barText));
  }

  function barFinalize(text) {
    stopSpinner();
    if (barVisible) {
      process.stdout.write(CLEAR_LINE);
      if (text) process.stdout.write(gray(text));
      process.stdout.write(text ? '\n\n' : '\n');
      barVisible = false;
    }
  }

  return { startSpinner, stopSpinner, setBar, barWriteLine, barFinalize, formatElapsed: (ms) => formatElapsedStr(ms, _) };
}

module.exports = { createStatusBar };
