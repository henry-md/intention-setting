'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Refuse to load an SDK or issue any request until both emulator addresses and
// the demo project have been checked. This script never accepts production URLs.
const projectId = process.env.GCLOUD_PROJECT;
assert.equal(projectId, 'demo-intention-counters', 'The counter suite requires its isolated demo project');
function emulatorOrigin(name) {
  const host = process.env[name];
  assert.match(host || '', /^127\.0\.0\.1:\d+$/, `${name} must identify a loopback emulator`);
  const port = Number(host.split(':')[1]);
  assert.ok(port > 0 && port < 65536, `${name} must contain a valid port`);
  return `http://${host}`;
}
const firestoreOrigin = emulatorOrigin('FIRESTORE_EMULATOR_HOST');
const authOrigin = emulatorOrigin('FIREBASE_AUTH_EMULATOR_HOST');
const webRoot = path.resolve(__dirname, '..');
const functionsRequire = createRequire(path.join(webRoot, 'functions/package.json'));
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore, FieldPath } = functionsRequire('firebase-admin/firestore');
const { counterId, raiseUsageCounters, readUsageCounters } = require('../functions/usageCounters');
const { syncUsageForUser, mergeStoredUsageEntries } = require('../functions/usage');

const app = initializeApp({ projectId }, `counter-emulator-${process.pid}`);
const db = getFirestore(app);
const databasePath = `/v1/projects/${projectId}/databases/(default)`;
let checks = 0;

async function request(origin, pathname, { token, method = 'GET', body } = {}) {
  assert.ok(origin === firestoreOrigin || origin === authOrigin, 'Every test request must stay inside the emulators');
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function createUser() {
  const result = await request(authOrigin, '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=counter-emulator-only', {
    method: 'POST', body: { returnSecureToken: true },
  });
  assert.equal(result.status, 200, 'The Auth emulator must create the test identity');
  assert.equal(typeof result.data.localId, 'string');
  assert.equal(typeof result.data.idToken, 'string');
  return { uid: result.data.localId, token: result.data.idToken };
}

function encodeValue(value) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value === null) return { nullValue: null };
  return { mapValue: { fields: encodeFields(value) } };
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
}

const counterPath = (uid, day, kind = 'installation', site = 'chess.com', installation = 'installation-a') =>
  `usageCounters/${uid}/days/${day}/values/${counterId(kind, kind === 'total' ? '' : site, kind === 'installation' ? installation : '')}`;

async function rawWrite(documentPath, value, token) {
  return request(firestoreOrigin, `${databasePath}/documents/${documentPath}`, {
    method: 'PATCH', token, body: { fields: encodeFields(value) },
  });
}

async function rawDelete(documentPath, token) {
  return request(firestoreOrigin, `${databasePath}/documents/${documentPath}`, { method: 'DELETE', token });
}

async function mergeFields(documentPath, fields, token) {
  return request(firestoreOrigin, `${databasePath}/documents:commit`, {
    method: 'POST', token,
    body: { writes: [{
      update: { name: `projects/${projectId}/databases/(default)/documents/${documentPath}`, fields: encodeFields(fields) },
      updateMask: { fieldPaths: Object.keys(fields) },
    }] },
  });
}

async function loadRules(content) {
  // This is the same local endpoint used by Firebase's rules-unit-testing SDK.
  // https://github.com/firebase/firebase-js-sdk/blob/main/packages/rules-unit-testing/src/impl/rules.ts
  const result = await request(firestoreOrigin, `/emulator/v1/projects/${projectId}:securityRules`, {
    method: 'PUT', body: { rules: { files: [{ content }] } },
  });
  assert.equal(result.status, 200, 'The emulator must compile the checked-in rules');
}

function entry(seconds, site = 'chess.com', installation = 'installation-a') {
  return {
    siteTotals: { [site]: seconds },
    legacySiteTotals: {},
    installationUsage: { [installation]: { siteTotals: { [site]: seconds }, updatedAt: 0 } },
    totalTimeSpent: seconds,
  };
}

function store(user, day) {
  return {
    read: () => readUsageCounters(db, user.uid, day),
    raise: (value) => raiseUsageCounters({
      projectId, idToken: user.token, uid: user.uid, dayKey: day, entry: value,
      fetchImpl: (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, 'https://firestore.googleapis.com');
        assert.equal(target.pathname, `${databasePath}/documents:commit`);
        // Preserve the production writer's exact payload and caller token. Only
        // the destination changes; the emulator executes the real transform.
        return fetch(`${firestoreOrigin}${target.pathname}`, { ...options, redirect: 'error' });
      },
    }),
  };
}

async function check(label, operation) {
  await operation();
  checks += 1;
  console.log(`PASS ${label}`);
}

function denied(response) {
  assert.equal(response.status, 403, 'The database must reject this counter write');
}

async function variant(filename, strict) {
  const label = strict ? 'strict' : 'rollout';
  const rules = fs.readFileSync(path.join(webRoot, filename), 'utf8');
  await loadRules(rules);
  const [owner, stranger] = await Promise.all([createUser(), createUser()]);
  const day = '2026-11-25';
  const canonical = store(owner, day);
  const documentPath = counterPath(owner.uid, day);
  const identity = { kind: 'installation', siteKey: 'chess.com', installationId: 'installation-a' };

  await check(`${label}: native maximum preserves 50, 50, 50, 55, 55 across retries and zero`, async () => {
    for (const [submitted, expected] of [[50, 50], [10, 50], [50, 50], [55, 55], [0, 55]]) {
      await canonical.raise(entry(submitted));
      const saved = await canonical.read();
      assert.equal(saved.siteTotals['chess.com'], expected);
      assert.equal(saved.installationUsage['installation-a'].siteTotals['chess.com'], expected);
      assert.equal(saved.totalTimeSpent, expected);
    }
  });

  await check(`${label}: raw lower, empty, identity-changing, and deleted counters are rejected`, async () => {
    for (const value of [
      { ...identity, seconds: 0 }, {}, { ...identity, seconds: 55, siteKey: 'other.example' },
      { ...identity, seconds: -1 }, { ...identity, seconds: '56' }, { ...identity, seconds: 55.5 },
    ]) denied(await rawWrite(documentPath, value, owner.token));
    denied(await rawDelete(documentPath, owner.token));
    assert.equal((await canonical.read()).siteTotals['chess.com'], 55);
  });

  await check(`${label}: owner can repeat or raise a number while other users and anonymous calls cannot`, async () => {
    assert.equal((await rawWrite(documentPath, { ...identity, seconds: 55 }, owner.token)).status, 200);
    assert.equal((await rawWrite(documentPath, { ...identity, seconds: 60 }, owner.token)).status, 200);
    for (const token of [stranger.token, undefined]) {
      denied(await rawWrite(documentPath, { ...identity, seconds: 100 }, token));
      denied(await request(firestoreOrigin, `${databasePath}/documents/${documentPath}`, { token }));
    }
    assert.equal((await canonical.read()).siteTotals['chess.com'], 60);
  });

  await check(`${label}: concurrent out-of-order maximum commits preserve every saved installation`, async () => {
    const race = store(owner, '2026-11-24');
    const values = [10, 1, 100, 50, 0, 90, 100, 25];
    await Promise.all(values.flatMap((seconds) => ['installation-a', 'installation-b'].map(async (install) => {
      await race.raise(entry(seconds, 'race.example', install));
      const saved = await race.read();
      assert.ok(saved.installationUsage[install].siteTotals['race.example'] >= seconds);
    })));
    const saved = await race.read();
    assert.equal(saved.installationUsage['installation-a'].siteTotals['race.example'], 100);
    assert.equal(saved.installationUsage['installation-b'].siteTotals['race.example'], 100);
    assert.equal(saved.siteTotals['race.example'], 200);
  });

  await check(`${label}: competing raw replacements cannot commit a stale lower value`, async () => {
    const rawPath = counterPath(owner.uid, '2026-11-23');
    const values = [80, 20, 100, 50, 90];
    assert.equal((await rawWrite(rawPath, { ...identity, seconds: 10 }, owner.token)).status, 200);
    const results = await Promise.all(values.map(async (seconds) => {
      const result = await rawWrite(rawPath, { ...identity, seconds }, owner.token);
      assert.ok(result.status === 200 || result.status === 403);
      return { seconds, status: result.status };
    }));
    const saved = await db.doc(rawPath).get();
    assert.equal(saved.get('seconds'), 100);
    for (const result of results) if (result.status === 200) assert.ok(saved.get('seconds') >= result.seconds);
    denied(await rawWrite(rawPath, { ...identity, seconds: 20 }, owner.token));
  });

  await check(`${label}: a new usage day cannot zero the previous day's records`, async () => {
    const yesterday = store(owner, '2026-11-21');
    const today = store(owner, '2026-11-22');
    await yesterday.raise(entry(150));
    await today.raise(entry(0));
    await today.raise(entry(1));
    assert.equal((await yesterday.read()).siteTotals['chess.com'], 150);
    assert.equal((await today.read()).siteTotals['chess.com'], 1);
  });

  await check(`${label}: migrated statistics reject lower writes, marker removal, and deletion`, async () => {
    const syncDay = '2026-11-20';
    const userRef = db.collection('users').doc(owner.uid);
    await userRef.set({ dailyUsageHistory: { [syncDay]: { siteTotals: { 'chess.com': 100 } } } });
    const result = await syncUsageForUser(db, owner.uid, {
      dayKey: syncDay, installationId: 'installation-a', siteTotals: { 'chess.com': 5 },
      baselineSiteTotals: { 'chess.com': 105 }, periodStart: Date.parse(`${syncDay}T00:00:00Z`),
    }, Date.parse(`${syncDay}T12:00:00Z`), store(owner, syncDay));
    assert.equal(result.entry.siteTotals['chess.com'], 105);
    assert.equal((await userRef.get()).get('usageCountersVersion'), 1);
    const rootPath = `users/${owner.uid}`;
    const current = (await userRef.get()).data();
    denied(await rawWrite(rootPath, { ...current, dailyUsageHistory: {} }, owner.token));
    const withoutMarker = { ...current };
    delete withoutMarker.usageCountersVersion;
    denied(await rawWrite(rootPath, withoutMarker, owner.token));
    denied(await rawDelete(rootPath, owner.token));
    const profile = await rawWrite(rootPath, { ...current, email: 'counter-test@example.invalid' }, owner.token);
    assert.equal(profile.status, 200, 'Normal owner profile updates must remain available');
  });

  await check(`${label}: lower configured limits and rule edits preserve all recorded usage`, async () => {
    const rootPath = `users/${owner.uid}`;
    const userRef = db.doc(rootPath);
    const syncDay = '2026-11-20';
    const before = (await userRef.get()).data();
    const savedCounters = await readUsageCounters(db, owner.uid, syncDay);
    const createdAt = '2026-11-25T12:00:00.000Z';
    const groups = [{ id: 'group:focus', name: 'Focus', items: ['chess.com', 'youtube.com'], createdAt }];
    const rule = (type, timeLimit, extra = {}) => ({
      id: `rule:${type}`, name: `${type} limit`, type, timeLimit, createdAt,
      targets: [{ type: 'group', id: 'group:focus' }], ...extra,
    });
    let rules = [
      rule('hard', 60), rule('soft', 30, { plusOnes: 5, plusOneDuration: 60 }),
      rule('session', 20), rule('time', 0, {
        schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], startTime: '09:00', endTime: '21:00' },
      }),
    ];
    const assertUsageUnchanged = async () => {
      const current = (await userRef.get()).data();
      assert.deepEqual(current.dailyUsageHistory, before.dailyUsageHistory);
      assert.equal(current.usageCountersVersion, 1);
      assert.deepEqual(await readUsageCounters(db, owner.uid, syncDay), savedCounters);
    };
    // Match saveUserSettings: Firestore arrays with a settings-only write mask.
    assert.equal((await mergeFields(rootPath, { rules, groups }, owner.token)).status, 200);
    assert.deepEqual((await userRef.get()).data().rules, rules);
    await assertUsageUnchanged();
    rules = rules.map((current) => ({
      ...current,
      timeLimit: { hard: 5, soft: 3, session: 2, time: 0 }[current.type],
      ...(current.type === 'soft' ? { plusOnes: 1, plusOneDuration: 30 } : {}),
      ...(current.type === 'time' ? { schedule: { days: ['mon'], startTime: '10:00', endTime: '18:00' } } : {}),
    }));
    assert.equal((await mergeFields(rootPath, { rules }, owner.token)).status, 200);
    assert.deepEqual((await userRef.get()).data().rules, rules);
    await assertUsageUnchanged();
    // Configuration has no monotonic direction: raising a configured limit
    // again is allowed too, independently of accumulated seconds.
    rules = rules.map((current) => current.type === 'hard' ? { ...current, timeLimit: 10 } : current);
    groups[0] = { ...groups[0], items: ['chess.com'] };
    assert.equal((await mergeFields(rootPath, { rules, groups }, owner.token)).status, 200);
    assert.deepEqual((await userRef.get()).data().groups, groups);
    await assertUsageUnchanged();
    for (const type of ['hard', 'soft', 'session', 'time']) {
      rules = rules.filter((current) => current.type !== type);
      assert.equal((await mergeFields(rootPath, { rules }, owner.token)).status, 200);
      assert.deepEqual((await userRef.get()).data().rules, rules);
      await assertUsageUnchanged();
    }
    assert.equal((await mergeFields(rootPath, { groups: [] }, owner.token)).status, 200);
    denied(await mergeFields(rootPath, { rules }, undefined));
    denied(await mergeFields(rootPath, { rules }, stranger.token));
    denied(await mergeFields(rootPath, { rules, dailyUsageHistory: {} }, owner.token));
    denied(await rawWrite(counterPath(owner.uid, syncDay), { ...identity, seconds: 0 }, owner.token));
    await assertUsageUnchanged();
  });

  await check(`${label}: permanent counters restore a damaged mirror through the real sync function`, async () => {
    const syncDay = '2026-11-20';
    const userRef = db.collection('users').doc(owner.uid);
    await userRef.update(new FieldPath('dailyUsageHistory', syncDay), { siteTotals: { 'chess.com': 0 }, totalTimeSpent: 0 });
    const authority = await readUsageCounters(db, owner.uid, syncDay);
    const recovered = mergeStoredUsageEntries(authority, (await userRef.get()).data().dailyUsageHistory[syncDay]);
    assert.equal(recovered.siteTotals['chess.com'], 105);
    const result = await syncUsageForUser(db, owner.uid, {
      dayKey: syncDay, installationId: 'installation-a', siteTotals: { 'chess.com': 0 },
      baselineSiteTotals: {}, periodStart: Date.parse(`${syncDay}T00:00:00Z`),
    }, Date.parse(`${syncDay}T12:00:01Z`), store(owner, syncDay));
    assert.equal(result.entry.siteTotals['chess.com'], 105);
    assert.equal((await userRef.get()).data().dailyUsageHistory[syncDay].siteTotals['chess.com'], 105);
  });

  await check(`${label}: unmarked legacy permissions match the selected rollout mode`, async () => {
    const rootPath = `users/${stranger.uid}`;
    await db.doc(rootPath).set({ dailyUsageHistory: { old: { totalTimeSpent: 100 } } });
    const result = await rawWrite(rootPath, { dailyUsageHistory: { old: { totalTimeSpent: 0 } } }, stranger.token);
    assert.equal(result.status, strict ? 403 : 200);
  });

  await check(`${label}: removing the numeric guard makes the lower-write check fail`, async () => {
    const controlPath = counterPath(owner.uid, '2026-11-19');
    await db.doc(controlPath).set({ ...identity, seconds: 55 });
    const weakened = rules.replace('&& request.resource.data.seconds >= resource.data.seconds', '');
    assert.notEqual(weakened, rules, 'The negative control must remove the numeric guard');
    try {
      await loadRules(weakened);
      const result = await rawWrite(controlPath, { ...identity, seconds: 0 }, owner.token);
      assert.equal(result.status, 200);
      assert.throws(() => denied(result), { code: 'ERR_ASSERTION' });
      assert.equal((await db.doc(controlPath).get()).get('seconds'), 0);
    } finally {
      await loadRules(rules);
    }
  });

  await check(`${label}: a permissive overlapping rule makes the deletion check fail`, async () => {
    const controlPath = counterPath(owner.uid, '2026-11-18');
    await db.doc(controlPath).set({ ...identity, seconds: 55 });
    const weakened = rules.replace('match /databases/{database}/documents {',
      'match /databases/{database}/documents { match /usageCounters/{leaked=**} { allow read, write: if true; }');
    assert.notEqual(weakened, rules, 'The negative control must add an overlapping allow rule');
    try {
      await loadRules(weakened);
      const result = await rawDelete(controlPath, stranger.token);
      assert.equal(result.status, 200);
      assert.throws(() => denied(result), { code: 'ERR_ASSERTION' });
    } finally {
      await loadRules(rules);
    }
  });
}

async function main() {
  try {
    await variant('firestore-counter-rollout.rules', false);
    await variant('firestore.rules', true);
    console.log(JSON.stringify({ emulatorChecks: checks, passed: checks, project: projectId, nativeMaximumVerified: true }));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
