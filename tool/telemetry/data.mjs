import { basename } from 'node:path';
import { readRolloutUsage } from './rollout.mjs';
import store from './.codex/hooks/performance-store.cjs';

const count = (value) => Number.isSafeInteger(value) && value >= 0;
const performanceEpic = name => name === 'AI Analytics' ? 'AI Performance' : name;
const epicName = item => performanceEpic(typeof item?.epic === 'string' ? item.epic.trim() : '');
const timestamp = (value) => Number.isFinite(value) ? value : null;
const activityTime = (item) => item.endedAt ?? item.startedAt ?? Number.MIN_SAFE_INTEGER;
const newestFirst = (a, b) => activityTime(b) - activityTime(a);

function timeRange(steps) {
  const timed = steps.filter((step) => Number.isFinite(step.startedAt));
  return timed.length ? { startedAt: Math.min(...timed.map((step) => step.startedAt)),
    endedAt: Math.max(...timed.map((step) => step.endedAt)) } : null;
}

function totalTokens(usage) {
  const total = usage?.total_tokens ?? usage?.totalTokens;
  if (count(total)) return total;
  const input = usage?.input_tokens ?? usage?.inputTokens;
  const output = usage?.output_tokens ?? usage?.outputTokens;
  return count(input) && count(output) ? input + output : null;
}

function totals(rows) {
  const measured = rows.filter((row) => row.tokens !== null);
  return {
    attempts: rows.length,
    measured: measured.length,
    tokens: measured.length ? measured.reduce((sum, row) => sum + row.tokens, 0) : null,
  };
}

function quotaCoverage(history) {
  const windows = [];
  const find = (end) => windows.find(window => Math.abs(window.resetsAt - end) <= 2);
  for (const [resetsAt, used] of [...(history.accountUsage ?? [])].sort(([a], [b]) => a - b)) {
    // Zero-use snapshots can carry a provisional reset before the actual window appears.
    if (used === 0) continue;
    const existing = find(resetsAt);
    if (existing) existing.observed = Math.max(existing.observed, used);
    else windows.push({ resetsAt, observed: used, assigned: 0, unassigned: 0, runs: 0 });
  }
  for (const { resetsAt, used } of history.quotas.values()) {
    const window = find(resetsAt);
    if (window && Number.isFinite(used)) window.assigned += used;
  }
  for (const [resetsAt, { used, count }] of history.unassigned ?? []) {
    const window = find(resetsAt);
    if (window) {
      window.unassigned += used;
      window.runs += count;
    }
  }
  const summary = { observed: 0, assigned: 0, unassigned: 0, unexplained: 0, unused: 0, windows: 0, inconsistent: 0 };
  for (const window of windows) {
    const gap = window.observed - window.assigned - window.unassigned;
    window.inconsistent = gap < -1e-6 || window.observed < 0 || window.observed > 100;
    window.unexplained = window.inconsistent ? null : Math.max(0, gap);
    window.unused = window.inconsistent ? null : 100 - window.observed;
    if (window.inconsistent) {
      summary.inconsistent++;
    } else if (window.observed > 0) {
      summary.windows++;
      for (const field of ['observed', 'assigned', 'unassigned', 'unexplained', 'unused']) summary[field] += window[field];
    }
  }
  function matchTime({ startedAt, endedAt }) {
    if (!Number.isFinite(startedAt)) return undefined;
    const start = startedAt / 1000;
    const end = Number.isFinite(endedAt) ? Math.max(start, endedAt / 1000) : start;
    const matches = windows.filter(window => start < window.resetsAt && end >= window.resetsAt - 18000);
    return matches.length === 1 ? matches[0].resetsAt : undefined;
  }
  return { summary, find, matchTime };
}

const contextBaseline = 25;
const contextLimitWarning = 95;
const effortWarning = 0.30;

export function chatContextAdvisory(observation, tickets, projectHistory = []) {
  if (!observation || !Number.isFinite(observation.percent)) return null;
  const earlyChat = observation.percent < contextBaseline;
  const baseline = earlyChat ? projectHistory : tickets.filter(ticket => ticket.startContext?.percent < contextBaseline);
  const recent = earlyChat ? tickets : tickets.filter(ticket => ticket.startContext?.percent >= contextBaseline)
    .sort((a, b) => b.completedAt - a.completedAt).slice(0, 5);
  const comparisons = {};
  for (const [key, rate, total] of [
    ['tokens', 'tokensPerPoint', 'tokens'],
    ['time', 'workSecondsPerPoint', 'workSeconds'],
  ]) {
    const aggregate = group => {
      const measured = group.filter(ticket => Number.isFinite(ticket[rate]));
      const points = measured.reduce((sum, ticket) => sum + ticket.points, 0);
      const effort = measured.reduce((sum, ticket) => sum + ticket[total], 0);
      return { count: measured.length, rate: points ? effort / points : null };
    };
    const reference = aggregate(baseline);
    const current = aggregate(recent);
    if (reference.count >= 5 && current.count >= 5 && reference.rate > 0) {
      comparisons[key] = { baseline: reference, recent: current, change: (current.rate - reference.rate) / reference.rate };
    }
  }
  const elevated = earlyChat ? []
    : Object.entries(comparisons).filter(([, metric]) => metric.change >= effortWarning).map(([key]) => key);
  return { ...observation, baselineLimit: contextBaseline, limitWarning: observation.percent >= contextLimitWarning,
    elevated, comparisons };
}

export async function readAnalytics(project, epic = null) {
  const { packages, usage, runs, quotaSnapshots, migration } = store.withStore(project, db => ({
    packages: store.records(db, 'ticket'), usage: store.records(db, 'attempt'),
    runs: store.records(db, 'run'), quotaSnapshots: store.records(db, 'quota'),
    migration: store.records(db, 'meta')[0],
  }));
  const epics = [...new Set(packages.map(epicName).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'en-GB'));
  const scopedAttempts = new Set();

  const history = await readRolloutUsage(project, packages, usage);
  const coverage = quotaCoverage(history);
  const turnKey = (row) => JSON.stringify([row.sessionId, row.turnId]);
  const recovered = new Map();
  for (const row of history.rows) {
    const key = turnKey(row);
    recovered.set(key, (recovered.get(key) ?? 0) + 1);
  }
  const direct = new Map();
  const bySession = new Map();
  const attemptSettings = new Map();
  const skipped = migration.skipped;
  for (const event of usage) {
    const row = { ...event, tokens: totalTokens(event.tokenUsage) };
    const key = turnKey(row);
    if (row.model || row.effort) {
      const previous = attemptSettings.get(key);
      attemptSettings.set(key, { model: row.model ?? previous?.model, effort: row.effort ?? previous?.effort });
    }
    const rows = direct.get(key) ?? [];
    rows.push(row);
    direct.set(key, rows);
  }
  // Keep a single source per turn. A stored snapshot may lag behind live capture.
  const useDirect = new Set([...direct].filter(([key, rows]) =>
    rows.filter(row => Number.isFinite(row.tokens)).length > (recovered.get(key) ?? 0)).map(([key]) => key));
  const attempts = history.rows.filter(row => !useDirect.has(turnKey(row)));
  for (const [key, rows] of direct) {
    if (!recovered.has(key) || useDirect.has(key)) attempts.push(...rows);
  }
  function settingsForRun(key) {
    const captured = history.runSettings.get(key);
    const attempt = attemptSettings.get(key);
    return {
      model: captured?.model ?? attempt?.model ?? null,
      effort: captured?.effort ?? (captured?.model && attempt?.model && captured.model !== attempt.model ? null : attempt?.effort) ?? null,
    };
  }
  for (const row of attempts) {
    if (!row.sessionId) continue;
    if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, []);
    bySession.get(row.sessionId).push(row);
  }
  const runsByTicket = new Map();
  const unassignedRuns = [];
  const ticketIds = new Set(packages.map(ticket => ticket.id));
  const codexLinks = new Set(packages.flatMap(ticket => (ticket.subtasks ?? []).map(turnKey)));
  const legacyLinks = packages.filter(ticket => !ticket.subtasks && Array.isArray(ticket.sessionIds));
  for (const [sessionId, rows] of bySession) {
    const turns = new Map();
    for (const row of rows) {
      if (!row.turnId || codexLinks.has(turnKey(row)) || legacyLinks.some(ticket =>
        ticket.sessionIds.includes(sessionId) && (!ticket.turnIds || ticket.turnIds.includes(row.turnId)))) continue;
      if (!turns.has(row.turnId)) turns.set(row.turnId, []);
      turns.get(row.turnId).push(row);
    }
    for (const [turnId, entries] of turns) {
      const stats = totals(entries);
      unassignedRuns.push({ id: `${sessionId}:${turnId}`, provider: 'codex', name: 'Codex run',
        sessionId, turnId, ...settingsForRun(turnKey({ sessionId, turnId })), tokens: stats.tokens,
        partialUsage: stats.tokens !== null && stats.measured < stats.attempts });
    }
  }
  for (const run of runs) {
    if (!ticketIds.has(run.ticketId)) {
      unassignedRuns.push(run);
      continue;
    }
    if (!runsByTicket.has(run.ticketId)) runsByTicket.set(run.ticketId, []);
    runsByTicket.get(run.ticketId).push(run);
  }

  const latestContext = [...history.latestContexts].sort(([, a], [, b]) => b.observedAt - a.observedAt)[0];
  const latestSessionId = latestContext?.[0];
  const earlyChat = latestContext?.[1].percent < contextBaseline;
  const projectHistory = [];
  const completedTickets = [];
  const ticketsByContext = new Map();
  const windows = new Map();
  function windowFor(resetsAt) {
    const key = resetsAt == null ? null : [...windows.keys()].find((end) => end !== null && Math.abs(end - resetsAt) <= 2) ?? resetsAt;
    if (!windows.has(key)) windows.set(key, { resetsAt: key, items: [], quotas: new Map() });
    return windows.get(key);
  }
  const items = packages.flatMap((item, index) => {
    if (!item || typeof item.id !== 'string' || (item.subtasks === undefined
      ? !Array.isArray(item.sessionIds) || (item.turnIds !== undefined && !Array.isArray(item.turnIds))
      : !Array.isArray(item.subtasks))) {
      throw new Error(`Invalid entry ${index + 1} in context-packages.json.`);
    }
    const seen = new Set();
    const ticketTime = { startedAt: timestamp(Date.parse(item.startedAt)),
      endedAt: timestamp(Date.parse(item.completedAt ?? item.acceptedAt)) };
    const steps = item.subtasks?.map((step) => {
      if (!step || typeof step.sessionId !== 'string' || typeof step.turnId !== 'string' ||
          typeof step.name !== 'string' || !['implementation', 'feedback', 'handoff'].includes(step.kind)) {
        throw new Error(`Invalid subtask in ticket ${item.id}.`);
      }
      const key = JSON.stringify([step.sessionId, step.turnId]);
      if (seen.has(key)) throw new Error(`Duplicate run in ticket ${item.id}.`);
      seen.add(key);
      const rows = (bySession.get(step.sessionId) ?? []).filter((row) => row.turnId === step.turnId);
      const stats = totals(rows);
      const quota = history.quotas.get(key);
      const timing = history.timings?.get(key) ?? (item.subtasks.length === 1 ? ticketTime : null);
      return { rows, resetsAt: quota?.resetsAt ?? coverage.matchTime(timing ?? {}), detail: { key, name: step.name, kind: step.kind,
        provider: 'codex', ...settingsForRun(key),
        workSeconds: count(step.workSeconds) ? step.workSeconds : null,
        tokens: stats.tokens, partialUsage: stats.tokens !== null && stats.measured < stats.attempts,
        quotaUsed: quota?.used ?? null, ...timing } };
    });
    const rows = steps ? steps.flatMap((step) => step.rows)
      : [...new Set(item.sessionIds)].flatMap((id) => bySession.get(id) ?? [])
        .filter((row) => item.turnIds === undefined || item.turnIds.includes(row.turnId));
    const codexSteps = steps?.map((step) => step.detail) ?? [];
    const additionalRuns = runsByTicket.get(item.id) ?? [];
    const subtasks = [...codexSteps, ...additionalRuns.map(run => ({
      ...run, key: JSON.stringify([run.provider, run.id]), tokens: null, quotaUsed: null,
      startedAt: timestamp(Date.parse(run.startedAt)), endedAt: timestamp(Date.parse(run.endedAt)),
    }))];
    const firstImplementation = subtasks.find(step => step.kind === 'implementation');
    const measuredQuotas = subtasks.map((step) => step.quotaUsed).filter((value) => value !== null);
    const stats = totals(rows);
    const started = Date.parse(item.startedAt);
    const accepted = Date.parse(item.acceptedAt);
    const completedAt = item.completedAt === undefined ? accepted : Date.parse(item.completedAt);
    const completed = Number.isFinite(completedAt);
    const name = typeof item.name === 'string' ? item.name.trim() || item.id : item.id;
    const result = { ...stats, id: item.id, name, epic: epicName(item), points: item.points,
      description: typeof item.description === 'string' ? item.description.trim() : '',
      completed, completedAt: timestamp(completedAt), accepted: completed && Number.isFinite(accepted), subtasks,
      ...(steps ? {} : { legacyRunSettings: [...new Set(rows.map(turnKey))].map(key => ({ provider: 'codex', ...settingsForRun(key) })) }),
      startContext: firstImplementation ? history.startContexts?.get(firstImplementation.key) ?? null : null,
      ...(timeRange(subtasks) ?? { startedAt: timestamp(started), endedAt: timestamp(Date.parse(item.completedAt ?? item.acceptedAt)) }),
      quotaUsed: measuredQuotas.length ? measuredQuotas.reduce((sum, value) => sum + value, 0) : null,
      partialQuota: measuredQuotas.length > 0 && measuredQuotas.length < subtasks.length,
      correctionRounds: steps ? subtasks.filter((step) => step.kind === 'feedback').length : item.correctionRounds,
      workSeconds: steps || additionalRuns.length
        ? subtasks.length && subtasks.every((step) => step.workSeconds !== null)
          ? subtasks.reduce((sum, step) => sum + step.workSeconds, 0) : null
        : count(item.workSeconds) ? item.workSeconds : null,
      minutes: !steps && accepted >= started ? Math.round((accepted - started) / 60000) : null };
    const linked = steps ? steps.every((step) => step.rows.length > 0) : item.turnIds === undefined
      ? item.sessionIds.every((id) => rows.some((row) => row.sessionId === id))
      : item.turnIds.every((id) => rows.some((row) => row.turnId === id));
    result.partialUsage = stats.tokens !== null && (!linked || stats.measured < stats.attempts);
    const hasPoints = Number.isFinite(result.points) && result.points > 0;
    result.workSecondsPerPoint = hasPoints && Number.isFinite(result.workSeconds) ? result.workSeconds / result.points : null;
    result.tokensPerPoint = hasPoints && Number.isFinite(result.tokens) && !result.partialUsage &&
      subtasks.every(step => step.provider === 'codex') ? result.tokens / result.points : null;
    if (result.completed && hasPoints) {
      completedTickets.push(result);
      if (earlyChat && !(item.subtasks
        ? item.subtasks.some(step => step.sessionId === latestSessionId)
        : item.sessionIds.includes(latestSessionId))) {
        projectHistory.push(result);
      }
      const sessionId = item.subtasks?.[0]?.sessionId;
      if (sessionId && !additionalRuns.length && item.subtasks.every(step => step.sessionId === sessionId)) {
        const cohort = ticketsByContext.get(sessionId) ?? [];
        cohort.push(result);
        ticketsByContext.set(sessionId, cohort);
      }
    }
    if (epic !== null && result.epic !== performanceEpic(epic)) return [];
    if (epic !== null) rows.forEach((row) => scopedAttempts.add(row));
    if (!steps?.length) {
      if (!additionalRuns.length) windowFor(coverage.matchTime(ticketTime)).items.push(result);
    }
    else {
      const byWindow = new Map();
      for (const step of steps) {
        const window = windowFor(step.resetsAt);
        if (!byWindow.has(window)) byWindow.set(window, []);
        byWindow.get(window).push(step);
        window.quotas.set(step.detail.key, step.detail.quotaUsed);
      }
      for (const [window, selected] of byWindow) {
        if (selected.length === steps.length && !additionalRuns.length) {
          window.items.push(result);
          continue;
        }
        const details = selected.map((step) => step.detail);
        const stats = totals(selected.flatMap((step) => step.rows));
        const measured = details.filter((step) => step.quotaUsed !== null);
        window.items.push({ ...result, ...stats, subtasks: details, partialWindow: true,
          ...(timeRange(details) ?? { startedAt: null, endedAt: null }),
          partialUsage: stats.tokens !== null && (stats.measured < stats.attempts || selected.some((step) => !step.rows.length)),
          quotaUsed: measured.length ? measured.reduce((sum, step) => sum + step.quotaUsed, 0) : null,
          partialQuota: measured.length > 0 && measured.length < details.length,
          workSeconds: details.every((step) => step.workSeconds !== null) ? details.reduce((sum, step) => sum + step.workSeconds, 0) : null,
          correctionRounds: details.filter((step) => step.kind === 'feedback').length });
      }
    }
    return [result];
  });
  const scores = new Map();
  const contextDomains = Object.fromEntries(['tokensPerPoint', 'workSecondsPerPoint', 'correctionRounds'].map(field => [
    field, completedTickets.reduce((domain, item) => {
      if (!Number.isFinite(item[field])) return domain;
      domain.maxValue = Math.max(domain.maxValue, item[field]);
      if (Number.isFinite(item.startContext?.percent)) domain.maxContext = Math.max(domain.maxContext, item.startContext.percent);
      else domain.hasUnknown = true;
      return domain;
    }, { maxValue: 0, maxContext: 100, hasUnknown: false }),
  ]));
  const benchmark = { tokensPerPoint: null, workSecondsPerPoint: null };
  for (const [scoreField, rateField, totalField] of [
    ['tokenScore', 'tokensPerPoint', 'tokens'],
    ['timeScore', 'workSecondsPerPoint', 'workSeconds'],
  ]) {
    if (scoreField === 'tokenScore' && skipped) continue;
    const eligible = completedTickets.filter(item => item[rateField] > 0);
    if (eligible.length < 3) continue;
    const total = eligible.reduce((sum, item) => sum + item[totalField], 0);
    const points = eligible.reduce((sum, item) => sum + item.points, 0);
    benchmark[rateField] = total / points;
    for (const item of eligible) {
      const score = Math.round(100 * benchmark[rateField] / item[rateField]);
      scores.set(item.id, { ...scores.get(item.id), [scoreField]: score });
    }
  }
  const displayItems = (entries) => [...entries].sort(newestFirst).map(item => ({
    ...item, subtasks: [...item.subtasks].sort(newestFirst),
    tokenScore: null, timeScore: null,
    ...(item.partialWindow ? { tokensPerPoint: null, workSecondsPerPoint: null } : scores.get(item.id)),
  }));
  const quotaWindows = [...windows.values()].sort((a, b) => (b.resetsAt ?? 0) - (a.resetsAt ?? 0)).map(({ resetsAt, items, quotas }) => {
    const measured = [...quotas.values()].filter((value) => value !== null);
    return { resetsAt, items: displayItems(items), partial: measured.length < quotas.size,
      used: measured.length ? measured.reduce((sum, value) => sum + value, 0) : null,
      coverage: resetsAt === null ? null : coverage.find(resetsAt) ?? null };
  });
  const latestQuota = new Map();
  for (const quota of quotaSnapshots) {
    const key = JSON.stringify([quota.provider, quota.account, quota.unit, quota.periodStart, quota.periodEnd]);
    if (!latestQuota.has(key) || Date.parse(latestQuota.get(key).observedAt) < Date.parse(quota.observedAt)) latestQuota.set(key, quota);
  }
  const chatContext = latestContext ? chatContextAdvisory({ ...latestContext[1], provider: 'codex' },
    ticketsByContext.get(latestSessionId) ?? [], projectHistory) : null;
  return { project: basename(project), hasLog: migration.hadUsage || usage.length > 0 || history.rows.length > 0 || runs.length > 0,
    chatContext,
    skipped, epics, unassignedRuns, benchmark, contextDomains, quotaSnapshots: [...latestQuota.values()],
    ...totals(epic === null ? attempts : [...scopedAttempts]), items: displayItems(items), quotaWindows, coverage: coverage.summary };
}
