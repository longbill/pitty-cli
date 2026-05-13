function repairMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;

  // Find the earliest assistant message that has incomplete tool calls
  let earliestIncompleteIndex = null;

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const neededIds = new Set(m.tool_calls.map(tc => tc.id));
      for (let j = i + 1; j < msgs.length; j++) {
        // Stop at next assistant message, all messages after that belong to the next turn
        if (msgs[j].role === 'assistant') break;
        if (msgs[j].role === 'tool' && neededIds.has(msgs[j].tool_call_id)) {
          neededIds.delete(msgs[j].tool_call_id);
        }
      }
      // If any tool calls are missing, mark this as the earliest incomplete
      if (neededIds.size > 0) {
        earliestIncompleteIndex = i;
        break;
      }
    }
  }

  // If no incomplete found earlier, check if the LAST message is an assistant with tool calls
  // This handles the case where user canceled immediately after tool calls were added
  if (earliestIncompleteIndex === null && msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
      // If last message is assistant with tool calls, it's incomplete - cut it off
      earliestIncompleteIndex = msgs.length - 1;
    }
  }

  let cutoff = earliestIncompleteIndex !== null ? earliestIncompleteIndex : msgs.length;

  // If we're cutting at an incomplete assistant, also remove any trailing tool messages before the cutoff
  // that might be incomplete
  while (cutoff > 0 && msgs[cutoff - 1].role === 'tool') {
    cutoff--;
  }

  return msgs.slice(0, cutoff);
}

module.exports = { run, get currentAbort() { return currentAbort; } };
