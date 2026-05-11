const { chat } = require('./api.js');
const config = require('./config.js');

const AUDIT_SYSTEM = `You are a security audit agent. Your job is to review tool calls that another AI agent plans to execute, and classify each one as SAFE or RISKY.

RULES:
- SAFE: reading files, searching code, fetching URLs, running read-only shell commands (ls, cat, git status, git log, git diff, find, grep, npm test, node --test, etc.), writing to temp files or project files, editing project files.
- RISKY: deleting files (rm, git reset --hard, etc.), modifying system config, accessing sensitive paths (/etc, ~/.ssh, etc.), force-pushing to main/master, installing packages globally, dropping databases, killing processes, anything destructive or irreversible.

You MUST respond in this exact JSON format, with no other text:

{
  "reviews": [
    {"name": "tool_name", "args": {"key": "value"}, "safe": true, "reason": "brief reason"},
    ...
  ]
}

The "safe" field must be true or false. Include the tool arguments as passed.`;

async function auditToolCalls(toolCalls, messages) {
  const auditModelRef = config.getAuditModel();
  if (!auditModelRef) {
    return { reviews: toolCalls.map(tc => ({ name: tc.function.name, safe: true, reason: 'no audit model configured' })), allSafe: true };
  }

  const providerConfig = config.resolveModel(auditModelRef);
  if (!providerConfig) {
    return { reviews: toolCalls.map(tc => ({ name: tc.function.name, safe: true, reason: 'audit model not resolved' })), allSafe: true };
  }

  const reviewList = toolCalls.map(tc => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments); } catch {}
    return `- ${tc.function.name}: ${JSON.stringify(args)}`;
  }).join('\n');

  const auditMessages = [
    { role: 'user', content: `Review these planned tool calls:\n\n${reviewList}\n\nRespond with the JSON only.` },
  ];

  let fullContent = '';
  let errorOccurred = false;

  try {
    await chat(
      [{ role: 'system', content: AUDIT_SYSTEM }, ...auditMessages],
      [],
      (delta) => { fullContent += delta; },
      () => {},
      () => {},
      undefined,
      providerConfig,
    );
  } catch {
    errorOccurred = true;
  }

  if (errorOccurred || !fullContent.trim()) {
    return { reviews: toolCalls.map(tc => ({ name: tc.function.name, safe: false, reason: 'audit agent failed' })), allSafe: false };
  }

  try {
    let json = fullContent.trim();
    const match = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) json = match[1].trim();
    const parsed = JSON.parse(json);

    if (!parsed.reviews || !Array.isArray(parsed.reviews)) {
      throw new Error('invalid format');
    }

    const reviews = toolCalls.map(tc => {
      const found = parsed.reviews.find(r => r.name === tc.function.name);
      return found || { name: tc.function.name, safe: false, reason: 'not reviewed' };
    });

    const allSafe = reviews.every(r => r.safe);
    return { reviews, allSafe };
  } catch {
    return { reviews: toolCalls.map(tc => ({ name: tc.function.name, safe: false, reason: 'audit response parse error' })), allSafe: false };
  }
}

module.exports = { auditToolCalls };
