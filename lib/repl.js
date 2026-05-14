const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');
const logger = require('./logger.js');
const config = require('./config.js');
const { _, _fmt } = require('./lang/index.js');
const { strlen } = require('./width.js');
const chat = require('./chat.js');
const { getEnabledTools } = require('./tools.js');
const { createHistory } = require('./inputHistory.js');
const backgroundTasks = require('./backgroundTasks.js');
const bashTool = require('./tools/bash.js');
const { chooseModelInteractive } = require('./switchModel.js');
const { run } = chat;

function truncateShellOutput(text) {
  const clean = text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
  if (clean.length <= 2000) return clean;
  return clean.slice(0, 1000) + '\n...\n' + clean.slice(-1000);
}

function fmtTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatBackgroundTaskReminder(deltas) {
  const filtered = deltas.filter(d => d.output.trim());
  if (filtered.length === 0) return '';
  const body = filtered.map(({ id, command, cwd, status, startTime, endTime, exitCode, output }) => {
    const attrs = [`TASK_ID="${id}"`, `COMMAND="${command}"`, `CWD="${cwd}"`, `STATUS="${status}"`];
    if (status !== 'running') attrs.push(`EXIT_CODE="${exitCode}"`);
    attrs.push(`START_TIME="${fmtTime(startTime)}"`);
    const durationSeconds = Math.round((endTime - startTime) / 1000);
    return `[${attrs.join(' ')}]\n${truncateShellOutput(output.trim())}\n[END_OF_TASK_OUTPUT DURATION_SECONDS="${durationSeconds}"]`;
  }).join('\n\n');
  return `<system-reminder>\n后台任务有新的输出:\n${body}\n</system-reminder>`;
}

function makeConfirmFn() {
  return (desc, signal, successLabel) => new Promise((resolve) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      console.log(`\x1b[33m${desc}\x1b[0m`);
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
      if (userInput === '') {
        process.stdout.write('\x1b[1A\x1b[K\x1b[90m' + (successLabel || '已确认') + '\x1b[0m\n');
      }
      resolve({ ok: userInput === '', userInput });
    };
    const onAbort = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      rl.close();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      resolve({ ok: false, userInput: '' });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    rl.question(`\x1b[33m${desc}\x1b[0m`, finish);
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
  let recentShellOutputs = [];
  let autoTurnQueued = false;
  let lastBackgroundAutoTurn = 0;
  const inputHistory = createHistory();

  const dirName = path.basename(process.cwd());
  const promptLabel = _('cli.promptLabel');
  const promptStr = `\x1b[1;34m${promptLabel}\x1b[0m[\x1b[1;33m${dirName}\x1b[0m]: `;
  const promptWidth = strlen(promptLabel + '[' + dirName + ']: ');

  function buildBackgroundTaskReminder() {
    return formatBackgroundTaskReminder(backgroundTasks.consumeTaskDeltas());
  }

  function buildShellReminder() {
    if (recentShellOutputs.length === 0) return '';
    const body = recentShellOutputs.map(({ command, output, cwd, exitCode, startTime, endTime }) => {
      const header = `[COMMAND="${command}" CWD="${cwd}" TIME="${fmtTime(startTime)}"]`;
      const footer = `[COMMAND_EXIT_CODE="${exitCode}" TIME="${fmtTime(endTime)}"]`;
      return `${header}\n${truncateShellOutput(output)}\n${footer}`;
    }).join('\n\n');
    return `<system-reminder>\n用户最近在终端中执行了以下命令及输出:\n${body}\n</system-reminder>`;
  }

  function showBackgroundTasks() {
    const runningTasks = backgroundTasks.listTasks().filter(t => t.status === 'running');
    for (const task of runningTasks) {
      const durationSeconds = Math.round((new Date() - task.startTime) / 1000);
      process.stdout.write(`\x1b[90m[${task.id}] running ${durationSeconds}s ${task.command}\x1b[0m\n`);
    }
  }

  function showPrompt() {
    showBackgroundTasks();
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

    // Single-line: use placeholder only if text exceeds 3 terminal lines
    const cols = process.stdout.columns || 80;
    const needsPlaceholder = lines.length > 1 || strlen(text) > cols * 3;

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
  if (mode === 'web-only' || mode === 'read-only') {
    process.stdout.write(`${_('cli.toolsLabel')}: \x1b[2m${toolNames.join(', ')}\x1b[0m\n`);
  }
  process.stdout.write('\n');

  // ── Raw input handling ──────────────────────────────────────────────

  process.stdin.setRawMode(true);
  process.stdin.resume();
  showPrompt();

  // Auto-detect ripgrep on startup
  if (mode !== 'web-only') {
    const { ensureRg } = require('./rg.js');
    ensureRg().then(available => {
      if (!available) {
        const rgPrompt = '<system-reminder>\n用户刚刚打开 Pitty CLI，初始化的时候检测到没有安装 ripgrep。请给用户打招呼，并且说一下情况。当前系统未安装 ripgrep (rg)，这会导致 Pitty 搜索文件和代码的时候变慢。请给用户讲一下 ripgrep 是什么，有什么优点。结合用户当前操作系统，讲一下安装方式。如果你有 Bash 工具可以用，询问用户是否需要你帮用户安装。如果你没有 Bash 工具，就提示用户在输入框里面输入 !command 来手动执行安装命令（这里的 command 换成对应的安装命令）。如果用户让你帮他安装，记得在安装完成后测试一下 Glob 和 Grep 工具是否可用了。如果 rg 没有装好，Glob 和 Grep 工具会有提示的。\n</system-reminder>';
        runModelTurn(rgPrompt).then(showPrompt).catch(() => {});
      }
    }).catch(() => {});
  }

  function onData(chunk) {
    if (running) {
      if (Buffer.isBuffer(chunk) && chunk.includes(2)) {
        bashTool.moveCurrentRunToBackground();
      }
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
        // If the char before cursor is a backslash, insert newline instead of submit
        if (cursorPos > 0 && inputBuffer[cursorPos - 1] === '\\') {
          process.stdout.write('\r\n');
          inputBuffer = inputBuffer.slice(0, cursorPos) + '\n' + inputBuffer.slice(cursorPos);
          cursorPos++;
          continue;
        }
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

      // Tab: expand to spaces (avoid \t in buffer — terminal and strlen disagree on width)
      if (str[i] === '\t') {
        const col = getVisualPos(cursorPos).col;
        const tabStop = Math.floor(col / 8) * 8 + 8;
        const spaces = ' '.repeat(tabStop - col);
        const wasAtEnd = cursorPos === inputBuffer.length;
        inputBuffer = inputBuffer.slice(0, cursorPos) + spaces + inputBuffer.slice(cursorPos);
        if (wasAtEnd) {
          process.stdout.write(spaces);
          cursorPos += spaces.length;
        } else {
          refreshLine(getVisualPos(cursorPos).row);
          moveCursorTo(cursorPos + spaces.length);
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
  }
  process.stdin.on('data', onData);

  // ── Input processing ───────────────────────────────────────────────

  function detachInputHandler() {
    process.stdin.removeListener('data', onData);
  }

  function attachInputHandler() {
    process.stdin.on('data', onData);
  }

  function runShellCommand(command) {
    return new Promise((resolve) => {
      const tmpFile = path.join(os.tmpdir(), `pitty-shell-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
      const startTime = new Date();
      const child = spawn('script', ['-q', tmpFile, '-c', command], { stdio: 'inherit' });
      child.on('exit', (exitCode) => {
        const endTime = new Date();
        let output = '';
        try {
          output = fs.readFileSync(tmpFile, 'utf-8');
          fs.unlinkSync(tmpFile);
          output = output
            .replace(/^Script started on .*\n?/m, '')
            .replace(/^Script done on .*\n?/m, '')
            .trim();
        } catch {}
        resolve({ output, exitCode, startTime, endTime });
      });
      child.on('error', () => resolve({ output: '', exitCode: null, startTime: new Date(), endTime: new Date() }));
    });
  }

  /**
   * Extract shell commands prefixed with ! from AI response text.
   * Matches both inline !command and code block fenced !command patterns.
   */
  function extractBangCommands(text) {
    const cmds = [];
    // Match code blocks containing !commands: ```...!xxx...```
    const codeBlockRegex = /```[\s\S]*?```/g;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const block = match[0];
      const lines = block.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('!')) {
          cmds.push(trimmed);
        }
      }
    }
    // Match inline !commands wrapped in backticks: `!command args`
    const inlineRegex = /(?:^|[\s;(])`(!(?:[^`]|\\`)+)`/gm;
    while ((match = inlineRegex.exec(text)) !== null) {
      const cmd = (match[1] || '').trim();
      if (!cmd) continue;
      const pos = match.index;
      const textBefore = text.slice(0, pos);
      const backticksBefore = (textBefore.match(/```/g) || []).length;
      if (backticksBefore % 2 === 0 && !cmds.includes(cmd)) {
        cmds.push(cmd);
      }
    }
    return cmds;
  }

  async function runModelTurn(input) {
    running = true;
    const sigintHandler = () => {
      const ac = chat.currentAbort;
      if (ac) ac.abort();
    };
    process.on('SIGINT', sigintHandler);

    const cfg = config.load();
    const shellReminder = buildShellReminder();
    const backgroundReminder = buildBackgroundTaskReminder();
    const reminders = [shellReminder, backgroundReminder].filter(Boolean).join('\n\n');
    const modelInput = reminders ? `${reminders}\n\n${input}` : input;
    recentShellOutputs = [];
    let result;
    try {
      result = await run(modelInput, { messages, maxTurns: cfg.max_turns, confirm: makeConfirmFn() });
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
        return false;
      }
    } else if (result) {
      messages = result.messages;
    }

    // Extract !commands from AI response and inject into history
    if (result) {
      const lastMsg = result.messages?.[result.messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        const cmds = extractBangCommands(lastMsg.content);
        if (cmds.length > 0) {
          for (const cmd of cmds) {
            inputHistory.push(cmd);
          }
          process.stdout.write('\x1b[90m[按键盘的上键可快速输入以上命令]\x1b[0m\n');
        }
      }
    }

    return true;
  }

  async function runQueuedBackgroundTurn() {
    if (!autoTurnQueued || running || inputBuffer) return;
    autoTurnQueued = false;
    process.stdout.write('\r\n');
    const ok = await runModelTurn('请根据后台任务的最新输出，向用户汇报必要的信息。如果没有需要用户关注的内容，简短说明后台任务仍在运行。');
    if (ok) showPrompt();
  }

  setInterval(() => {
    if (backgroundTasks.listTasks().some(t => t.status === 'running')) {
      autoTurnQueued = true;
      runQueuedBackgroundTurn();
    }
  }, 60000);

  backgroundTasks.onTaskUpdate((event) => {
    if (event?.type === 'exit') {
      autoTurnQueued = true;
      runQueuedBackgroundTurn();
      return;
    }
    const now = Date.now();
    if (now - lastBackgroundAutoTurn >= 60000) {
      lastBackgroundAutoTurn = now;
      autoTurnQueued = true;
      runQueuedBackgroundTurn();
    }
  });

  async function handleInput(input) {
    const expanded = expandPastedTexts(input);
    const trimmed = expanded.trim();
    if (!trimmed) { showPrompt(); return; }

    if (trimmed.startsWith('!')) {
      const command = trimmed.slice(1).trim();
      if (!command) { showPrompt(); return; }

      running = true;
      detachInputHandler();
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const { output, exitCode, startTime, endTime } = await runShellCommand(command);
      if (output.trim()) recentShellOutputs.push({ command, output: output.trim(), cwd: process.cwd(), exitCode, startTime, endTime });
      process.stdin.resume();
      process.stdin.setRawMode(true);
      attachInputHandler();
      running = false;
      showPrompt();
      return;
    }

    if (trimmed === '/bg' || trimmed === '/bg list') {
      const tasks = backgroundTasks.listTasks();
      if (tasks.length === 0) {
        console.log('没有后台任务');
      } else {
        for (const task of tasks) {
          const durationSeconds = Math.round(((task.endTime || new Date()) - task.startTime) / 1000);
          console.log(`[${task.id}] ${task.status} ${durationSeconds}s ${task.command}`);
        }
      }
      showPrompt();
      return;
    }

    if (trimmed.startsWith('/bg stop ')) {
      const id = trimmed.slice('/bg stop '.length).trim();
      console.log(backgroundTasks.stopTask(id) ? `已停止后台任务 ${id}` : `未找到后台任务 ${id}`);
      showPrompt();
      return;
    }

    if (trimmed === '/model' || trimmed === '/models') {
      running = true;
      detachInputHandler();
      try {
        const result = await chooseModelInteractive();
        config.reload();
        if (result.selected) console.log(`当前模型: ${config.getMainModel()}`);
      } catch (err) {
        logger.logError('switch-model', err);
        console.error('\n\x1b[31m' + _('cli.errorPrefix') + err.message + '\x1b[0m');
      }
      process.stdin.setRawMode(true);
      process.stdin.resume();
      attachInputHandler();
      running = false;
      showPrompt();
      return;
    }

    if (trimmed === '/clear') {
      messages = [];
      console.log(_('cli.clearDone'));
      showPrompt();
      return;
    }

    if (trimmed === '/exit') {
      console.log(_('cli.bye'));
      process.exit(0);
    }

    if (trimmed === '/help') {
      console.log(_('cli.cmdHelp'));
      showPrompt();
      return;
    }

    if (trimmed === '/init') {
      const initPrompt = [
        '请分析这个代码库，创建或更新 PITTY.md 文件。该文件将为未来在此仓库中工作的 AI 编程助手提供指导。',
        '',
        '需要包含的内容：',
        '1. 常用命令，如构建、lint、运行测试等，以及开发所需的命令（如运行单个测试）。',
        '2. 高层级的代码架构和结构说明，帮助未来的 AI 助手快速上手。重点关注需要阅读多个文件才能理解的"大局"架构。',
        '',
        '注意事项：',
        '- 如果已存在 PITTY.md，请基于现有内容提出改进建议。',
        '- 不要重复自己，不要包含显而易见的说明。',
        '- 避免列出每个组件或文件结构（可以通过 ls/find 轻松发现的内容）。',
        '- 不要包含通用的开发实践。',
        '- 如果存在 .cursor/rules/、.cursorrules 或 .github/copilot-instructions.md，确保包含其中的重要部分。',
        '- 如果有 README.md，确保包含其中的重要部分。',
        '- 除非其他文件中明确包含，否则不要编造"常见开发任务"、"开发技巧"、"支持与文档"等内容。',
        '',
        '文件开头请包含以下内容：',
        '',
        '# PITTY.md',
        '',
        '本文件为 AI 编程助手（如 Claude Code）提供操作此仓库时的指导。',
      ].join('\n');
      await runModelTurn(initPrompt);
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

    const ok = await runModelTurn(trimmed);
    if (ok) showPrompt();
  }
}

module.exports = {
  startRepl,
  _test: {
    truncateShellOutput,
    fmtTime,
    formatBackgroundTaskReminder,
  },
};
