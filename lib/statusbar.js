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

function createStatusBar(_, opts = {}) {
  if (opts.enabled === false) {
    return {
      startSpinner() {},
      stopSpinner() {},
      pause() {},
      resume() {},
      setBar() {},
      setTokenInfo() {},
      barWriteLine(line) { process.stdout.write(line + '\n'); },
      barFinalize() {},
      formatElapsed: (ms) => formatElapsedStr(ms, _),
      getElapsedStr: () => formatTime(0, _),
    };
  }

  let barVisible = false;
  let barText = '';
  let spinnerIndex = 0;
  let spinnerTimer = null;
  let turnStartTime = 0;
  let barState = '';
  let barTokenInfo = '';
  let displayInTokens = 0;
  let displayOutTokens = 0;

  function fmtNum(n) {
    if (n == null) return '?';
    if (n < 1000) return String(n);
    const k = n / 1000;
    if (k >= 100) return Math.round(k) + 'k';
    return (Math.round(k * 10) / 10) + 'k';
  }

  function buildBarText() {
    const elapsed = Date.now() - turnStartTime;
    const spinner = SPINNER[spinnerIndex];
    const tokens = (displayInTokens > 0 || displayOutTokens > 0) ? ' ↑' + fmtNum(displayInTokens) + ' ↓' + fmtNum(displayOutTokens) : '';
    return spinner + ' ' + barState + ' ' + formatTime(elapsed, _) + (barTokenInfo ? ' ' + barTokenInfo : '') + tokens;
  }

  function refreshBar() {
    spinnerIndex = (spinnerIndex + 1) % SPINNER.length;
    const text = buildBarText();

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

  function pause() {
    stopSpinner();
    if (barVisible) {
      process.stdout.write(CLEAR_LINE);
      barVisible = false;
    }
  }

  function resume() {
    if (barState) setBar(barState, barTokenInfo);
  }

  function setBar(state, tokenInfo) {
    barState = state;
    barTokenInfo = tokenInfo || '';
    if (!spinnerTimer) { startSpinner(); return; }
    refreshBar();
  }

  function setTokenInfo(inTokens, outTokens) {
    displayInTokens = inTokens;
    displayOutTokens = outTokens;
  }

  function barWriteLine(line) {
    if (!barVisible) {
      process.stdout.write(line + '\n');
      return;
    }
    process.stdout.write(CLEAR_LINE);
    process.stdout.write(line + '\n');
    process.stdout.write(gray(buildBarText()));
  }

  function getElapsedStr() {
    return formatTime(Date.now() - turnStartTime, _);
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

  return { startSpinner, stopSpinner, pause, resume, setBar, setTokenInfo, barWriteLine, barFinalize, formatElapsed: (ms) => formatElapsedStr(ms, _), getElapsedStr };
}

module.exports = { createStatusBar };
