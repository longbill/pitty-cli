#!/usr/bin/env node

const logger = require('./lib/logger.js');
const config = require('./lib/config.js');
const { _, _fmt } = require('./lib/lang/index.js');
const chat = require('./lib/chat.js');
const { run } = chat;

logger.logInfo({ event: 'startup', cwd: process.cwd(), args: process.argv.slice(2), node: process.version });

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(_fmt('cli.help', { path: config.CONFIG_PATH }));
  process.exit(0);
}

if (args.includes('--init')) {
  const cfg = config.load();
  config.save(cfg);
  console.log(_('cli.configInit', config.CONFIG_PATH));
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
  console.error(_('cli.noApiKey', config.CONFIG_PATH));
  console.error(_('cli.envHint'));
  process.exit(1);
}

// ── Dispatch ──────────────────────────────────────────────────────────
const isInteractive = process.stdin.isTTY && !args.length;

if (isInteractive) {
  const { startRepl } = require('./lib/repl.js');
  startRepl();
} else if (args.length > 0) {
  runAndExit(args.join(' '));
} else {
  const buffers = [];
  process.stdin.on('data', (d) => buffers.push(d));
  process.stdin.on('end', () => {
    const input = Buffer.concat(buffers).toString('utf-8').trim();
    if (input) runAndExit(input);
  });
}

async function runAndExit(prompt) {
  try {
    const result = await run(prompt);
    if (result.aborted) {
      console.log('\n' + _('cli.canceled'));
    }
    process.exit(0);
  } catch (err) {
    logger.logError('run', err);
    console.error('\n\x1b[31m' + _('cli.errorPrefix') + err.message + '\x1b[0m');
    process.exit(1);
  }
}
