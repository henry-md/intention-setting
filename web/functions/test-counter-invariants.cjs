'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { syncUsageForUser, validateUsagePayload } = require('./usage');
const { readUsageCounters, raiseUsageCounters } = require('./usageCounters');

const projectId = 'counter-invariant-tests';
const uid = 'counter-invariant-user';
const idToken = 'counter-invariant-token';
const now = Date.parse('2026-11-26T18:00:00Z');
const day = '2026-11-25';
const nextDay = '2026-11-26';
const clone = (value) => structuredClone(value);

function payload(installationId, siteTotals, dayKey = day) {
  return validateUsagePayload({
    installationId,
    siteTotals,
    baselineSiteTotals: {},
    dayKey,
    periodStart: Date.parse(`${dayKey}T04:00:00Z`),
  }, now);
}

function entryFor(installationId, siteTotals, dayKey = day) {
  return {
    usageFormatVersion: 2,
    legacySiteTotals: {},
    installationUsage: { [installationId]: { siteTotals: clone(siteTotals), updatedAt: now } },
    siteTotals: clone(siteTotals),
    totalTimeSpent: Object.values(siteTotals).reduce((sum, value) => sum + value, 0),
    periodStart: Date.parse(`${dayKey}T04:00:00Z`),
    periodEnd: now,
    capturedAt: now,
  };
}

// This model implements storage primitives only: staged serializable mirror
// transactions and atomic numeric maximum commits. It does not call the merge
// code to decide what Firestore contains or what the expected totals should be.
function createHarness() {
  const counters = new Map();
  const previousCounters = new Map();
  const mirrors = new Map();
  const operations = new Map();
  const acknowledgements = [];
  const mirrorWrites = [];
  let transactionQueue = Promise.resolve();
  let fault;
  let hook;

  const assertMonotonic = () => {
    for (const [name, previous] of previousCounters) {
      assert.ok(counters.has(name), `A saved counter disappeared: ${name}`);
      assert.ok(counters.get(name).seconds >= previous, `A saved counter decreased: ${name}`);
    }
    for (const [name, value] of counters) previousCounters.set(name, value.seconds);
  };
  const step = async (point) => {
    const occurrence = (operations.get(point) || 0) + 1;
    operations.set(point, occurrence);
    if (hook) await hook(point, occurrence);
    if (fault?.point === point && fault.occurrence === occurrence) {
      fault = undefined;
      throw new Error(`Injected ${point} failure`);
    }
  };
  const counterCollection = (name) => ({
    collection: (child) => counterCollection(`${name}/${child}`),
    doc: (child) => counterCollection(`${name}/${child}`),
    get: async () => {
      await step('counter-read');
      return { docs: [...counters.entries()]
        .filter(([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes('/'))
        .map(([path, value]) => ({ id: path.split('/').at(-1), data: () => clone(value) })) };
    },
  });
  const db = {
    collection: (collection) => {
      if (collection === 'usageCounters') return counterCollection(collection);
      assert.equal(collection, 'users');
      return { doc: (requestedUid) => {
        assert.equal(requestedUid, uid);
        return { uid: requestedUid };
      } };
    },
    runTransaction: (callback) => {
      const result = transactionQueue.then(async () => {
        const staged = [];
        const result = await callback({
          get: async () => {
            await step('mirror-read');
            return { data: () => clone(mirrors.get(uid)) };
          },
          set: (_ref, values, options) => {
            assert.equal(options.merge, true);
            staged.push(clone(values));
          },
        });
        await step('mirror-before-commit');
        for (const values of staged) {
          const previous = mirrors.get(uid) || {};
          mirrors.set(uid, {
            ...previous,
            ...values,
            dailyUsageHistory: { ...previous.dailyUsageHistory, ...values.dailyUsageHistory },
          });
          mirrorWrites.push(values);
        }
        await step('mirror-after-commit');
        return result;
      });
      transactionQueue = result.catch(() => {});
      return result;
    },
  };
  const fetchImpl = async (url, options) => {
    assert.equal(url, `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`);
    assert.equal(options.headers.Authorization, `Bearer ${idToken}`);
    await step('counter-before-commit');
    const writes = JSON.parse(options.body).writes;
    const staged = [];
    for (const write of writes) {
      const name = write.update.name.split('/documents/')[1];
      const previous = counters.get(name);
      assert.equal('seconds' in write.update.fields, false, 'An ordinary assignment can bypass the native maximum invariant');
      const metadata = Object.fromEntries(Object.entries(write.update.fields).map(([key, value]) => [key, value.stringValue]));
      if (previous) {
        for (const [key, value] of Object.entries(metadata)) assert.equal(value, previous[key]);
      }
      assert.equal(write.updateTransforms.length, 1);
      const transform = write.updateTransforms[0];
      assert.deepEqual(Object.keys(transform), ['fieldPath', 'maximum'], 'Counter writes must use native maximum');
      assert.equal(transform.fieldPath, 'seconds');
      const incoming = Number(transform.maximum.integerValue);
      assert.ok(Number.isSafeInteger(incoming) && incoming >= 0);
      staged.push([name, { ...metadata, seconds: Math.max(previous?.seconds || 0, incoming) }]);
    }
    for (const [name, value] of staged) counters.set(name, value);
    assertMonotonic();
    await step('counter-after-commit');
    return { ok: true, status: 200 };
  };
  const storeFor = (dayKey) => ({
    read: () => readUsageCounters(db, uid, dayKey),
    raise: (entry) => raiseUsageCounters({ projectId, idToken, uid, dayKey, entry, fetchImpl }),
  });

  return {
    counters, mirrors, operations, acknowledgements, mirrorWrites, assertMonotonic,
    resetOperations: () => operations.clear(),
    arm: (point, occurrence = 1) => { fault = { point, occurrence }; operations.clear(); },
    onStep: (callback) => { hook = callback; },
    read: (dayKey = day) => storeFor(dayKey).read(),
    storeFor,
    sync: async (request) => {
      const result = await syncUsageForUser(db, uid, request, now, storeFor(request.dayKey));
      acknowledgements.push(clone(result));
      assertMonotonic();
      return result;
    },
    seed: async (entry, dayKey = day) => {
      await storeFor(dayKey).raise(entry);
      const user = mirrors.get(uid) || {};
      mirrors.set(uid, { ...user, dailyUsageHistory: { ...user.dailyUsageHistory, [dayKey]: clone(entry) } });
      operations.clear();
    },
  };
}

function randomFor(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % limit;
  };
}

function expectedTotals(contributions, legacy = {}) {
  const totals = { ...legacy };
  for (const sites of Object.values(contributions)) {
    for (const [site, seconds] of Object.entries(sites)) totals[site] = (totals[site] || 0) + seconds;
  }
  return totals;
}

test('seeded duplicate and reordered deliveries preserve exact totals across installations, sites, and days', async () => {
  for (const seed of [0xC0FFEE, 0x5EED1234, 0xDEADBEEF]) {
    const random = randomFor(seed);
    const harness = createHarness();
    const produced = {};
    const accepted = {};
    const deliveries = [];
    const sites = ['chess.com', 'youtube.com', 'reddit.com'];
    const legacy = seed === 0xC0FFEE ? { 'chess.com': 100, 'youtube.com': 20 } : {};
    if (Object.keys(legacy).length) {
      for (const dayKey of [day, nextDay]) {
        await harness.seed({
          ...entryFor('installation-a', {}, dayKey), installationUsage: {},
          legacySiteTotals: legacy, siteTotals: legacy, totalTimeSpent: 120,
        }, dayKey);
      }
    }
    for (let event = 0; event < 144; event += 1) {
      const dayKey = random(2) ? day : nextDay;
      const installationId = `installation-${random(4)}`;
      const site = sites[random(sites.length)];
      produced[dayKey] ||= {};
      produced[dayKey][installationId] ||= {};
      const seconds = (produced[dayKey][installationId][site] || 0) + 1 + random(7);
      produced[dayKey][installationId][site] = seconds;
      const request = payload(installationId, { [site]: seconds }, dayKey);
      deliveries.push(request);
      if (event % 3 === 0) deliveries.push(clone(request));
    }
    for (let index = deliveries.length - 1; index > 0; index -= 1) {
      const other = random(index + 1);
      [deliveries[index], deliveries[other]] = [deliveries[other], deliveries[index]];
    }
    for (const [index, request] of deliveries.entries()) {
      accepted[request.dayKey] ||= {};
      const own = accepted[request.dayKey][request.installationId] ||= {};
      for (const [site, seconds] of Object.entries(request.siteTotals)) own[site] = Math.max(own[site] || 0, seconds);
      const expected = expectedTotals(accepted[request.dayKey], legacy);
      const result = await harness.sync(request);
      const message = `seed=${seed.toString(16)}, delivery=${index}`;
      assert.deepEqual(result.entry.siteTotals, expected, message);
      assert.equal(result.entry.totalTimeSpent, Object.values(expected).reduce((sum, seconds) => sum + seconds, 0), message);
      const persisted = await harness.read(request.dayKey);
      assert.deepEqual(persisted.siteTotals, expected, message);
      for (const [otherDay, contributions] of Object.entries(accepted)) {
        assert.deepEqual((await harness.read(otherDay)).siteTotals, expectedTotals(contributions, legacy), message);
      }
    }
  }
});

test('interrupted syncs retry exactly once at every read and persistence boundary', async () => {
  const boundaries = [
    ['counter-read', 1],
    ['mirror-read', 1],
    ['mirror-before-commit', 1],
    ['mirror-after-commit', 1],
    ['counter-before-commit', 1],
    ['counter-after-commit', 1],
    ['counter-read', 2],
    ['mirror-read', 2],
    ['mirror-before-commit', 2],
    ['mirror-after-commit', 2],
  ];
  for (const [point, occurrence] of boundaries) {
    const harness = createHarness();
    await harness.seed(entryFor('installation-a', { 'chess.com': 50, 'youtube.com': 7 }));
    const previousDay = new Map(harness.counters);
    await harness.seed(entryFor('installation-a', { 'chess.com': 3 }, nextDay), nextDay);
    harness.arm(point, occurrence);
    const request = payload('installation-a', { 'chess.com': 55, 'youtube.com': 8 });
    await assert.rejects(harness.sync(request), /Injected/, `${point} #${occurrence}`);
    assert.equal(harness.acknowledgements.length, 0, 'An interrupted sync must not acknowledge saved time');
    harness.assertMonotonic();
    const retried = await harness.sync(clone(request));
    assert.deepEqual(retried.entry.siteTotals, { 'chess.com': 55, 'youtube.com': 8 });
    assert.equal(retried.entry.totalTimeSpent, 63);
    assert.equal((await harness.read()).totalTimeSpent, 63);
    assert.equal((await harness.read(nextDay)).totalTimeSpent, 3, 'Retrying yesterday cannot alter today');
    for (const [name, previous] of previousDay) assert.ok(harness.counters.get(name).seconds >= previous.seconds);
    // A new request has no prior in-memory sync state. Losing a successful
    // response and retrying the persisted absolute values must still count once.
    const lostAcknowledgement = await harness.sync(clone(request));
    assert.equal(lostAcknowledgement.entry.totalTimeSpent, 63);
    assert.equal((await harness.sync(clone(request))).entry.totalTimeSpent, 63);
  }
});

test('concurrent stale uploads merge contributions without dropping or duplicating another installation', async () => {
  const harness = createHarness();
  const requests = [
    payload('installation-a', { 'chess.com': 20, 'youtube.com': 8 }),
    payload('installation-b', { 'chess.com': 15, 'reddit.com': 3 }),
    payload('installation-a', { 'chess.com': 5 }),
    payload('installation-c', { 'chess.com': 7, 'youtube.com': 2 }),
    payload('installation-b', { 'chess.com': 15, 'reddit.com': 3 }),
  ];
  const results = await Promise.all(requests.map((request) => harness.sync(request)));
  for (const [index, result] of results.entries()) {
    for (const [site, seconds] of Object.entries(requests[index].siteTotals)) {
      assert.ok(result.contributionTotals[site] >= seconds, 'A successful acknowledgement includes its submitted absolute contribution');
    }
  }
  const final = await harness.read();
  assert.deepEqual(final.siteTotals, { 'chess.com': 42, 'youtube.com': 10, 'reddit.com': 3 });
  assert.equal(final.totalTimeSpent, 55);
  assert.equal(harness.mirrors.get(uid).dailyUsageHistory[day].totalTimeSpent, 55);
  harness.assertMonotonic();
});

test('an intervening legacy upload survives interruption of the final counter write', async () => {
  for (const failure of ['counter-before-commit', 'counter-after-commit']) {
    const harness = createHarness();
    await harness.seed(entryFor('installation-a', { 'chess.com': 50, 'youtube.com': 7 }));
    let legacyUploadApplied = false;
    harness.onStep(async (point, occurrence) => {
      if (point !== 'mirror-read' || occurrence !== 2 || legacyUploadApplied) return;
      legacyUploadApplied = true;
      // During initial migration an older installation may write after the
      // first native commit, before the final mirror transaction protects it.
      const user = clone(harness.mirrors.get(uid));
      const mirror = user.dailyUsageHistory[day];
      mirror.installationUsage['installation-b'] = { siteTotals: { 'chess.com': 7 }, updatedAt: now };
      mirror.siteTotals['chess.com'] += 7;
      mirror.totalTimeSpent += 7;
      harness.mirrors.set(uid, user);
    });
    harness.arm(failure, 2);
    const request = payload('installation-a', { 'chess.com': 55, 'youtube.com': 8 });
    await assert.rejects(harness.sync(request), /Injected/);
    assert.equal(harness.acknowledgements.length, 0, 'The final increase must be guarded before success');
    harness.assertMonotonic();
    const result = await harness.sync(clone(request));
    assert.deepEqual(result.entry.siteTotals, { 'chess.com': 62, 'youtube.com': 8 });
    assert.equal(result.entry.totalTimeSpent, 70);
    assert.equal((await harness.read()).totalTimeSpent, 70);
    assert.equal(result.entry.installationUsage['installation-b'].siteTotals['chess.com'], 7);
  }
});

test('a stale or deleted statistics mirror recovers every acknowledged site before accepting another upload', async () => {
  const harness = createHarness();
  await harness.sync(payload('installation-a', { 'chess.com': 50, 'youtube.com': 8 }));
  await harness.sync(payload('installation-b', { 'chess.com': 15, 'reddit.com': 3 }));
  const saved = clone(harness.mirrors.get(uid));
  for (const damaged of [
    undefined,
    { dailyUsageHistory: {} },
    { dailyUsageHistory: { [day]: entryFor('installation-a', { 'chess.com': 1 }) } },
  ]) {
    harness.mirrors.set(uid, clone(damaged));
    const result = await harness.sync(payload('installation-a', { 'chess.com': 0 }));
    assert.deepEqual(result.entry.siteTotals, { 'chess.com': 65, 'youtube.com': 8, 'reddit.com': 3 });
    assert.equal(result.entry.totalTimeSpent, 76);
    assert.deepEqual((await harness.read()).siteTotals, result.entry.siteTotals);
    assert.equal(harness.mirrors.get(uid).usageCountersVersion, 1);
    assert.equal(harness.mirrors.get(uid).dailyUsageHistory[day].totalTimeSpent, saved.dailyUsageHistory[day].totalTimeSpent);
    harness.assertMonotonic();
  }
});
