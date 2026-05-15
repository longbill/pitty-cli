function killProcessTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return false;

  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (err) {
    if (err.code !== 'ESRCH') {
      try {
        child.kill(signal);
        return true;
      } catch {}
    }
    return false;
  }
}

function forceKillProcessTree(child, delayMs = 1000) {
  setTimeout(() => {
    if (child && child.exitCode == null && !child.killed) {
      killProcessTree(child, 'SIGKILL');
    }
  }, delayMs).unref?.();
}

module.exports = { killProcessTree, forceKillProcessTree };
