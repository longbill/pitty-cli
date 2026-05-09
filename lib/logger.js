const fs = require('fs');
const path = require('path');

const LOG_DIR = '/tmp/pitty';
const STARTUP_TIME = Date.now();
const LOG_FILE = path.join(LOG_DIR, `${STARTUP_TIME}.log`);

// Ensure log directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

function write(entry) {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${JSON.stringify(entry)}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {}
}

function logRequest(messages) {
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

module.exports = { logRequest, logResponse, logError, logInfo, LOG_FILE };
