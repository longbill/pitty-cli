const path = require('path');
const config = require('./config.js');
const { getToolsForMode } = require('./permission.js');
const { isAllowedPath } = require('./safePath.js');
const bashTool = require('./tools/bash.js');
const readTool = require('./tools/read.js');
const writeTool = require('./tools/write.js');
const editTool = require('./tools/edit.js');
const globTool = require('./tools/glob.js');
const grepTool = require('./tools/grep.js');
const webFetchTool = require('./tools/webFetch.js');
const backgroundCreateTool = require('./tools/backgroundCreate.js');
const backgroundListTool = require('./tools/backgroundList.js');
const backgroundReadTool = require('./tools/backgroundRead.js');
const backgroundStopTool = require('./tools/backgroundStop.js');

const ALL_TOOLS = {
  Bash: bashTool,
  Read: readTool,
  Write: writeTool,
  Edit: editTool,
  Glob: globTool,
  Grep: grepTool,
  WebFetch: webFetchTool,
  BackgroundCreate: backgroundCreateTool,
  BackgroundList: backgroundListTool,
  BackgroundRead: backgroundReadTool,
  BackgroundStop: backgroundStopTool,
};

function getEnabledTools() {
  const mode = config.getPermissionMode();
  const allowed = getToolsForMode(mode);
  return Object.values(ALL_TOOLS).filter(t => allowed.includes(t.name));
}

function getApiTools() {
  return getEnabledTools().map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

// Tools whose path argument should be subject to path safety check
const PATH_CHECK_TOOLS = {
  Read:  'file_path',
  Grep:  'path',
  Glob:  'path',
};

async function executeToolCall(toolCall, signal, messages, confirm) {
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

  // Pre-check path safety for Read/Grep/Glob before execution
  const pathKey = PATH_CHECK_TOOLS[name];
  if (pathKey && args[pathKey]) {
    const targetPath = path.resolve(args[pathKey]);
    if (!isAllowedPath(targetPath)) {
      if (typeof confirm === 'function') {
        const desc = `路径 ${targetPath} 不在安全目录内，是否允许访问？`;
        const confirmed = await confirm(desc, signal, '已允许');
        if (!confirmed.ok) {
          return { name, result: { error: `路径不允许: ${targetPath}` } };
        }
        // User confirmed — execute with bypass flag
        const result = await tool.execute(args, { signal, messages, bypassPathCheck: true });
        return { name, result };
      }
      return { name, result: { error: `路径不允许: ${targetPath}` } };
    }
  }

  try {
    const result = await tool.execute(args, { signal, messages });
    return { name, result };
  } catch (err) {
    return { name, result: { error: err.message } };
  }
}

module.exports = { getEnabledTools, getApiTools, executeToolCall, ALL_TOOLS };
