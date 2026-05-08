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

  // readline sets raw mode on stdin (Ctrl+C → \x03 character), so its 'SIGINT'
  // event only fires when readline is actively reading. During await run(),
  // readline is not reading — we temporarily switch the terminal back to cooked
  // mode so Ctrl+C sends the OS SIGINT signal instead, handled at process level.
  // We restore raw mode before calling rl.prompt() so readline works correctly.
  rl.on('SIGINT', handleSigint);

  // Persist handler but only attach during requests
  let processSigint = null;

  function beforeRun() {
    running = true;
    processSigint = () => handleSigint();
    process.on('SIGINT', processSigint);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  function afterRun() {
    running = false;
    if (processSigint) {
      process.removeListener('SIGINT', processSigint);
      processSigint = null;
    }
    // Restore raw mode before readline resumes
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
  }

  rl.on('line', async (line) => {
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
    beforeRun();

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

    afterRun();
    rl.prompt();
  });

  rl.prompt();
}