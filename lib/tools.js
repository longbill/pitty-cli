const config = require('./config.js');
const { check: checkPerm } = require('./permission.js');
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
  const toolPerms = config.getToolPermissions();
  return Object.values(ALL_TOOLS).filter(t => toolPerms[t.name] !== false);
}

function getApiTools() {
  return getEnabledTools().map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function executeToolCall(toolCall, signal) {
  const name = toolCall.function.name;
  const tool = ALL_TOOLS[name];
  if (!tool) {
    const { _ } = require('./lang/index.js');
    return { name, result: { error: _('toolErrors.unknownTool', name) } };
  }

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    const { _ } = require('./lang/index.js');
    return { name, result: { error: _('toolErrors.invalidArgs', toolCall.function.arguments) } };
  }

  // Validate required parameters
  const required = tool.inputSchema?.required || [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      const { _ } = require('./lang/index.js');
      return { name, result: { error: _('toolErrors.missingParam', key) } };
    }
  }

  try {
    const result = await tool.execute(args, { signal });
    return { name, result };
  } catch (err) {
    return { name, result: { error: err.message } };
  }
}

// Check each tool call against permission mode and hard switches
function filterByPermission(mode, toolCalls) {
  const toolPerms = config.getToolPermissions();

  return toolCalls.map(tc => {
    const name = tc.function.name;

    // Hard switch check — disabled tools can never run
    if (toolPerms[name] === false) {
      return { tc, allowed: false, needConfirm: false, needAudit: false, reason: 'tool disabled in config' };
    }

    const perm = checkPerm(mode, name);
    return { tc, ...perm };
  });
}

module.exports = { getEnabledTools, getApiTools, executeToolCall, filterByPermission, ALL_TOOLS };
