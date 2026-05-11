const path = require('path');
const readline = require('readline');
const logger = require('./logger.js');
const config = require('./config.js');
const { _, _fmt } = require('./lang/index.js');
const { strlen } = require('./width.js');
const chat = require('./chat.js');
const { getEnabledTools } = require('./tools.js');
const { createHistory } = require('./inputHistory.js');
const { run } = chat;

function makeConfirmFn() {
  return (desc, signal) => new Promise((resolve) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      console.log(`\x1b[33m${_('cli.confirmPrefix')}\n${desc}\n按回车确认，输入任何内容拒绝 \x1b[0m`);
      resolve({ ok: false, userInput: '' });
      return;
    }

    process.stdin.setRawMode(false);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let finished = false;
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      rl.close();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const userInput = String(answer || '').trim();
      resolve({ ok: userInput === '', userInput });
    };
    const onAbort = () => finish('');
    signal?.addEventListener('abort', onAbort, { once: true });

    rl.question(`\x1b[33m${_('cli.confirmPrefix')}\n${desc}\n按回车确认，输入任何内容拒绝 \x1b[0m`, finish);
  });
}

function startRepl() {
  let messages = [];
  let running = false;
  let lastUserInput = '';
  let lastSigintTime = 0;
  let inputBuffer = '';
  let cursorPos = 0;
  let pasteActive = false;
  let pasteCapture = '';
  let pastedTexts = {};
  let nextPasteId = 1;
  const inputHistory = createHistory();

  const dirName = path.basename(process.cwd());
  const promptLabel = _('cli.promptLabel');
  const promptStr = `\x1b[1;34m${promptLabel}\x1b[0m[\x1b[1;33m${dirName}\x1b[0m]: `;
  const promptWidth = strlen(promptLabel + '[' + dirName + ']: ');

  function showPrompt() {
    process.stdout.write(promptStr);
  }

  function deleteForward() {
    if (cursorPos >= inputBuffer.length) return;
    inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
    const goUpRow = getVisualPos(cursorPos).row;
    refreshLine(goUpRow);
  }

  // Get visual (row, col) of a buffer offset, accounting for \n
  function getVisualPos(offset) {
    const cols = process.stdout.columns || 80;
    const text = inputBuffer.slice(0, offset);
    const segments = text.split('\n');
    let row = 0;
    let col = promptWidth;
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) { row++; col = 0; }
      const effectiveEndCol = col + strlen(segments[i]);
      row += Math.floor(effectiveEndCol / cols);
      col = effectiveEndCol % cols;
    }
    return { row, col };
  }

  // Redraw entire visible input from prompt line
  function refreshLine(goUpRow) {
    if (goUpRow > 0) process.stdout.write(`\x1b[${goUpRow}A`);
    process.stdout.write('\r' + promptStr + inputBuffer);
    // Erase any leftover content below the new text
    process.stdout.write('\x1b[J');
    const curPos = getVisualPos(cursorPos);
    const endPos = getVisualPos(inputBuffer.length);
    const rowDiff = endPos.row - curPos.row;
    if (rowDiff > 0) process.stdout.write(`\x1b[${rowDiff}A`);
    process.stdout.write(`\x1b[${curPos.col + 1}G`);
  }

  function setInputBuffer(value) {
    const oldPos = getVisualPos(cursorPos);
    inputBuffer = value;
    cursorPos = inputBuffer.length;
    refreshLine(oldPos.row);
  }

  // Move cursor to a new position visually
  function moveCursorTo(pos) {
    const oldPos = getVisualPos(cursorPos);
    const newPos = getVisualPos(pos);
    if (newPos.row < oldPos.row) {
      process.stdout.write(`\x1b[${oldPos.row - newPos.row}A`);
      process.stdout.write(`\x1b[${newPos.col + 1}G`);
    } else if (newPos.row > oldPos.row) {
      process.stdout.write(`\x1b[${newPos.row - oldPos.row}B`);
      process.stdout.write(`\x1b[${newPos.col + 1}G`);
    } else {
      if (newPos.col > oldPos.col) process.stdout.write(`\x1b[${newPos.col - oldPos.col}C`);
      else if (newPos.col < oldPos.col) process.stdout.write(`\x1b[${oldPos.col - newPos.col}D`);
    }
    cursorPos = pos;
  }

  // Enable bracketed paste mode
  process.stdout.write('\x1b[?2004h');
  process.on('exit', () => { process.stdout.write('\x1b[?2004l'); });

  function expandPastedTexts(input) {
    return input.replace(/\[Pasted text #(\d+)(?:\s+\+(\d+) lines)?\]/g, (match, id) => {
      return pastedTexts[id] !== undefined ? pastedTexts[id] : match;
    });
  }

  function handlePasteEnd() {
    const content = pasteCapture.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!content.trim()) return;

    const lines = content.replace(/\n$/, '').split('\n');
    const text = content.trim();

    // Use placeholder if pasted text is multi-line, or if the first line would exceed terminal width
    const combinedFirstLine = (inputBuffer.slice(0, cursorPos) + text + inputBuffer.slice(cursorPos)).split('\n')[0];
    const cols = process.stdout.columns || 80;
    const needsPlaceholder = lines.length > 1 || (promptWidth + strlen(combinedFirstLine) > cols);

    if (needsPlaceholder && lines.length > 1) {
      const id = nextPasteId++;
      pastedTexts[id] = content;
      const placeholder = `[Pasted text #${id} +${lines.length} lines]`;
      const oldPos = cursorPos;
      inputBuffer = inputBuffer.slice(0, oldPos) + placeholder + inputBuffer.slice(oldPos);
      cursorPos = oldPos;
      refreshLine(getVisualPos(cursorPos).row);
      moveCursorTo(oldPos + placeholder.length);
    } else if (needsPlaceholder) {
      // Single-line but exceeds width - wrap in placeholder
      const id = nextPasteId++;
      pastedTexts[id] = content;
      const placeholder = `[Pasted text #${id}]`;
      const oldPos = cursorPos;
      inputBuffer = inputBuffer.slice(0, oldPos) + placeholder + inputBuffer.slice(oldPos);
      cursorPos = oldPos;
      refreshLine(getVisualPos(cursorPos).row);
      moveCursorTo(oldPos + placeholder.length);
    } else {
      const oldPos = cursorPos;
      inputBuffer = inputBuffer.slice(0, oldPos) + text + inputBuffer.slice(oldPos);
      cursorPos = oldPos;
      refreshLine(getVisualPos(cursorPos).row);
      moveCursorTo(oldPos + text.length);
    }
  }

  function showTimestamp() {
    const now = new Date();
    const time = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
    process.stdout.write('\x1b[90m' + time + '\x1b[0m\n');
  }

  // ── Welcome banner ─────────────────────────────────────────────────

  const mode = config.getPermissionMode();
  const toolNames = getEnabledTools().map(t => t.name);

  process.stdout.write(`\x1b[1;36mPitty CLI\x1b[0m \x1b[90m—\x1b[0m `);
  process.stdout.write(`${_('cli.modeLabel')}: \x1b[1;33m${mode}\x1b[0m\n`);
  process.stdout.write(`\x1b[90m${_('cli.modeDesc')[mode] || ''}\x1b[0m\n`);
  process.stdout.write(`${_('cli.toolsLabel')}: \x1b[2m${toolNames.join(', ')}\x1b[0m\n\n`);

  // ── Raw input handling ──────────────────────────────────────────────

  process.stdin.setRawMode(true);
  process.stdin.resume();
  showPrompt();

  process.stdin.on('data', (chunk) => {
    if (running) {
      // During AI processing, only check for Ctrl+C
      if (Buffer.isBuffer(chunk) && chunk.includes(3)) {
        const ac = chat.currentAbort;
        if (ac) ac.abort();
      }
      return;
    }

    const str = chunk.toString('utf-8');

    for (let i = 0; i < str.length; i++) {
      // Bracketed paste start
      if (str[i] === '\x1b' && str.slice(i, i + 6) === '\x1b[200~') {
        pasteActive = true;
        pasteCapture = '';
        i += 5;
        continue;
      }

      // Bracketed paste end — show placeholder with captured content
      if (str[i] === '\x1b' && str.slice(i, i + 6) === '\x1b[201~') {
        pasteActive = false;
        i += 5;
        handlePasteEnd();
        continue;
      }

      // Capture paste characters silently (don't echo)
      if (pasteActive) {
        pasteCapture += str[i];
        continue;
      }

      // Escape sequences: arrow keys, home, end
      if (str[i] === '\x1b') {
        const seq = str.slice(i + 1, i + 3);
        if (seq === '[A') { i += 2; setInputBuffer(inputHistory.previous(inputBuffer)); continue; } // Up
        if (seq === '[B') { i += 2; setInputBuffer(inputHistory.next()); continue; } // Down
        if (seq === '[D') { i += 2; if (cursorPos > 0) moveCursorTo(cursorPos - 1); continue; } // Left
        if (seq === '[C') { i += 2; if (cursorPos < inputBuffer.length) moveCursorTo(cursorPos + 1); continue; } // Right
        if (seq === '[H') { i += 2; moveCursorTo(0); continue; } // Home
        if (seq === '[F') { i += 2; moveCursorTo(inputBuffer.length); continue; } // End
        if (seq === '[1' && str[i + 3] === '~') { i += 3; moveCursorTo(0); continue; } // Home (xterm)
        if (seq === '[4' && str[i + 3] === '~') { i += 3; moveCursorTo(inputBuffer.length); continue; } // End (xterm)
        if (seq === '[3' && str[i + 3] === '~') { i += 3; deleteForward(); continue; } // Delete
        // Unknown escape: skip it
        i += 2;
        continue;
      }

      // Normal input mode
      if (str[i] === '\x03') {
        const now = Date.now();
        inputBuffer = '';
        cursorPos = 0;
        process.stdout.write('\r\n');
        if (now - lastSigintTime < 500) {
          process.stdout.write('\x1b[90m' + _('cli.exitHint') + '\x1b[0m\n');
        }
        lastSigintTime = now;
        showPrompt();
        continue;
      }

      if (str[i] === '\r') {
        // Enter: submit
        process.stdout.write('\r\n');
        const line = inputBuffer;
        inputHistory.push(line);
        inputBuffer = '';
        cursorPos = 0;
        handleInput(line);
        continue;
      }

      if (str[i] === '\n') {
        process.stdout.write('\r\n');
        inputBuffer += '\n';
        cursorPos = inputBuffer.length;
        continue;
      }

      if (str[i] === '\x7f' || str[i] === '\b') {
        if (cursorPos > 0) {
          // Check if cursor is right after a paste placeholder — delete it whole
          const placeholderRegex = /\[Pasted text #(\d+)(?:\s+\+(\d+) lines)?\]/g;
          let pm, placeholderDeleted = false;
          while ((pm = placeholderRegex.exec(inputBuffer)) !== null) {
            if (cursorPos === pm.index + pm[0].length) {
              const oldPos = getVisualPos(cursorPos);
              const start = pm.index;
              inputBuffer = inputBuffer.slice(0, start) + inputBuffer.slice(cursorPos);
              cursorPos = start;
              delete pastedTexts[pm[1]];
              refreshLine(oldPos.row);
              placeholderDeleted = true;
              break;
            }
          }
          if (placeholderDeleted) continue;

          const oldPos = getVisualPos(cursorPos);
          const w = strlen(inputBuffer[cursorPos - 1]);

          inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
          cursorPos--;
          const atEnd = cursorPos === inputBuffer.length;

          if (atEnd) {
            const afterPos = getVisualPos(inputBuffer.length);
            if (oldPos.row !== afterPos.row) {
              refreshLine(oldPos.row);
            } else {
              process.stdout.write(`\x1b[${w}D${' '.repeat(w)}\x1b[${w}D`);
            }
          } else {
            refreshLine(oldPos.row);
          }
        }
        continue;
      }

      // Regular character
      {
        const wasAtEnd = cursorPos === inputBuffer.length;
        inputBuffer = inputBuffer.slice(0, cursorPos) + str[i] + inputBuffer.slice(cursorPos);
        if (wasAtEnd) {
          process.stdout.write(str[i]);
          cursorPos++;
        } else {
          refreshLine(getVisualPos(cursorPos).row);
          moveCursorTo(cursorPos + 1);
        }
      }
    }
  });

  // ── Input processing ───────────────────────────────────────────────

  async function handleInput(input) {
    const expanded = expandPastedTexts(input);
    const trimmed = expanded.trim();
    if (!trimmed) { showPrompt(); return; }

    if (trimmed === '/clear' || trimmed === '/c') {
      messages = [];
      console.log(_('cli.clearDone'));
      showPrompt();
      return;
    }

    if (trimmed === '/exit') {
      console.log(_('cli.bye'));
      process.exit(0);
    }

    if (trimmed === '/help' || trimmed === '/h') {
      console.log(_('cli.cmdHelp'));
      showPrompt();
      return;
    }

    lastUserInput = input;

    // If placeholder was expanded, show the real content in gray before timestamp
    if (input !== expanded) {
      const MAX_DISPLAY_LINES = 50;
      const regex = /\[Pasted text #(\d+)(?:\s+\+(\d+) lines)?\]/g;
      let lastIdx = 0;
      let m;
      while ((m = regex.exec(input)) !== null) {
        // Text before this placeholder
        if (m.index > lastIdx) {
          process.stdout.write('\x1b[90m' + input.slice(lastIdx, m.index) + '\x1b[0m');
        }
        // Paste content block
        const id = m[1];
        const stored = pastedTexts[id];
        if (stored) {
          const pLines = stored.replace(/\n$/, '').split('\n');
          const show = pLines.slice(0, MAX_DISPLAY_LINES);
          process.stdout.write('\n\x1b[90m<paste-content>\x1b[0m\n');
          for (const pl of show) {
            process.stdout.write('\x1b[90m' + pl + '\x1b[0m\n');
          }
          if (pLines.length > MAX_DISPLAY_LINES) {
            process.stdout.write('\x1b[90m... (+' + (pLines.length - MAX_DISPLAY_LINES) + ' more lines)\x1b[0m\n');
          }
          process.stdout.write('\x1b[90m</paste-content>\x1b[0m');
        }
        lastIdx = regex.lastIndex;
      }
      // Remaining text after last placeholder
      if (lastIdx < input.length) {
        process.stdout.write('\n\x1b[90m' + input.slice(lastIdx) + '\x1b[0m');
      }
      process.stdout.write('\n');
    }

    showTimestamp();

    running = true;
    const sigintHandler = () => {
      const ac = chat.currentAbort;
      if (ac) ac.abort();
    };
    process.on('SIGINT', sigintHandler);

    const cfg = config.load();
    let result;
    try {
      result = await run(trimmed, { messages, maxTurns: cfg.maxTurns, confirm: makeConfirmFn() });
    } catch (err) {
      logger.logError('repl', err);
      console.error('\n\x1b[31m' + _('cli.errorPrefix') + err.message + '\x1b[0m');
    }

    process.removeListener('SIGINT', sigintHandler);
    running = false;

    if (result && result.aborted) {
      messages = result.messages;
      process.stdout.write('\x1b[90m' + _('cli.canceled') + '\x1b[0m\n');
      if (!result.hasOutput) {
        inputBuffer = lastUserInput;
        cursorPos = inputBuffer.length;
        process.stdout.write(promptStr + inputBuffer);
        return;
      }
    } else if (result) {
      messages = result.messages;
    }

    showPrompt();
  }
}

module.exports = { startRepl };
