// Search messages for the last recorded _mtime for a given file path
function findLastMtime(messages, filePath) {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'tool') continue;
    try {
      const data = JSON.parse(msg.content);
      if (data.path === filePath && data._mtime != null) {
        return data._mtime;
      }
    } catch {}
  }
  return null;
}

module.exports = { findLastMtime };
