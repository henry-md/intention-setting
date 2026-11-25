const assert = require('node:assert/strict');
const test = require('node:test');
const { counterId, readUsageCounters, raiseUsageCounters } = require('./usageCounters');

const projectId = 'counter-test-project';
const uid = 'test-user';
const dayKey = '2026-11-25';
const idToken = 'test-firebase-id-token';
const site = 'chess.com';
const installationId = 'installation-a';
const prefix = (day = dayKey) => `usageCounters/${uid}/days/${day}/values`;
const fullPrefix = (day = dayKey) => `projects/${projectId}/databases/(default)/documents/${prefix(day)}`;

function entry(seconds, extra = {}) {
  return {
    siteTotals: { [site]: seconds },
    legacySiteTotals: {},
    installationUsage: { [installationId]: { siteTotals: { [site]: seconds }, updatedAt: 0 } },
    totalTimeSpent: seconds,
    ...extra,
  };
}

function createStore() {
  const documents = new Map();
  const requests = [];
  let failRead;
  let failBatch;
  const node = (path) => ({
    collection: (name) => node(`${path}/${name}`),
    doc: (id) => node(`${path}/${id}`),
    get: async () => {
      if (failRead) throw failRead;
      const docs = [...documents.entries()]
        .filter(([name]) => name.startsWith(`${path}/`) && name.slice(path.length + 1).split('/').length === 1)
        .map(([name, value]) => ({ id: name.split('/').at(-1), data: () => structuredClone(value) }));
      return { docs };
    },
  });
  const db = { collection: (name) => node(name) };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options: { ...options, body: JSON.parse(options.body) } });
    if (failBatch === requests.length) return { ok: false, status: 503 };
    assert.equal(url, `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${idToken}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    for (const write of JSON.parse(options.body).writes) {
      assert.deepEqual(write.updateMask.fieldPaths, ['kind', 'siteKey', 'installationId']);
      assert.equal('seconds' in write.update.fields, false, 'seconds must never be assigned by the writer');
      assert.equal('delete' in write, false);
      assert.equal('transform' in write, false);
      assert.equal(write.updateTransforms.length, 1);
      const transform = write.updateTransforms[0];
      assert.deepEqual(Object.keys(transform), ['fieldPath', 'maximum']);
      assert.equal(transform.fieldPath, 'seconds');
      const seconds = Number(transform.maximum.integerValue);
      assert.equal(Number.isSafeInteger(seconds), true);
      assert.ok(seconds >= 0);
      const path = write.update.name.split('/documents/')[1];
      const previous = documents.get(path) || {};
      const metadata = Object.fromEntries(Object.entries(write.update.fields).map(([key, value]) => [key, value.stringValue]));
      documents.set(path, { ...previous, ...metadata, seconds: Math.max(previous.seconds || 0, seconds) });
    }
    return { ok: true, status: 200 };
  };
  return {
    documents, requests, db,
    failRead: (error) => { failRead = error; },
    failBatch: (batch) => { failBatch = batch; },
    read: (day = dayKey) => readUsageCounters(db, uid, day),
    raise: (value, day = dayKey) => raiseUsageCounters({ projectId, idToken, uid, dayKey: day, entry: value, fetchImpl }),
  };
}

test('counter identities are stable and distinct across kinds, sites, and installations', () => {
  assert.equal(counterId('installation', site, installationId), counterId('installation', site, installationId));
  const ids = [
    counterId('installation', site, installationId),
    counterId('installation', site, 'installation-b'),
    counterId('installation', 'youtube.com', installationId),
    counterId('legacy', site), counterId('site', site), counterId('total'),
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-f0-9]{64}$/.test(id)));
});

test('native maximum creates missing counters and preserves larger saved values across stale writes', async () => {
  const store = createStore();
  assert.equal(await store.read(), undefined);
  for (const [submitted, expected] of [[50, 50], [10, 50], [50, 50], [55, 55], [0, 55]]) {
    await store.raise(entry(submitted));
    const saved = await store.read();
    assert.equal(saved.siteTotals[site], expected);
    assert.equal(saved.installationUsage[installationId].siteTotals[site], expected);
    assert.equal(saved.totalTimeSpent, expected);
  }
  assert.equal(store.documents.size, 3, 'Only contribution, site, and total counter documents are needed');
});

test('all requests use the caller token and maximum transforms without setting seconds', async () => {
  const store = createStore();
  const result = await store.raise(entry(5, { legacySiteTotals: { [site]: 100 }, siteTotals: { [site]: 105 }, totalTimeSpent: 105 }));
  assert.deepEqual(result, { writtenCounters: 4, writtenBatches: 1 });
  for (const request of store.requests) {
    assert.equal(request.options.headers.Authorization, `Bearer ${idToken}`);
    for (const write of request.options.body.writes) {
      assert.ok(write.update.name.startsWith(`${fullPrefix()}/`));
      assert.deepEqual(write.updateMask.fieldPaths, ['kind', 'siteKey', 'installationId']);
      assert.equal('seconds' in write.update.fields, false);
      assert.equal(write.updateTransforms[0].fieldPath, 'seconds');
      assert.equal(typeof write.updateTransforms[0].maximum.integerValue, 'string');
    }
  }
});

test('reads combine installations while retaining raw legacy and independent site and total floors', async () => {
  const store = createStore();
  const counter = (kind, siteKey, install, seconds) => {
    store.documents.set(`${prefix()}/${counterId(kind, siteKey, install)}`, { kind, siteKey, installationId: install, seconds });
  };
  counter('legacy', site, '', 100);
  counter('installation', site, 'a', 20);
  counter('installation', site, 'b', 30);
  counter('site', site, '', 160);
  counter('site', 'youtube.com', '', 10);
  counter('total', '', '', 180);
  const saved = await store.read();
  assert.deepEqual(saved.legacySiteTotals, { [site]: 100 });
  assert.deepEqual(saved.siteTotals, { [site]: 160, 'youtube.com': 10 });
  assert.equal(saved.installationUsage.a.siteTotals[site], 20);
  assert.equal(saved.installationUsage.b.siteTotals[site], 30);
  assert.equal(saved.totalTimeSpent, 180);
  assert.equal(saved.trackedSiteCount, 2);
});

test('a failed authoritative read aborts before any writes', async () => {
  const store = createStore();
  store.failRead(new Error('Simulated failed authoritative read'));
  await assert.rejects(async () => {
    await store.read();
    await store.raise(entry(0));
  }, /failed authoritative read/);
  assert.equal(store.requests.length, 0);
  assert.equal(store.documents.size, 0);
});

test('stored malformed numbers, identities, and shapes fail closed', async () => {
  const valid = { kind: 'site', siteKey: site, installationId: '', seconds: 50 };
  const cases = [
    { ...valid, seconds: -1 }, { ...valid, seconds: '50' }, { ...valid, seconds: Infinity },
    { ...valid, seconds: 1.5 }, { ...valid, seconds: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, kind: 'unknown' }, { ...valid, installationId: 'unexpected' },
    { ...valid, siteKey: '__proto__' }, { ...valid, extra: true },
    { kind: 'total', siteKey: site, installationId: '', seconds: 50 },
    { kind: 'installation', siteKey: site, installationId: '', seconds: 50 },
  ];
  for (const data of cases) {
    const store = createStore();
    store.documents.set(`${prefix()}/${counterId('site', site)}`, data);
    await assert.rejects(store.read());
    assert.equal(store.requests.length, 0);
  }
  const store = createStore();
  store.documents.set(`${prefix()}/incorrect-document-id`, valid);
  await assert.rejects(store.read(), /identity does not match/);
});

test('unsafe aggregate sums fail instead of wrapping or treating usage as zero', async () => {
  const store = createStore();
  for (const install of ['a', 'b']) {
    store.documents.set(`${prefix()}/${counterId('installation', site, install)}`, {
      kind: 'installation', siteKey: site, installationId: install, seconds: Number.MAX_SAFE_INTEGER,
    });
  }
  await assert.rejects(store.read(), /safe integer/);
  await assert.rejects(store.raise(entry(1, { siteTotals: { a: Number.MAX_SAFE_INTEGER, b: 1 } })), /safe integer/);
  assert.equal(store.requests.length, 0);
});

test('large uploads split into bounded commits and safely retry after partial success', async () => {
  const store = createStore();
  const siteTotals = Object.fromEntries(Array.from({ length: 450 }, (_, index) => [`site-${index}.example`, 1]));
  const value = entry(450, { siteTotals, installationUsage: { [installationId]: { siteTotals } }, totalTimeSpent: 450 });
  store.failBatch(2);
  await assert.rejects(store.raise(value), /503/);
  assert.equal(store.requests.length, 2);
  assert.equal(store.documents.size, 400);
  store.failBatch(undefined);
  const result = await store.raise(value);
  assert.deepEqual(result, { writtenCounters: 901, writtenBatches: 3 });
  assert.ok(store.requests.every((request) => request.options.body.writes.length <= 400));
  const saved = await store.read();
  assert.equal(saved.totalTimeSpent, 450);
  assert.equal(saved.trackedSiteCount, 450);
  assert.ok(Object.values(saved.siteTotals).every((seconds) => seconds === 1));
});

test('new days create separate counters and cannot clear the previous day', async () => {
  const store = createStore();
  await store.raise(entry(50));
  await store.raise(entry(0), '2026-11-26');
  assert.equal((await store.read()).totalTimeSpent, 50);
  assert.equal((await store.read('2026-11-26')).totalTimeSpent, 0);
  assert.ok([...store.documents.keys()].some((name) => name.startsWith(`${prefix()}/`)));
});

test('outbound invalid values fail before contacting Firestore', async () => {
  const store = createStore();
  for (const invalid of [-1, NaN, Infinity, '50', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.raise(entry(invalid)));
  }
  for (const value of [
    entry(5, { legacySiteTotals: [] }),
    entry(5, { installationUsage: { invalid: { siteTotals: [] } } }),
    entry(5, { siteTotals: { '__bad__/site': 5 } }),
    entry(5, { totalTimeSpent: '50' }),
  ]) await assert.rejects(store.raise(value));
  assert.equal(store.requests.length, 0);
});

test('Firestore authentication failures propagate without retrying or changing counters', async () => {
  const requests = [];
  await assert.rejects(raiseUsageCounters({
    projectId, idToken, uid, dayKey, entry: entry(50),
    fetchImpl: async (_url, options) => { requests.push(options); return { ok: false, status: 403 }; },
  }), /403/);
  assert.equal(requests.length, 1);
});
