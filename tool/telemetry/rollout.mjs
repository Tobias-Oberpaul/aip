import { createInterface } from 'node:readline';
import historyStore from './.codex/hooks/context-history.cjs';

const { savedTranscripts } = historyStore;

function quota(payload) {
  const limits = payload.rate_limits;
  if (limits?.limit_id && limits.limit_id !== 'codex') return null;
  const window = [limits?.primary, limits?.secondary].find((entry) => entry?.window_minutes === 300);
  return Number.isFinite(window?.used_percent) && Number.isFinite(window.resets_at)
    ? { used: window.used_percent, resetsAt: window.resets_at } : null;
}

export async function readRolloutUsage(project, packages, attempts) {
  const sessions = new Map();
  for (const item of packages) {
    for (const step of Array.isArray(item?.subtasks) ? item.subtasks : []) {
      if (!step?.sessionId || !step.turnId) continue;
      if (!sessions.has(step.sessionId)) sessions.set(step.sessionId, new Set());
      sessions.get(step.sessionId).add(step.turnId);
    }
  }
  for (const { sessionId } of attempts) {
    if (sessionId && !sessions.has(sessionId)) sessions.set(sessionId, new Set());
  }
  const rows = [];
  const quotas = new Map();
  const timings = new Map();
  const startContexts = new Map();
  const latestContexts = new Map();
  const runSettings = new Map();
  const accountUsage = new Map();
  const unassigned = new Map();
  if (!sessions.size) return { rows, quotas, accountUsage, unassigned, timings, startContexts, latestContexts, runSettings };
  for await (const { id, input } of savedTranscripts(project, sessions)) {
    const turns = sessions.get(id);
    sessions.delete(id);
    let current, started, model, before, latest, observed, previousTotal;
    function recordQuota() {
      if (!current || !observed) return;
      const sameWindow = before && Math.abs(before.resetsAt - observed.resetsAt) <= 2;
      const withinWindow = started >= observed.resetsAt - 18000 && started < observed.resetsAt;
      if (!sameWindow && !withinWindow) return;
      const used = sameWindow && observed.used >= before.used ? observed.used - before.used : null;
      if (turns.has(current)) quotas.set(JSON.stringify([id, current]), { resetsAt: observed.resetsAt, used });
      else if (used > 0) {
        const group = unassigned.get(observed.resetsAt) ?? { count: 0, used: 0 };
        group.count++;
        group.used += used;
        unassigned.set(observed.resetsAt, group);
      }
    }
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.includes('"token_count"') && !line.includes('"task_started"') &&
            !line.includes('"task_complete"') && !line.includes('"turn_context"')) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        const payload = event?.payload;
        if (!payload) continue;
        if (event.type === 'turn_context') {
          if (payload.turn_id === current) model = payload.model;
          if (turns.has(payload.turn_id)) {
            const key = JSON.stringify([id, payload.turn_id]);
            const previous = runSettings.get(key);
            const sameModel = !payload.model || !previous?.model || previous.model === payload.model;
            runSettings.set(key, {
              model: payload.model ?? previous?.model,
              effort: payload.effort ?? (sameModel ? previous?.effort : undefined),
            });
          }
        }
        if (event.type !== 'event_msg') continue;
        if (payload.type === 'task_started') {
          recordQuota();
          current = payload.turn_id;
          started = Date.parse(event.timestamp) / 1000;
          model = null;
          before = latest;
          observed = null;
        } else if (payload.type === 'task_complete' && payload.turn_id === current) {
          const endedAt = Date.parse(event.timestamp);
          if (turns.has(current) && Number.isFinite(started) && endedAt >= started * 1000) {
            timings.set(JSON.stringify([id, current]), { startedAt: started * 1000, endedAt });
          }
          recordQuota();
          current = null;
        } else if (payload.type === 'token_count') {
          const snapshot = quota(payload);
          if (snapshot && turns.size) {
            latest = snapshot;
            accountUsage.set(snapshot.resetsAt, Math.max(accountUsage.get(snapshot.resetsAt) ?? 0, snapshot.used));
            if (current) observed = snapshot;
          }
          const cumulative = payload.info?.total_token_usage?.total_tokens;
          if (!Number.isSafeInteger(cumulative) || cumulative === previousTotal) continue;
          const input = payload.info?.last_token_usage?.input_tokens;
          const limit = payload.info?.model_context_window;
          const context = model && Number.isSafeInteger(input) && input >= 0 && Number.isSafeInteger(limit) && limit > 0
            ? { model, input, limit, percent: 100 * input / limit } : null;
          const observedAt = Date.parse(event.timestamp);
          if (current && context && Number.isFinite(started)) {
            latestContexts.set(id, { ...context, observedAt: Number.isFinite(observedAt) ? observedAt : started * 1000 });
          }
          if (turns.has(current)) {
            const key = JSON.stringify([id, current]);
            if (!startContexts.has(key)) {
              startContexts.set(key, context);
            }
          }
          const last = payload.info?.last_token_usage?.total_tokens;
          if (turns.has(current) && Number.isSafeInteger(last) && last >= 0) {
            rows.push({ sessionId: id, turnId: current, model, tokens: last });
          }
          previousTotal = cumulative;
        }
      }
      recordQuota();
    } finally {
      lines.close();
      input.destroy();
    }
    if (!sessions.size) break;
  }
  return { rows, quotas, accountUsage, unassigned, timings, startContexts, latestContexts, runSettings };
}
