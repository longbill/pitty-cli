function repairMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;

  let cutoff = msgs.length;
  let foundIncomplete = false;

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const expectedIds = m.tool_calls.map(tc => tc.id);
      const following = msgs.slice(i + 1, i + 1 + expectedIds.length);
      const followingIds = following.map(toolMsg => toolMsg.tool_call_id);
      const hasCompleteConsecutiveTools = following.length === expectedIds.length &&
        following.every(toolMsg => toolMsg.role === 'tool') &&
        expectedIds.every(id => followingIds.includes(id));

      if (!hasCompleteConsecutiveTools) {
        cutoff = i;
        foundIncomplete = true;
        break;
      }

      const next = msgs[i + 1 + expectedIds.length];
      if (next && next.role === 'tool') {
        cutoff = i;
        foundIncomplete = true;
        break;
      }
    }
  }

  if (foundIncomplete) {
    while (cutoff > 0 && msgs[cutoff - 1].role === 'tool') {
      cutoff--;
    }
  }

  return msgs.slice(0, cutoff);
}

module.exports = { repairMessages };
