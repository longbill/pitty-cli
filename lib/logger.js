const fs = require('fs');
const path = require('path');

const LOG_DIR = '/tmp/pitty';
const STARTUP_TIME = Date.now();
const LOG_FILE = path.join(LOG_DIR, `${STARTUP_TIME}.log`);
const LOG_MODE = 0o600;
const DEBUG_LOGS = process.env.PITTY_DEBUG === '1';

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 }); fs.chmodSync(LOG_DIR, 0o700); } catch {}

function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/(authorization["'\s:=]+bearer\s+)([^"'\s,}]+)/gi, '$1[REDACTED]')
      .replace(/(api[_-]?key|authorization|password|token|secret)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]');
  }

  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/api[_-]?key|authorization|password|token|secret/i.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redact(val);
    }
  }
  return out;
}

function write(entry) {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${JSON.stringify(redact(entry))}\n`;
    fs.appendFileSync(LOG_FILE, line, { encoding: 'utf-8', mode: LOG_MODE });
    try { fs.chmodSync(LOG_FILE, LOG_MODE); } catch {}
  } catch {}
}

function logRequest(messages) {
  if (!DEBUG_LOGS) return;
  write({
    type: 'request',
    messages: messages.map(m => ({
      role: m.role,
      tool_calls: m.tool_calls ? m.tool_calls.map(tc => ({
        name: tc.function?.name,
        args: tc.function?.arguments,
      })) : undefined,
      // Truncate long content for readability
      content: m.content ? (typeof m.content === 'string' ? m.content.slice(0, 2000) : String(m.content).slice(0, 2000)) : null,
    })),
  });
}

function logResponse(response) {
  if (!DEBUG_LOGS) return;
  write({
    type: 'response',
    content: response.content ? response.content.slice(0, 2000) : null,
    reasoning: response.reasoning ? response.reasoning.slice(0, 2000) : null,
    toolCalls: response.toolCalls ? response.toolCalls.map(tc => ({
      name: tc.function?.name,
      args: tc.function?.arguments,
    })) : undefined,
    usage: response.usage || null,
  });
}

function logError(context, err) {
  write({
    type: 'error',
    context,
    message: err?.message || String(err),
  });
}

function logInfo(msg) {
  write({ type: 'info', message: msg });
}

module.exports = { logRequest, logResponse, logError, logInfo, LOG_FILE, _test: { redact } };
