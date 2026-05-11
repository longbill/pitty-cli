const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pitty-test-'));

function createTestFile(name, content) {
  const fullPath = path.join(TEST_DIR, name);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

function cleanup() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

function getTestDir() {
  return TEST_DIR;
}

module.exports = { createTestFile, cleanup, getTestDir };
