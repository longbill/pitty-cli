#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./lib/config.js');
const { run } = require('./lib/chat.js');

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

function runAndExit(prompt) {
  run(prompt, { maxTurns: 15 })
    .catch(err => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
}

function startRepl() {
  let messages = [];
  let running = false;

  console.log('DSC — DeepSeek Code CLI  (Ctrl+C to exit)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '>>> ',
    // Don't close on Ctrl+D — we use it differently
  });

  rl.on('SIGINT', () => {
    if (running) {
      console.log('\n(Interrupting...)');
      process.exit(0);
    } else {
      console.log('\nBye!');
      process.exit(0);
    }
  });

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
    running = true;
    rl.pause();

    try {
      messages = await run(trimmed, { messages, maxTurns: 15 });
    } catch (err) {
      console.error('\nError:', err.message);
    }

    running = false;
    rl.prompt();
  });

  rl.prompt();
}
