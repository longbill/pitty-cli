#!/usr/bin/env node

const readline = require('readline');
const path = require('path');
const logger = require('./lib/logger.js');
const config = require('./lib/config.js');
const chat = require('./lib/chat.js');
const { run } = chat;

logger.logInfo({ event: 'startup', cwd: process.cwd(), args: process.argv.slice(2), node: process.version });

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Pitty CLI

Usage:
  pitty                      Start interactive REPL
  pitty "your prompt"        Run a single prompt
  echo "prompt" | pitty      Pipe input
  pitty --init               Create default ~/.pitty.json
  pitty --system-prompt      Show the system prompt for current dir
  pitty --help               Show this help

Config: ${config.CONFIG_PATH}
  - apiKey:    Your Pitty API key
  - baseUrl:   API base URL (default: https://api.deepseek.com)
  - model:     Model name (default: deepseek-chat)
  - maxTokens: Max tokens per response (default: 4096)
  - tools:     Object mapping tool names to true/false
`);
  process.exit(0);
}

if (args.includes('--init')) {
  const cfg = config.load();
  config.save(cfg);
  console.log(`Config created at ${config.CONFIG_PATH}`);
  console.log('Edit it to add your API key.');
  process.exit(0);
}

if (args.includes('--system-prompt') || args.includes('-sp')) {
  const { buildSystemPrompt } = require('./lib/system.js');
  const { getApiTools } = require('./lib/tools.js');
  console.log(buildSystemPrompt(getApiTools()));
  process.exit(0);
}

// ── Check API key ─────────────────────────────────────────────────────
const cfg = config.load();
if (!cfg.apiKey) {
  cfg.apiKey = process.env.PITTY_API_KEY || '';
  if (cfg.apiKey) config.save(cfg);
}
if (!cfg.apiKey) {
  console.error(`No API key found. Edit ${config.CONFIG_PATH} and set "apiKey".`);
  console.error('Or set the PITTY_API_KEY environment variable.');
  process.exit(1);
}

// ── REPL mode / single prompt ────────────────────────────────────────
const isInteractive = process.stdin.isTTY && !args.length;

if (isInteractive) {
  startRepl();
} else if (args.length > 0) {
  runAndExit(args.join(' '));
} else {
  // Pipe mode
  const buffers = [];
  process.stdin.on('data', (d) => buffers.push(d));
  process.stdin.on('end', () => {
    const input = Buffer.concat(buffers).toString('utf-8').trim();
    if (input) runAndExit(input);
  });
}

// ── Functions ─────────────────────────────────────────────────────────

async function runAndExit(prompt) {
  try {
    const result = await run(prompt, { maxTurns: 15 });
    if (result.aborted) {
      console.log('\n(已取消)');
    }
    process.exit(0);
  } catch (err) {
    logger.logError('run', err);
    console.error('\n\x1b[31mError: ' + err.message + '\x1b[0m');
    process.exit(1);
  }
}

function startRepl() {
  let messages = [];
  let running = false;
  let lastUserInput = '';
  let lastSigintTime = 0;

  console.log('Pitty CLI  (Ctrl+C to exit)\n');

  const dirName = path.basename(process.cwd());
  const promptStr = `\x1b[1;34mpitty\x1b[0m[\x1b[1;33m${dirName}\x1b[0m]: `;

  let rl;

  function createReadline() {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: promptStr,
    });
    rl.on('SIGINT', handleSigint);
    rl.on('line', handleLine);
  }

  let ctrlCTimer = null;

  function handleSigint() {
    if (running) {
      const ac = chat.currentAbort;
      if (ac) ac.abort();
      return;
    }
    const now = Date.now();
    if (now - lastSigintTime < 1000) {
      if (ctrlCTimer) { clearTimeout(ctrlCTimer); ctrlCTimer = null; }
      console.log('\nBye!');
      process.exit(0);
    }
    lastSigintTime = now;
    if (ctrlCTimer) clearTimeout(ctrlCTimer);

    // New line with message, no trailing newline
    process.stdout.write('\n\x1b[90m(再按一次 Ctrl+C 退出)\x1b[0m');

    ctrlCTimer = setTimeout(() => {
      process.stdout.write('\x1b[1A');
      ctrlCTimer = null;
      lastSigintTime = 0;
      rl.clearLine(0);
      rl.prompt();
    }, 1000);
  }

  let processSigint = null;
  let stdinDrain = null;

  function beforeRun() {
    running = true;
    rl.close();
    processSigint = () => handleSigint();
    process.on('SIGINT', processSigint);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      // rl.close() called input.pause(), so stdin is paused.
      // Resume it and attach a drain handler so keystrokes
      // don't accumulate in the kernel/stream buffer.
      process.stdin.resume();
      stdinDrain = (data) => {
        // In raw mode, Ctrl+C sends \x03 instead of SIGINT
        if (Buffer.isBuffer(data) && data.includes(3)) {
          const ac = chat.currentAbort;
          if (ac) ac.abort();
        }
      };
      process.stdin.on('data', stdinDrain);
    }
  }

  function afterRun() {
    if (stdinDrain) {
      process.stdin.removeListener('data', stdinDrain);
      stdinDrain = null;
    }
    if (processSigint) {
      process.removeListener('SIGINT', processSigint);
      processSigint = null;
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    createReadline();
    running = false;
  }

  let pendingLines = [];

  function fixupLine(text) {
    // Erase the \ (go up, clear line, rewrite without \)
    process.stdout.write('\x1b[1A\r\x1b[K');
    const prefix = pendingLines.length === 0 ? promptStr : '';
    process.stdout.write(prefix + text + '\n');
  }

  async function handleLine(line) {
    if (running) return; // safety guard: ignore input while a turn is in progress
    // Multi-line continuation: line ending with \
    if (line.endsWith('\\') && pendingLines.length === 0 && !line.trim().startsWith('/')) {
      fixupLine(line.slice(0, -1));
      pendingLines.push(line.slice(0, -1));
      rl.setPrompt('');
      rl.prompt();
      return;
    }
    if (pendingLines.length > 0) {
      if (line.endsWith('\\')) {
        fixupLine(line.slice(0, -1));
        pendingLines.push(line.slice(0, -1));
        rl.prompt();
        return;
      }
      pendingLines.push(line);
      line = pendingLines.join('\n');
      pendingLines = [];
      rl.setPrompt(promptStr);
    }

    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === '/clear' || trimmed === '/c') {
      messages = [];
      console.log('(Conversation cleared)');
      rl.prompt();
      return;
    }

    if (trimmed === '/exit' || trimmed === '/q') {
      console.log('Bye!');
      process.exit(0);
    }

    if (trimmed === '/help' || trimmed === '/h') {
      console.log('Commands:  /clear /c  Clear  |  /exit /q  Quit  |  /help /h  This');
      rl.prompt();
      return;
    }

    lastUserInput = trimmed;

    // Rewrite user input with gray background + timestamp
    const now = new Date();
    const time = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
    const display = `\x1b[48;5;236m\x1b[38;5;208m${time}\x1b[0m\x1b[48;5;236m: ${trimmed}\x1b[0m`;
    process.stdout.write(`\x1b[1A\r${display}\n\n`);

    beforeRun();

    let result;
    try {
      result = await run(trimmed, { messages, maxTurns: cfg.maxTurns || 15 });
    } catch (err) {
      logger.logError('repl', err);
      console.error('\n\x1b[31mError: ' + err.message + '\x1b[0m');
    }

    afterRun();

    if (result && result.aborted) {
      messages = result.messages;
      process.stdout.write('\x1b[90m(已取消)\x1b[0m\n');
      if (!result.hasOutput) {
        rl.prompt();
        rl.write(lastUserInput);
        return;
      }
    } else if (result) {
      messages = result.messages;
    }

    rl.prompt();
  }

  createReadline();
  rl.prompt();
}
