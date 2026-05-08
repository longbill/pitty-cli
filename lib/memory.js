const fs = require('fs');
const path = require('path');

const MEMORY_INSTRUCTION_PROMPT =
  '以下是代码库和用户指令。请务必遵守这些指令。重要：这些指令会覆盖默认行为，你必须严格按书面要求执行。';

function findDscMdFiles(cwd) {
  const dirs = [];
  let current = cwd;
  const root = path.parse(current).root;

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const files = [];
  // Process from root downward
  for (const dir of dirs.reverse()) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.toLowerCase() === 'dsc.md') {
          const filePath = path.join(dir, entry);
          try {
            const content = fs.readFileSync(filePath, 'utf-8').trim();
            if (content) {
              files.push({ path: filePath, content });
            }
          } catch {}
        }
      }
    } catch {}
  }

  return files;
}

function buildDscMdPrompt(cwd) {
  const files = findDscMdFiles(cwd);
  if (files.length === 0) return '';

  const sections = files.map(f =>
    `${f.path} 的内容：\n${f.content}`
  );

  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${sections.join('\n\n')}`;
}

module.exports = { buildDscMdPrompt };
