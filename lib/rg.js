const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let rgChecked = false;
let rgAvailable = false;

async function ensureRg() {
  if (rgChecked) return rgAvailable;
  rgChecked = true;
  try {
    await execFileAsync('rg', ['--version'], { timeout: 3000 });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

module.exports = { ensureRg };
