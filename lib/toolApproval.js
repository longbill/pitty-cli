const config = require('./config.js');
const { check: checkPerm, CONFIRM_TOOLS } = require('./permission.js');
const { t, _ } = require('./lang/index.js');
const { gray } = require('./render.js');
const { auditToolCalls } = require('./audit.js');
const { formatToolConfirmation } = require('./toolConfirm.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveToolApprovals(toolCalls, messages, confirm, sb, ac) {
  const mode = config.getPermissionMode();

  const classified = toolCalls.map(tc => {
    const perm = checkPerm(mode, tc.function.name);
    return { tc, ...perm };
  });

  if (mode === 'audit') {
    sb.setBar(_('chat.auditing'));

    for (const item of classified) {
      let args = {};
      try { args = JSON.parse(item.tc.function.arguments); } catch {}
      sb.barWriteLine(gray(t(item.tc.function.name, args)));
    }

    const auditResult = await auditToolCalls(
      classified.map(c => c.tc),
      messages
    );

    for (const review of auditResult.reviews) {
      if (review.safe) {
        sb.barWriteLine(gray(`  ${_('chat.auditSafe')} ${review.name}: ${review.reason}`));
      } else {
        sb.barWriteLine(gray(`  ${_('chat.auditRisky')} ${review.name}: ${review.reason}`));
      }
    }
  }

  const denied = [];
  const approved = [];

  for (const item of classified.filter(c => !c.allowed)) {
    denied.push({
      id: item.tc.id,
      name: item.tc.function.name,
      result: { error: item.reason || _('chat.denied') },
    });
  }

  for (const item of classified.filter(c => c.allowed && !c.needConfirm && !c.needAudit)) {
    approved.push(item.tc);
  }

  const confirmItems = classified.filter(c => c.allowed && c.needConfirm && !c.autoAccept);
  for (const item of confirmItems) {
    let args = {};
    try { args = JSON.parse(item.tc.function.arguments); } catch {}
    let confirmed = confirm;
    if (typeof confirm === 'function') {
      sb.pause();
      try {
        confirmed = await confirm(formatToolConfirmation(item.tc.function.name, args), ac.signal);
      } finally {
        sb.resume();
      }
    }
    const ok = typeof confirmed === 'object' ? confirmed.ok : confirmed;
    const userInput = typeof confirmed === 'object' ? confirmed.userInput : '';

    if (ok) {
      approved.push(item.tc);
    } else {
      denied.push({
        id: item.tc.id,
        name: item.tc.function.name,
        result: {
          error: _('chat.denied'),
          ...(userInput ? { userInput } : {}),
        },
      });
    }
  }

  const autoAcceptItems = classified.filter(c => c.autoAccept);
  if (autoAcceptItems.length > 0) {
    const waitSec = config.getAcceptAllWaitSeconds();

    for (let i = waitSec; i > 0; i--) {
      if (ac.signal.aborted) break;
      sb.setBar(_('chat.autoAcceptCountdown', { seconds: i }));
      await sleep(1000);
    }

    if (ac.signal.aborted) {
      for (const item of autoAcceptItems) {
        denied.push({
          id: item.tc.id, name: item.tc.function.name,
          result: { error: _('chat.canceledByUser') },
        });
      }
    } else {
      for (const item of autoAcceptItems) {
        approved.push(item.tc);
      }
    }
  }

  return { approved, results: denied };
}

module.exports = { resolveToolApprovals, CONFIRM_TOOLS };
