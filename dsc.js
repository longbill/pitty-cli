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
DSC — DeepSeek Code CLI

Usage:
  dsc                      Start interactive REPL
  dsc "your prompt"        Run a single prompt
  echo "prompt" | dsc      Pipe input
  dsc --init               Create default ~/.dsc.json
  dsc --help               Show this help

Config: ${config.CONFIG_PATH}
  - apiKey:    Your DeepSeek API key
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

// ── Check API key ─────────────────────────────────────────────────────
const cfg = config.load();
if (!cfg.apiKey) {
  cfg.apiKey = process.env.DEEPSEEK_API_KEY || '';
  if (cfg.apiKey) config.save(cfg);
}
if (!cfg.apiKey) {
  console.error(`No API key found. Edit ${config.CONFIG_PATH} and set "apiKey".`);
  console.error('Or set the DEEPSEEK_API_KEY environment variable.');
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
    console.error('\nError:', err.message);
    process.exit(1);
  }
}

function startRepl() {
  let messages = [];
  let running = false;
  let lastUserInput = '';
  let lastSigintTime = 0;

  console.log('DSC — DeepSeek Code CLI  (Ctrl+C to exit)\n');

  const dirName = path.basename(process.cwd());
  const promptStr = `\x1b[1;34mDSC\x1b[0m[\x1b[1;33m${dirName}\x1b[0m]: `;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: promptStr,
  });

  // Ctrl+C handler — works both via readline (idle) and raw stdin (running)
  function handleSigint() {
    if (running) {
      const ac = chat.currentAbort;
      if (ac) ac.abort();
      return;
    }
    const now = Date.now();
    if (now - lastSigintTime < 1000) {
      console.log('\nBye!');
      process.exit(0);
    }
    lastSigintTime = now;
    console.log('\n(再按一次 Ctrl+C 退出)');
    rl.prompt();
  }

  rl.on('SIGINT', handleSigint);

  // Raw stdin listener for Ctrl+C while a request is in flight.
  // readline's SIGINT event only fires when readline is actively reading,
  // which it isn't during the await — so we listen on the raw stdin directly.
  let rawDataHandler = null;
  function startRawSigint() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    rawDataHandler = (data) => {
      const key = data.toString();
      if (key === '\x03') {
        handleSigint();
      } else {
        // Forward other keystrokes back to stdin so readline can pick them up later
        process.stdin.unshift(data);
      }
    };
    process.stdin.on('data', rawDataHandler);
  }

  function stopRawSigint() {
    if (rawDataHandler) {
      process.stdin.removeListener('data', rawDataHandler);
      rawDataHandler = null;
    }
  }

  rl.on('line', async (line) => {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Built-in commands
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

    // Run the prompt
    lastUserInput = trimmed;
    running = true;
    startRawSigint();

    try {
      const result = await run(trimmed, { messages, maxTurns: 15 });
      if (result.aborted) {
        if (result.hasOutput) {
          messages = result.messages;
        } else {
          messages = result.messages;
          console.log('(已取消)');
          rl.write(lastUserInput);
        }
      } else {
        messages = result.messages;
      }
    } catch (err) {
      logger.logError('repl', err);
      console.error('\nError:', err.message);
    }

    running = false;
    stopRawSigint();
    rl.prompt();
  });

  rl.prompt();
}
