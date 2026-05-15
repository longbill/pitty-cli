#!/usr/bin/env node

const logger = require('./lib/logger.js');
const config = require('./lib/config.js');
const { _, _fmt } = require('./lib/lang/index.js');
const chat = require('./lib/chat.js');
const bashTool = require('./lib/tools/bash.js');
const { createConfirmFn } = require('./lib/confirm.js');
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

if (args.includes('--switch-model')) {
  const { chooseModelInteractive } = require('./lib/switchModel.js');
  chooseModelInteractive().then((result) => {
    if (result.selected) console.log(`当前模型: ${result.model}`);
    process.exit(0);
  }).catch((err) => {
    logger.logError('switch-model', err);
    console.error('\n\x1b[31m' + _('cli.errorPrefix') + err.message + '\x1b[0m');
    process.exit(1);
  });
  return;
}

// ── Permission mode override via CLI ──────────────────────────────────
const MODE_FLAGS = ['--accept-all', '--read-only', '--ask', '--audit', '--web-only'];
for (const flag of MODE_FLAGS) {
  const idx = args.indexOf(flag);
  if (idx !== -1) {
    config.setPermissionOverride(flag.slice(2)); // remove "--" prefix
    args.splice(idx, 1);
    break;
  }
}

// ── Check configuration ───────────────────────────────────────────────
const mainModel = config.resolveModel(config.getMainModel());
if (!mainModel || !mainModel.apiKey) {
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
  const canCaptureKeys = process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';
  const onKey = (chunk) => {
    if (Buffer.isBuffer(chunk) && chunk.includes(2)) {
      bashTool.moveCurrentRunToBackground();
    }
  };
  if (canCaptureKeys) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onKey);
  }

  try {
    const result = await run(prompt, { confirm: createConfirmFn(), statusBar: false });
    if (result.aborted) {
      console.log('\n' + _('cli.canceled'));
    }
    process.exit(0);
  } catch (err) {
    logger.logError('run', err);
    console.error('\n\x1b[31m' + _('cli.errorPrefix') + err.message + '\x1b[0m');
    process.exit(1);
  } finally {
    if (canCaptureKeys) {
      process.stdin.removeListener('data', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }
}
