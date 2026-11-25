const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { validateUsagePayload, mergeStoredUsageEntries, mergeUsageEntry, syncUsageForUser } = require('./usage');

const now = Date.parse('2026-11-25T18:00:00Z');
const dayKey = '2026-11-25';
const site = 'example.com';
const payload = (seconds, extra = {}) => ({
  installationId: 'installation-a',
  dayKey,
  periodStart: Date.parse('2026-11-25T00:00:00Z'),
  siteTotals: { [site]: seconds },
  baselineSiteTotals: {},
  ...extra,
});

const savedEntry = (contribution, extra = {}) => ({
  usageFormatVersion: 2,
  legacySiteTotals: { [site]: 100 },
  installationUsage: { 'installation-a': { siteTotals: { [site]: contribution }, updatedAt: now } },
  siteTotals: { [site]: 100 + contribution },
  totalTimeSpent: 100 + contribution,
  periodStart: now - 10_000,
  periodEnd: now,
  capturedAt: now,
  ...extra,
});

test('a stale mirror cannot reclassify a saved contribution as new legacy time', () => {
  const authority = savedEntry(50);
  const mirror = savedEntry(10, { siteTotals: { [site]: 150 }, totalTimeSpent: 150 });
  const merged = mergeStoredUsageEntries(authority, mirror);
  assert.equal(merged.siteTotals[site], 150);
  assert.equal(merged.totalTimeSpent, 150);
  assert.equal(merged.legacySiteTotals[site], 100);
  assert.equal(merged.installationUsage['installation-a'].siteTotals[site], 50);
  assert.deepEqual(mergeStoredUsageEntries(mirror, authority), merged);
});

test('a higher mirror contribution is retained without counting it twice', () => {
  const merged = mergeStoredUsageEntries(savedEntry(50), savedEntry(55));
  assert.equal(merged.siteTotals[site], 155);
  assert.equal(merged.legacySiteTotals[site], 100);
  assert.equal(merged.installationUsage['installation-a'].siteTotals[site], 55);
  assert.deepEqual(mergeStoredUsageEntries(merged, merged), merged);
});

test('missing or deleted mirror data recovers all saved authority counters', () => {
  const authority = savedEntry(50);
  for (const missing of [undefined, null, {}]) {
    const merged = mergeStoredUsageEntries(authority, missing);
    assert.equal(merged.siteTotals[site], 150);
    assert.equal(merged.totalTimeSpent, 150);
    assert.equal(merged.installationUsage['installation-a'].siteTotals[site], 50);
  }
  assert.equal(mergeStoredUsageEntries(undefined, undefined), undefined);
});

test('independent installations remain additive when their snapshots are combined', () => {
  const mirror = savedEntry(10, {
    installationUsage: {
      'installation-a': { siteTotals: { [site]: 10 }, updatedAt: now - 1 },
      'installation-b': { siteTotals: { [site]: 7 }, updatedAt: now + 1 },
    },
    siteTotals: { [site]: 117 },
    totalTimeSpent: 117,
  });
  const merged = mergeStoredUsageEntries(savedEntry(50), mirror);
  assert.equal(merged.siteTotals[site], 157);
  assert.equal(merged.totalTimeSpent, 157);
  assert.equal(merged.legacySiteTotals[site], 100);
  assert.equal(merged.installationUsage['installation-b'].siteTotals[site], 7);
});

test('omitted sites and incomplete aggregate breakdowns retain their floors', () => {
  const authority = savedEntry(50, {
    siteTotals: { [site]: 150, 'other.example': 20 },
    totalTimeSpent: 200,
  });
  const merged = mergeStoredUsageEntries(authority, savedEntry(10));
  assert.equal(merged.siteTotals['other.example'], 20);
  assert.equal(merged.legacySiteTotals['other.example'], 20);
  assert.equal(merged.totalTimeSpent, 200);
  assert.equal(merged.trackedSiteCount, 2);
});

test('an aggregate-only legacy mirror remains a floor after contributions are combined', () => {
  const merged = mergeStoredUsageEntries(savedEntry(50), { siteTotals: { [site]: 160 }, totalTimeSpent: 160 });
  assert.equal(merged.siteTotals[site], 160);
  assert.equal(merged.legacySiteTotals[site], 110);
  assert.equal(merged.installationUsage['installation-a'].siteTotals[site], 50);
});

function createDb(initial = {}) {
  const data = structuredClone(initial);
  const accessedUsers = [];
  const writes = [];
  const db = {
    collection: (collection) => {
      assert.equal(collection, 'users');
      return { doc: (uid) => {
        accessedUsers.push(uid);
        return { uid, get: async () => ({ data: () => structuredClone(data) }) };
      } };
    },
    runTransaction: async (callback) => callback({
      get: async () => ({ data: () => structuredClone(data) }),
      set: (_ref, value, options) => {
        assert.equal(options.merge, true);
        writes.push(structuredClone(value));
        Object.assign(data, structuredClone(value), {
          dailyUsageHistory: { ...data.dailyUsageHistory, ...structuredClone(value.dailyUsageHistory) },
        });
      },
    }),
  };
  return { db, data, accessedUsers, writes, counters: createCounterStore() };
}

function createCounterStore(initial, { onRead, onRaise } = {}) {
  let stored = structuredClone(initial);
  const reads = [];
  const raises = [];
  const store = {
    read: async () => {
      reads.push(reads.length + 1);
      if (onRead) await onRead(reads.length, store);
      return structuredClone(stored);
    },
    raise: async (entry) => {
      raises.push(structuredClone(entry));
      if (onRaise) await onRaise(entry, store);
      stored = mergeStoredUsageEntries(stored, entry);
    },
    reads,
    raises,
    entry: () => structuredClone(stored),
    replace: (entry) => { stored = structuredClone(entry); },
  };
  return store;
}

test('the first batch and identical retries count once', () => {
  const first = mergeUsageEntry(undefined, payload(5), now);
  assert.equal(first.entry.totalTimeSpent, 5);
  assert.deepEqual(mergeUsageEntry(first.entry, payload(5), now).entry, first.entry);
});

test('stale requests cannot lower a saved contribution or aggregate', () => {
  const initial = mergeUsageEntry(undefined, payload(50), now).entry;
  const stale = mergeUsageEntry(initial, payload(10), now + 1);
  assert.equal(stale.entry.siteTotals[site], 50);
  assert.equal(stale.contributionTotals[site], 50);
  assert.equal(stale.ignoredStaleContributionCount, 1);
});

test('migration preserves the shared legacy total without double-counting the first batch', () => {
  const result = mergeUsageEntry({ siteTotals: { [site]: 100 } }, payload(5, {
    baselineSiteTotals: { [site]: 105 },
  }), now);
  assert.equal(result.entry.siteTotals[site], 105);
  assert.equal(result.entry.legacySiteTotals[site], 100);
  assert.equal(result.contributionTotals[site], 5);
});

test('a stale local contribution recovers from its local aggregate floor', () => {
  const existing = {
    usageFormatVersion: 2,
    legacySiteTotals: { [site]: 100 },
    installationUsage: { 'installation-a': { siteTotals: { [site]: 50 }, updatedAt: now } },
    siteTotals: { [site]: 150 },
  };
  const result = mergeUsageEntry(existing, payload(10, { baselineSiteTotals: { [site]: 155 } }), now);
  assert.equal(result.entry.siteTotals[site], 155);
  assert.equal(result.contributionTotals[site], 55);
  assert.equal(result.entry.legacySiteTotals[site], 100);
});

test('missing sites and incomplete contribution breakdowns retain their saved floors', () => {
  const existing = {
    siteTotals: { [site]: 150, 'other.example': 20 },
    installationUsage: { 'installation-a': { siteTotals: { [site]: 10 }, updatedAt: now } },
  };
  const first = mergeUsageEntry(existing, payload(15), now);
  const retried = mergeUsageEntry(first.entry, payload(15), now);
  assert.equal(first.entry.siteTotals[site], 155);
  assert.equal(first.entry.siteTotals['other.example'], 20);
  assert.equal(retried.entry.totalTimeSpent, 175);
});

test('two installations remain additive across duplicate and out-of-order requests', () => {
  let entry;
  let previousTotal = 0;
  for (const [id, seconds] of [['a', 5], ['b', 8], ['a', 10], ['b', 3], ['a', 5], ['b', 8], ['b', 12]]) {
    entry = mergeUsageEntry(entry, payload(seconds, { installationId: id }), now).entry;
    assert.ok(entry.totalTimeSpent >= previousTotal);
    previousTotal = entry.totalTimeSpent;
  }
  assert.equal(entry.siteTotals[site], 22);
});

test('a shared display floor does not duplicate another installation contribution', () => {
  const first = mergeUsageEntry(undefined, payload(10), now).entry;
  const second = mergeUsageEntry(first, payload(5, {
    installationId: 'installation-b', baselineSiteTotals: { [site]: 15 },
  }), now).entry;
  assert.equal(second.siteTotals[site], 15);
  const retried = mergeUsageEntry(second, payload(5, {
    installationId: 'installation-b', baselineSiteTotals: { [site]: 15 },
  }), now);
  assert.equal(retried.entry.siteTotals[site], 15);
});

test('old aggregate-only totals cannot decrease even if their site breakdown is incomplete', () => {
  const result = mergeUsageEntry({ totalTimeSpent: 100, siteTotals: { [site]: 10 } }, payload(5), now);
  assert.equal(result.entry.totalTimeSpent, 100);
});

test('the transaction changes only the authenticated user and requested day', async () => {
  const harness = createDb({ dailyUsageHistory: { '2026-11-24': { totalTimeSpent: 20 } } });
  await syncUsageForUser(harness.db, 'authenticated-user', payload(5), now, harness.counters);
  assert.deepEqual(harness.accessedUsers, ['authenticated-user']);
  assert.equal(harness.data.dailyUsageHistory['2026-11-24'].totalTimeSpent, 20);
  assert.equal(harness.data.dailyUsageHistory[dayKey].totalTimeSpent, 5);
});

test('a failed authority read performs no mirror write', async () => {
  const harness = createDb({ dailyUsageHistory: { [dayKey]: savedEntry(50) } });
  const counters = createCounterStore(undefined, { onRead: async () => { throw new Error('Authority unavailable'); } });
  await assert.rejects(syncUsageForUser(harness.db, 'authenticated-user', payload(5), now, counters), /Authority unavailable/);
  assert.equal(harness.writes.length, 0);
  assert.equal(counters.raises.length, 0);
  assert.equal(harness.data.dailyUsageHistory[dayKey].totalTimeSpent, 150);
});

test('a failed mirror transaction read performs no counter or mirror write', async () => {
  const harness = createDb();
  const counters = createCounterStore(savedEntry(50));
  harness.db.runTransaction = async (callback) => callback({
    get: async () => { throw new Error('Mirror read unavailable'); },
    set: () => { assert.fail('A failed read must not reach a write'); },
  });
  await assert.rejects(syncUsageForUser(harness.db, 'authenticated-user', payload(5), now, counters), /Mirror read unavailable/);
  assert.equal(harness.writes.length, 0);
  assert.equal(counters.raises.length, 0);
  assert.equal(counters.entry().siteTotals[site], 150);
});

test('sync fails closed if guarded counter storage is missing', async () => {
  const harness = createDb();
  for (const counters of [undefined, {}, { read: async () => undefined }]) {
    await assert.rejects(syncUsageForUser(harness.db, 'authenticated-user', payload(5), now, counters), /storage is required/);
  }
  assert.equal(harness.writes.length, 0);
});

test('guarded counters repair a stale, empty, or deleted mirror', async () => {
  for (const mirror of [savedEntry(10), {}, undefined]) {
    const harness = createDb({ dailyUsageHistory: { [dayKey]: mirror } });
    const counters = createCounterStore(savedEntry(50));
    const result = await syncUsageForUser(harness.db, 'authenticated-user', payload(10), now, counters);
    assert.equal(result.entry.totalTimeSpent, 150);
    assert.equal(result.contributionTotals[site], 50);
    assert.equal(harness.data.dailyUsageHistory[dayKey].siteTotals[site], 150);
    assert.equal(counters.entry().siteTotals[site], 150);
  }
});

test('a higher authority write in flight survives the response and mirror repair', async () => {
  const harness = createDb({ dailyUsageHistory: { [dayKey]: savedEntry(10) } });
  const counters = createCounterStore(savedEntry(50), {
    onRaise: async (_entry, store) => { store.replace(savedEntry(75)); },
  });
  const result = await syncUsageForUser(harness.db, 'authenticated-user', payload(55), now, counters);
  assert.equal(result.entry.siteTotals[site], 175);
  assert.equal(result.contributionTotals[site], 75);
  assert.equal(harness.data.dailyUsageHistory[dayKey].siteTotals[site], 175);
});

test('mirror protection activates only after a successful counter commit and readback', async () => {
  const harness = createDb();
  const counters = createCounterStore(undefined, {
    onRaise: async () => {
      assert.equal(harness.data.usageCountersVersion, undefined);
      assert.equal(harness.writes.length, 1);
    },
    onRead: async (readNumber) => {
      if (readNumber === 2) assert.equal(harness.data.usageCountersVersion, undefined);
    },
  });
  await syncUsageForUser(harness.db, 'authenticated-user', payload(5), now, counters);
  assert.equal(harness.data.usageCountersVersion, 1);
  assert.equal(harness.writes[0].usageCountersVersion, undefined);
  assert.equal(harness.writes[1].usageCountersVersion, 1);
});

test('an unsuccessful guarded write does not activate mirror protection', async () => {
  const harness = createDb();
  const counters = createCounterStore(undefined, { onRaise: async () => { throw new Error('Counter write denied'); } });
  await assert.rejects(syncUsageForUser(harness.db, 'authenticated-user', payload(5), now, counters), /Counter write denied/);
  assert.equal(harness.data.usageCountersVersion, undefined);
  assert.equal(counters.entry(), undefined);
});

test('validation rejects malformed dates, identifiers, counters, and oversized maps', () => {
  for (const invalid of [
    null,
    [],
    payload(5, { dayKey: '2026-02-30' }),
    payload(5, { dayKey: '2027-11-25' }),
    payload(5, { installationId: '../other' }),
    payload(5, { installationId: '__proto__' }),
    payload(5, { periodStart: 0 }),
    ...[-1, 1.5, NaN, Infinity, '5', Number.MAX_SAFE_INTEGER].map(value => payload(value)),
    payload(5, { siteTotals: [] }),
    payload(5, { siteTotals: JSON.parse('{"__proto__":5}') }),
    payload(5, { siteTotals: { toString: 5 } }),
    payload(5, { baselineSiteTotals: { [site]: -1 } }),
    payload(5, { siteTotals: Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`site${index}.example`, 1])) }),
  ]) {
    assert.throws(() => validateUsagePayload(invalid, now), { statusCode: 400 });
  }
  assert.equal(validateUsagePayload(payload(5), now).siteTotals[site], 5);
});

function loadHttpHandler(harness, handlerName = 'syncUsage') {
  const exports = {};
  harness.counterRequests ||= [];
  const admin = {
    apps: [{}],
    app: () => ({ options: { projectId: 'test-project' } }),
    auth: () => ({ verifyIdToken: async (token) => {
      if (token !== 'valid-token') throw new Error('Invalid token');
      return { uid: 'authenticated-user' };
    } }),
    firestore: () => harness.db,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'), {
    exports,
    require: (name) => {
      if (name === 'firebase-functions/v2/https') return { onRequest: (_options, handler) => handler };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({}), defineString: () => ({}) };
      if (name === 'firebase-admin') return admin;
      if (name === 'stripe') return function Stripe() {};
      if (name === './usage') return require('./usage');
      if (name === './usageCounters') return {
        readUsageCounters: async (db, uid, requestedDay) => {
          assert.equal(db, harness.db);
          assert.equal(uid, 'authenticated-user');
          assert.equal(requestedDay, dayKey);
          return harness.counters.read();
        },
        raiseUsageCounters: async (request) => {
          harness.counterRequests.push(request);
          return harness.counters.raise(request.entry);
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { warn() {}, error() {} },
    process: { env: { GCLOUD_PROJECT: 'test-project' } },
  });
  return exports[handlerName];
}

async function requestHandler(handler, { token, method = 'POST', body = payload(5) } = {}) {
  const result = {};
  const response = {
    status: (status) => { result.status = status; return response; },
    json: (body) => { result.body = body; },
    send: () => {},
  };
  await handler({ method, body, get: () => token ? `Bearer ${token}` : '' }, response);
  return result;
}

test('the HTTP endpoint requires authentication and ignores a body-supplied uid', async () => {
  const harness = createDb();
  const handler = loadHttpHandler(harness);
  const request = (options) => requestHandler(handler, options);
  assert.equal((await request()).status, 401);
  assert.equal((await request({ token: 'invalid-token' })).status, 401);
  assert.equal((await request({ method: 'GET' })).status, 405);
  assert.equal((await request({ token: 'valid-token', body: payload(-1) })).status, 400);
  const result = await request({ token: 'valid-token', body: payload(5, { uid: 'someone-else' }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.siteTotals[site], 5);
  assert.deepEqual(harness.accessedUsers, ['authenticated-user']);
  assert.equal(harness.counterRequests.length, 1);
  assert.equal(harness.counterRequests[0].idToken, 'valid-token');
  assert.equal(harness.counterRequests[0].uid, 'authenticated-user');
  assert.equal(harness.counterRequests[0].projectId, 'test-project');
  assert.equal(harness.counterRequests[0].dayKey, dayKey);
});

test('the HTTP endpoint cannot acknowledge a failed guarded write or readback', async () => {
  for (const failure of ['write', 'readback']) {
    const harness = createDb();
    harness.counters = createCounterStore(undefined, {
      onRaise: async () => { if (failure === 'write') throw new Error('Counter write failed'); },
      onRead: async (readNumber) => {
        if (failure === 'readback' && readNumber === 2) throw new Error('Counter confirmation failed');
      },
    });
    const result = await requestHandler(loadHttpHandler(harness), { token: 'valid-token' });
    assert.equal(result.status, 500);
    assert.equal(result.body.entry, undefined);
    assert.equal(harness.data.usageCountersVersion, undefined);
  }
});

test('the HTTP endpoint cannot acknowledge an empty durability confirmation', async () => {
  const harness = createDb();
  harness.counters = {
    read: async () => undefined,
    raise: async () => {},
  };
  const result = await requestHandler(loadHttpHandler(harness), { token: 'valid-token' });
  assert.equal(result.status, 500);
  assert.equal(typeof result.body.error.message, 'string');
  assert.equal(harness.data.usageCountersVersion, undefined);
});

test('getUsage recovers guarded values when the legacy mirror is missing', async () => {
  const harness = createDb();
  harness.counters = createCounterStore(savedEntry(50));
  const handler = loadHttpHandler(harness, 'getUsage');
  assert.equal((await requestHandler(handler, { body: { dayKey } })).status, 401);
  const result = await requestHandler(handler, {
    token: 'valid-token', body: { dayKey, uid: 'someone-else' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.siteTotals[site], 150);
  assert.equal(result.body.entry.installationUsage['installation-a'].siteTotals[site], 50);
  assert.deepEqual(harness.accessedUsers, ['authenticated-user']);
  assert.equal(harness.writes.length, 0);
});

test('getUsage returns an error instead of an empty day when the authority read fails', async () => {
  const harness = createDb();
  harness.counters = createCounterStore(undefined, { onRead: async () => { throw new Error('Counter read unavailable'); } });
  const result = await requestHandler(loadHttpHandler(harness, 'getUsage'), {
    token: 'valid-token', body: { dayKey },
  });
  assert.equal(result.status, 500);
  assert.equal(result.body.entry, undefined);
  assert.equal(harness.writes.length, 0);
});

test('getUsage protects existing legacy time on its first read without adding seconds', async () => {
  const harness = createDb({ dailyUsageHistory: {
    [dayKey]: { siteTotals: { [site]: 100 }, totalTimeSpent: 100 },
  } });
  const result = await requestHandler(loadHttpHandler(harness, 'getUsage'), {
    token: 'valid-token', body: { dayKey },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.siteTotals[site], 100);
  assert.equal(result.body.entry.totalTimeSpent, 100);
  assert.equal(harness.counters.entry().siteTotals[site], 100);
  assert.equal(harness.counters.entry().totalTimeSpent, 100);
  assert.equal(harness.counters.entry().legacySiteTotals[site], 100);
  assert.deepEqual(harness.counters.entry().installationUsage['guard-bootstrap'].siteTotals, {});
  assert.equal(harness.data.usageCountersVersion, 1);
  assert.equal(harness.counterRequests[0].idToken, 'valid-token');
});

test('getUsage does not report a successful bootstrap if the guarded write fails', async () => {
  const harness = createDb({ dailyUsageHistory: {
    [dayKey]: { siteTotals: { [site]: 100 }, totalTimeSpent: 100 },
  } });
  harness.counters = createCounterStore(undefined, {
    onRaise: async () => { throw new Error('Guard bootstrap unavailable'); },
  });
  const result = await requestHandler(loadHttpHandler(harness, 'getUsage'), {
    token: 'valid-token', body: { dayKey },
  });
  assert.equal(result.status, 500);
  assert.equal(result.body.entry, undefined);
  assert.equal(harness.data.usageCountersVersion, undefined);
  assert.equal(harness.data.dailyUsageHistory[dayKey].siteTotals[site], 100);
  assert.equal(harness.counters.entry(), undefined);
});

test('getUsage leaves a genuinely empty day empty without writing counters or mirrors', async () => {
  const harness = createDb();
  const result = await requestHandler(loadHttpHandler(harness, 'getUsage'), {
    token: 'valid-token', body: { dayKey },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry, null);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.counters.raises.length, 0);
  assert.equal(harness.data.usageCountersVersion, undefined);
});
