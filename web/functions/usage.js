'use strict';

const MAX_SITES_PER_REQUEST = 1_000;
const MAX_SECONDS = 315_360_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const RESERVED_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSiteTotals(value, name) {
  if (!isRecord(value) || Object.keys(value).length > MAX_SITES_PER_REQUEST) {
    throw badRequest(`${name} must be an object with at most ${MAX_SITES_PER_REQUEST} sites.`);
  }

  const totals = {};
  for (const [site, seconds] of Object.entries(value)) {
    if (!site || site.length > 253 || /[\s/\\\u0000-\u001f]/u.test(site) || RESERVED_KEYS.has(site)) {
      throw badRequest(`${name} contains an invalid site key.`);
    }
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_SECONDS) {
      throw badRequest(`${name} must contain nonnegative integer seconds within the supported range.`);
    }
    if (seconds > 0) totals[site] = seconds;
  }
  return totals;
}

function validateUsageDay(dayKey, now = Date.now()) {
  if (typeof dayKey !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/u.test(dayKey)) {
    throw badRequest('dayKey must be a valid YYYY-MM-DD date.');
  }
  const date = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== dayKey || date > now + 2 * DAY_MS) {
    throw badRequest('dayKey must be a valid date that is not in the future.');
  }
  return date;
}

function validateUsagePayload(body, now = Date.now()) {
  if (!isRecord(body)) throw badRequest('Request body must be a JSON object.');
  if (typeof body.installationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(body.installationId) || RESERVED_KEYS.has(body.installationId)) {
    throw badRequest('installationId must be a stable installation identifier.');
  }
  const date = validateUsageDay(body.dayKey, now);
  if (!Number.isSafeInteger(body.periodStart) || body.periodStart < 0 || Math.abs(body.periodStart - date) > 2 * DAY_MS) {
    throw badRequest('periodStart must be a timestamp near the usage date.');
  }
  return {
    installationId: body.installationId,
    dayKey: body.dayKey,
    siteTotals: validateSiteTotals(body.siteTotals, 'siteTotals'),
    baselineSiteTotals: body.baselineSiteTotals === undefined
      ? {}
      : validateSiteTotals(body.baselineSiteTotals, 'baselineSiteTotals'),
    periodStart: body.periodStart,
  };
}

function normalizeStoredTotals(raw) {
  const totals = {};
  if (!isRecord(raw)) return totals;
  for (const [site, value] of Object.entries(raw)) {
    if (RESERVED_KEYS.has(site)) continue;
    const seconds = Math.floor(Number(value));
    if (Number.isSafeInteger(seconds) && seconds > 0) totals[site] = seconds;
  }
  return totals;
}

function sumContributions(installationUsage) {
  const totals = {};
  for (const usage of Object.values(installationUsage)) {
    for (const [site, seconds] of Object.entries(usage.siteTotals)) {
      const sum = (totals[site] || 0) + seconds;
      if (!Number.isSafeInteger(sum)) throw new Error('Stored usage exceeds the supported range.');
      totals[site] = sum;
    }
  }
  return totals;
}

function mergeStoredUsageEntries(authority, mirror) {
  const entries = [authority, mirror].filter(isRecord);
  if (entries.length === 0) return undefined;

  const legacySiteTotals = {};
  const aggregateFloors = {};
  const installationUsage = {};
  let totalFloor = 0;
  const timestamps = { periodStart: [], periodEnd: [], capturedAt: [] };
  const mergeMax = (target, source) => {
    for (const [site, seconds] of Object.entries(normalizeStoredTotals(source))) {
      target[site] = Math.max(target[site] || 0, seconds);
    }
  };

  for (const entry of entries) {
    mergeMax(legacySiteTotals, entry.legacySiteTotals);
    mergeMax(aggregateFloors, entry.siteTotals);
    if (Number.isSafeInteger(entry.totalTimeSpent) && entry.totalTimeSpent > totalFloor) {
      totalFloor = entry.totalTimeSpent;
    }
    for (const name of Object.keys(timestamps)) {
      if (Number.isSafeInteger(entry[name]) && entry[name] >= 0) timestamps[name].push(entry[name]);
    }
    for (const [id, usage] of Object.entries(isRecord(entry.installationUsage) ? entry.installationUsage : {})) {
      if (RESERVED_KEYS.has(id)) continue;
      installationUsage[id] ||= { siteTotals: {}, updatedAt: 0 };
      mergeMax(installationUsage[id].siteTotals, usage?.siteTotals);
      if (Number.isSafeInteger(usage?.updatedAt) && usage.updatedAt > installationUsage[id].updatedAt) {
        installationUsage[id].updatedAt = usage.updatedAt;
      }
    }
  }

  const contributionSum = sumContributions(installationUsage);
  // Reconcile aggregate floors only after combining the contribution maps.
  // A stale map must not turn an already saved contribution into new legacy time.
  for (const [site, floor] of Object.entries(aggregateFloors)) {
    legacySiteTotals[site] = Math.max(legacySiteTotals[site] || 0, floor - (contributionSum[site] || 0));
  }
  const siteTotals = {};
  for (const site of new Set([...Object.keys(legacySiteTotals), ...Object.keys(contributionSum)])) {
    const seconds = (legacySiteTotals[site] || 0) + (contributionSum[site] || 0);
    if (!Number.isSafeInteger(seconds)) throw new Error('Stored usage exceeds the supported range.');
    if (seconds > 0) siteTotals[site] = seconds;
  }
  const totalTimeSpent = Math.max(totalFloor, Object.values(siteTotals).reduce((sum, seconds) => sum + seconds, 0));
  if (!Number.isSafeInteger(totalTimeSpent)) throw new Error('Stored usage exceeds the supported range.');

  return {
    totalTimeSpent,
    trackedSiteCount: Object.keys(siteTotals).length,
    siteTotals,
    periodStart: timestamps.periodStart.length ? Math.min(...timestamps.periodStart) : 0,
    periodEnd: Math.max(0, ...timestamps.periodEnd),
    capturedAt: Math.max(0, ...timestamps.capturedAt),
    usageFormatVersion: 2,
    legacySiteTotals: normalizeStoredTotals(legacySiteTotals),
    installationUsage,
  };
}

function mergeUsageEntry(existing, payload, now = Date.now()) {
  const installationUsage = {};
  for (const [id, usage] of Object.entries(existing?.installationUsage || {})) {
    if (!RESERVED_KEYS.has(id)) {
      installationUsage[id] = {
        siteTotals: normalizeStoredTotals(usage?.siteTotals),
        updatedAt: Number.isSafeInteger(usage?.updatedAt) ? usage.updatedAt : now,
      };
    }
  }

  const existingTotals = normalizeStoredTotals(existing?.siteTotals);
  const legacySiteTotals = normalizeStoredTotals(existing?.legacySiteTotals);
  const previousContributionSum = sumContributions(installationUsage);
  // Preserve previously saved aggregates even if an older client left their
  // contribution breakdown incomplete. This residual is added only once.
  for (const [site, total] of Object.entries(existingTotals)) {
    legacySiteTotals[site] = Math.max(legacySiteTotals[site] || 0, total - (previousContributionSum[site] || 0));
  }

  const previousContribution = installationUsage[payload.installationId]?.siteTotals || {};
  const contributionTotals = { ...previousContribution };
  let ignoredStaleContributionCount = 0;
  const submittedSites = new Set([...Object.keys(payload.siteTotals), ...Object.keys(payload.baselineSiteTotals)]);
  for (const site of submittedSites) {
    const seconds = payload.siteTotals[site] || 0;
    if (seconds < (contributionTotals[site] || 0)) ignoredStaleContributionCount += 1;
    const otherUsage = (legacySiteTotals[site] || 0)
      + (previousContributionSum[site] || 0) - (previousContribution[site] || 0);
    contributionTotals[site] = Math.max(
      contributionTotals[site] || 0,
      seconds,
      (payload.baselineSiteTotals[site] || 0) - otherUsage
    );
  }
  installationUsage[payload.installationId] = { siteTotals: contributionTotals, updatedAt: now };

  const contributionSum = sumContributions(installationUsage);
  const siteTotals = {};
  const sites = new Set([...Object.keys(legacySiteTotals), ...Object.keys(contributionSum)]);
  for (const site of sites) {
    const seconds = (legacySiteTotals[site] || 0) + (contributionSum[site] || 0);
    if (!Number.isSafeInteger(seconds)) throw new Error('Stored usage exceeds the supported range.');
    if (seconds > 0) siteTotals[site] = seconds;
  }
  const totalTimeSpent = Math.max(
    Number.isSafeInteger(existing?.totalTimeSpent) ? existing.totalTimeSpent : 0,
    Object.values(siteTotals).reduce((sum, seconds) => sum + seconds, 0)
  );
  if (!Number.isSafeInteger(totalTimeSpent)) throw new Error('Stored usage exceeds the supported range.');

  return {
    entry: {
      totalTimeSpent,
      trackedSiteCount: Object.keys(siteTotals).length,
      siteTotals,
      periodStart: Number.isSafeInteger(existing?.periodStart) && existing.periodStart > 0 ? existing.periodStart : payload.periodStart,
      periodEnd: Math.max(Number.isSafeInteger(existing?.periodEnd) ? existing.periodEnd : 0, now),
      capturedAt: now,
      usageFormatVersion: 2,
      legacySiteTotals: normalizeStoredTotals(legacySiteTotals),
      installationUsage,
    },
    contributionTotals,
    ignoredStaleContributionCount,
  };
}

function sameUsageCounters(first, second) {
  const sameTotals = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .every((key) => (a[key] || 0) === (b[key] || 0));
  const installations = new Set([
    ...Object.keys(first.installationUsage || {}), ...Object.keys(second.installationUsage || {}),
  ]);
  return first.totalTimeSpent === second.totalTimeSpent
    && sameTotals(first.siteTotals, second.siteTotals)
    && sameTotals(first.legacySiteTotals, second.legacySiteTotals)
    && [...installations].every((id) => sameTotals(
      first.installationUsage?.[id]?.siteTotals, second.installationUsage?.[id]?.siteTotals
    ));
}

async function syncUsageForUser(db, uid, payload, now = Date.now(), counters) {
  if (!counters?.read || !counters?.raise) throw new Error('Guarded usage counter storage is required.');
  // A failed authority read aborts the request. It must never become an empty
  // baseline that can overwrite previously saved usage.
  const authority = await counters.read();
  const userRef = db.collection('users').doc(uid);
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const existing = mergeStoredUsageEntries(authority, snapshot.data()?.dailyUsageHistory?.[payload.dayKey]);
    const result = mergeUsageEntry(existing, payload, now);
    transaction.set(userRef, { dailyUsageHistory: { [payload.dayKey]: result.entry } }, { merge: true });
    return result;
  });
  // The numeric write is a database maximum transform, authenticated as the
  // caller so the database's nondecreasing/delete-denial rules apply too.
  await counters.raise(result.entry);
  const confirmed = await counters.read();
  if (!confirmed) throw new Error('Usage counter durability could not be confirmed.');
  const durableEntry = mergeStoredUsageEntries(confirmed, result.entry);
  // Repair the mirror and activate its client-write protection together, after
  // the independent counter has committed. Re-read any intervening legacy write.
  const entry = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const latest = mergeStoredUsageEntries(durableEntry, snapshot.data()?.dailyUsageHistory?.[payload.dayKey]);
    transaction.set(userRef, { dailyUsageHistory: { [payload.dayKey]: latest }, usageCountersVersion: 1 }, { merge: true });
    return latest;
  });
  if (!sameUsageCounters(durableEntry, entry)) await counters.raise(entry);
  return {
    ...result,
    entry,
    contributionTotals: entry.installationUsage?.[payload.installationId]?.siteTotals || {},
  };
}

module.exports = { validateUsageDay, validateUsagePayload, mergeStoredUsageEntries, mergeUsageEntry, syncUsageForUser };
