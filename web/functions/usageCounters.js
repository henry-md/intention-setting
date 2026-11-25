'use strict';

const { createHash } = require('node:crypto');

const COUNTER_KINDS = new Set(['legacy', 'installation', 'site', 'total']);
const COUNTER_FIELDS = new Set(['seconds', 'kind', 'siteKey', 'installationId']);
const RESERVED_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const COMMIT_BATCH_SIZE = 400;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Usage seconds must be a nonnegative safe integer.');
  return value;
}

function assertSite(siteKey) {
  if (typeof siteKey !== 'string' || !siteKey || siteKey.length > 253
    || /[\s/\\\u0000-\u001f]/u.test(siteKey) || RESERVED_KEYS.has(siteKey)) {
    throw new Error('Invalid usage counter site.');
  }
}

function assertInstallation(installationId) {
  if (typeof installationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(installationId)
    || RESERVED_KEYS.has(installationId)) throw new Error('Invalid usage counter installation.');
}

function assertIdentity(kind, siteKey, installationId) {
  if (!COUNTER_KINDS.has(kind)) throw new Error('Invalid usage counter kind.');
  if (kind === 'total') {
    if (siteKey !== '' || installationId !== '') throw new Error('Invalid total counter identity.');
  } else {
    assertSite(siteKey);
    if (kind === 'installation') assertInstallation(installationId);
    else if (installationId !== '') throw new Error('Invalid usage counter identity.');
  }
}

function assertLocation(uid, dayKey) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || /[/\\\u0000-\u001f]/u.test(uid)) {
    throw new Error('Invalid usage counter user.');
  }
  if (typeof dayKey !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/u.test(dayKey)) {
    throw new Error('Invalid usage counter day.');
  }
  const day = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== dayKey) {
    throw new Error('Invalid usage counter day.');
  }
}

function counterId(kind, siteKey = '', installationId = '') {
  assertIdentity(kind, siteKey, installationId);
  return createHash('sha256').update(JSON.stringify([kind, siteKey, installationId])).digest('hex');
}

function validateStoredCounter(id, value) {
  if (!isRecord(value) || Object.keys(value).length !== COUNTER_FIELDS.size
    || Object.keys(value).some((key) => !COUNTER_FIELDS.has(key))) {
    throw new Error('Stored usage counter has an invalid shape.');
  }
  assertIdentity(value.kind, value.siteKey, value.installationId);
  assertSeconds(value.seconds);
  if (id !== counterId(value.kind, value.siteKey, value.installationId)) {
    throw new Error('Stored usage counter identity does not match its document.');
  }
  return value;
}

function safeAdd(left, right) {
  return assertSeconds(left + right);
}

async function readUsageCounters(db, uid, dayKey) {
  assertLocation(uid, dayKey);
  // An Admin collection read has no client cache. A rejected read propagates;
  // it must never be mistaken for an empty set of counters.
  const snapshot = await db.collection('usageCounters').doc(uid)
    .collection('days').doc(dayKey).collection('values').get();
  if (!snapshot || !Array.isArray(snapshot.docs)) throw new Error('Invalid usage counter read response.');
  if (snapshot.docs.length === 0) return undefined;

  const legacySiteTotals = {};
  const installationUsage = {};
  const siteFloors = {};
  let totalFloor = 0;
  const seen = new Set();
  for (const document of snapshot.docs) {
    if (seen.has(document.id)) throw new Error('Duplicate stored usage counter.');
    seen.add(document.id);
    const value = validateStoredCounter(document.id, document.data());
    if (value.kind === 'total') totalFloor = value.seconds;
    else if (value.kind === 'legacy') legacySiteTotals[value.siteKey] = value.seconds;
    else if (value.kind === 'site') siteFloors[value.siteKey] = value.seconds;
    else {
      installationUsage[value.installationId] ||= { siteTotals: {}, updatedAt: 0 };
      installationUsage[value.installationId].siteTotals[value.siteKey] = value.seconds;
    }
  }

  const siteTotals = { ...legacySiteTotals };
  for (const usage of Object.values(installationUsage)) {
    for (const [site, seconds] of Object.entries(usage.siteTotals)) {
      siteTotals[site] = safeAdd(siteTotals[site] || 0, seconds);
    }
  }
  for (const [site, seconds] of Object.entries(siteFloors)) {
    siteTotals[site] = Math.max(siteTotals[site] || 0, seconds);
  }
  for (const [site, seconds] of Object.entries(siteTotals)) {
    if (seconds === 0) delete siteTotals[site];
  }
  const derivedTotal = Object.values(siteTotals).reduce(safeAdd, 0);
  return {
    usageFormatVersion: 2,
    legacySiteTotals,
    installationUsage,
    siteTotals,
    totalTimeSpent: Math.max(totalFloor, derivedTotal),
    trackedSiteCount: Object.keys(siteTotals).length,
  };
}

function countersForEntry(entry) {
  if (!isRecord(entry) || !isRecord(entry.siteTotals)) throw new Error('Invalid usage counter entry.');
  const counters = [];
  const add = (kind, siteKey, installationId, seconds) => {
    assertIdentity(kind, siteKey, installationId);
    counters.push({ kind, siteKey, installationId, seconds: assertSeconds(seconds) });
  };
  const addSites = (kind, siteTotals, installationId = '') => {
    if (!isRecord(siteTotals)) throw new Error('Invalid usage counter site totals.');
    for (const [site, seconds] of Object.entries(siteTotals)) add(kind, site, installationId, seconds);
  };
  addSites('legacy', entry.legacySiteTotals || {});
  if (!isRecord(entry.installationUsage || {})) throw new Error('Invalid usage counter installations.');
  for (const [installationId, usage] of Object.entries(entry.installationUsage || {})) {
    assertInstallation(installationId);
    if (!isRecord(usage) || !isRecord(usage.siteTotals)) throw new Error('Invalid usage installation totals.');
    addSites('installation', usage.siteTotals, installationId);
  }
  // Raise the contribution components before their derived floors. Retrying
  // after a partial multi-commit upload can only raise the same documents.
  addSites('site', entry.siteTotals);
  const total = Object.values(entry.siteTotals).reduce((sum, value) => safeAdd(sum, assertSeconds(value)), 0);
  add('total', '', '', entry.totalTimeSpent === undefined ? total : Math.max(total, assertSeconds(entry.totalTimeSpent)));
  return counters;
}

async function raiseUsageCounters({ projectId, idToken, uid, dayKey, entry, fetchImpl = fetch }) {
  assertLocation(uid, dayKey);
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(projectId)) throw new Error('Invalid usage counter project.');
  if (typeof idToken !== 'string' || !idToken) throw new Error('A Firebase ID token is required to raise usage counters.');
  const database = `projects/${projectId}/databases/(default)`;
  const collection = `${database}/documents/usageCounters/${uid}/days/${dayKey}/values`;
  const writes = countersForEntry(entry).map(({ kind, siteKey, installationId, seconds }) => ({
    update: {
      name: `${collection}/${counterId(kind, siteKey, installationId)}`,
      fields: {
        kind: { stringValue: kind },
        siteKey: { stringValue: siteKey },
        installationId: { stringValue: installationId },
      },
    },
    updateMask: { fieldPaths: ['kind', 'siteKey', 'installationId'] },
    updateTransforms: [{ fieldPath: 'seconds', maximum: { integerValue: String(seconds) } }],
  }));

  let writtenBatches = 0;
  for (let offset = 0; offset < writes.length; offset += COMMIT_BATCH_SIZE) {
    const response = await fetchImpl(`https://firestore.googleapis.com/v1/${database}/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: writes.slice(offset, offset + COMMIT_BATCH_SIZE) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Usage counter write failed (${response.status}).`);
    writtenBatches += 1;
  }
  return { writtenCounters: writes.length, writtenBatches };
}

module.exports = { counterId, readUsageCounters, raiseUsageCounters };
