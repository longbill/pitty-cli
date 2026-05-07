const config = require('./config.js');
const bashTool = require('./tools/bash.js');
const readTool = require('./tools/read.js');
const writeTool = require('./tools/write.js');
const editTool = require('./tools/edit.js');
const globTool = require('./tools/glob.js');
const grepTool = require('./tools/grep.js');
const webFetchTool = require('./tools/webFetch.js');

const ALL_TOOLS = {
  Bash: bashTool,
  Read: readTool,
  Write: writeTool,
  Edit: editTool,
  Glob: globTool,
  Grep: grepTool,
  WebFetch: webFetchTool,
};

function getEnabledTools() {
  const cfg = config.load();
  return Object.values(ALL_TOOLS).filter(t => cfg.tools[t.name] !== false);
}

function getApiTools() {
  return getEnabledTools().map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function executeToolCall(toolCall) {
  const name = toolCall.function.name;
  const tool = ALL_TOOLS[name];
  if (!tool) {
    return { name, result: { error: `Unknown tool: ${name}` } };
  }

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { name, result: { error: `Invalid arguments JSON: ${toolCall.function.arguments}` } };
  }

  try {
    const result = await tool.execute(args);
    return { name, result };
  } catch (err) {
    return { name, result: { error: err.message } };
  }
}

module.exports = { getEnabledTools, getApiTools, executeToolCall, ALL_TOOLS };
