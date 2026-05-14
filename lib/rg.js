const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// No caching — always check fresh so dynamically installed rg is detected
async function ensureRg() {
  try {
    await execFileAsync('rg', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { ensureRg };
