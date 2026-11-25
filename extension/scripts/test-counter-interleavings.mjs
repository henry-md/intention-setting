import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { mergeUsageEntry } = require('../../web/functions/usage.js');
const workerUrl = new URL('../src/scripts/background.ts', import.meta.url);
const workerSource = fs.readFileSync(workerUrl, 'utf8');
const ast = ts.createSourceFile(workerUrl.pathname, workerSource, ts.ScriptTarget.Latest, true);
const names = new Set([
  'withUsageStorageLock', 'getCurrentUsageDayKey', 'getPreviousBoundary',
  'ensureCurrentUsageDayState', 'ensureCurrentUsageDayStateInternal',
  'getMostRecentResetBoundary', 'getJournalEntry', 'resetAllSiteTime',
  'syncToFirestore', 'syncToFirestoreInternal', 'timerTick', 'timerTickInternal',
]);
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.delete(node.name?.text));
assert.equal(names.size, 0, 'The tests must execute the real rollover, journal, queue, tick, and sync functions');
const compiledWorker = ts.transpileModule([
  'let usageSyncPromise = null; let usageStorageQueue = Promise.resolve();',
  ...declarations.map((node) => node.getText(ast)),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function helpers(filename) {
  const url = new URL(`../src/utils/${filename}.ts`, import.meta.url);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports }, { filename: url.pathname });
  return exports;
}
const { shouldResetUsageDay } = helpers('usageDayReset');
const { maxSiteTotals, acknowledgeUsage } = helpers('usageJournal');
const site = 'chess.com';
const installationId = 'rollover-installation';
const day = '2026-11-25';
const nextDay = '2026-11-26';
const localTime = (dayOfMonth, hour, minute = 0, second = 0) => new Date(2026, 10, dayOfMonth, hour, minute, second).getTime();
const dayStart = localTime(25, 4);
const initialNow = localTime(25, 23, 59, 59);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createHarness({ storedDay = day, now = initialNow, localTotal = 120, ownTotal = 20, journal = true } = {}) {
  let clock = now;
  const storage = {
    user: { uid: 'test-user' }, currentUsageDayKey: storedDay,
    lastResetTimestamp: new Date(`${storedDay}T04:00:00`).getTime(),
    siteTimeData: { [site]: { timeSpent: localTotal, timeLimit: 0, lastUpdated: now - 1000 } },
    ruleUsageData: { 'chess-limit': { timeSpent: localTotal, lastUpdated: now - 1000 } },
    siteRuleIds: {}, compiledRules: {},
    usageContributionState: { dayKey: storedDay, siteTotals: { [site]: ownTotal }, seeded: true },
    usageJournal: journal ? { [storedDay]: {
      siteTotals: { [site]: ownTotal }, baselineSiteTotals: { [site]: localTotal },
      periodStart: new Date(`${storedDay}T04:00:00`).getTime(), pending: true,
    } } : {},
  };
  const remote = { [storedDay]: {
    usageFormatVersion: 2, legacySiteTotals: { [site]: localTotal - ownTotal },
    installationUsage: { [installationId]: { siteTotals: { [site]: ownTotal }, updatedAt: now - 1000 } },
    siteTotals: { [site]: localTotal }, totalTimeSpent: localTotal,
  } };
  const writes = [], uploads = [], errors = [], observations = new Map();
  let context, failUpload = false, pauseUpload, pauseRead, rejectSet;
  const observe = () => {
    const previous = observations.get(storage.currentUsageDayKey) || {};
    for (const [key, value] of Object.entries(storage.siteTimeData)) {
      assert.ok(value.timeSpent >= (previous[key] || 0), `${storage.currentUsageDayKey}/${key} decreased`);
      previous[key] = value.timeSpent;
    }
    observations.set(storage.currentUsageDayKey, previous);
  };
  observe();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const restart = () => {
    context = vm.createContext({
      Date: Clock,
      activeTimer: { tabId: 1, siteKey: site, intervalId: 1, startedAt: clock },
      CURRENT_USAGE_DAY_KEY_STORAGE_KEY: 'currentUsageDayKey',
      USAGE_JOURNAL_KEY: 'usageJournal', USAGE_CONTRIBUTION_STATE_KEY: 'usageContributionState',
      shouldResetUsageDay, maxSiteTotals, acknowledgeUsage,
      console: { log() {}, error: (...args) => errors.push(args) },
      format: (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
      chrome: {
        tabs: { get: async () => ({ active: true }) },
        storage: { local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const result = Object.fromEntries(list.filter((key) => key in storage).map((key) => [key, structuredClone(storage[key])]));
            if (pauseRead?.matches(list)) {
              const gate = pauseRead;
              pauseRead = undefined;
              gate.started.resolve();
              await gate.release.promise;
            }
            return result;
          },
          set: async (values) => {
            if (rejectSet?.(values)) {
              rejectSet = undefined;
              throw new Error('Simulated Chrome storage write failure');
            }
            writes.push(structuredClone(values));
            Object.assign(storage, structuredClone(values));
            observe();
          },
        } },
      },
      getResetSchedule: async () => ({ resetHour: 4, resetMinute: 0 }),
      getUsageInstallationId: async () => installationId,
      getBlockingTimeRuleId: () => null,
      getMostRestrictiveRuleIdForSite: () => null,
      getApplicableTimeRuleIdsForSite: () => [],
      uploadUsage: async (_uid, id, key, sent) => {
        uploads.push({ dayKey: key, sent: structuredClone(sent) });
        if (pauseUpload) {
          const gate = pauseUpload;
          pauseUpload = undefined;
          gate.started.resolve();
          await gate.release.promise;
        }
        if (failUpload) { failUpload = false; throw new Error('Simulated unavailable backend'); }
        const previous = remote[key]?.siteTotals || {};
        const result = mergeUsageEntry(remote[key], { installationId: id, dayKey: key, ...sent }, clock);
        for (const [key, seconds] of Object.entries(previous)) assert.ok(result.entry.siteTotals[key] >= seconds);
        remote[key] = structuredClone(result.entry);
        return structuredClone(result);
      },
      stopCurrentTimer: () => { context.activeTimer = null; },
    });
    vm.runInContext(compiledWorker, context, { filename: workerUrl.pathname });
  };
  restart();
  const gate = () => {
    const started = deferred(), release = deferred();
    return { started, release };
  };
  return {
    storage, remote, writes, uploads, errors, observations, restart,
    get context() { return context; },
    time: (timestamp) => { clock = timestamp; },
    tick: () => context.timerTick(),
    ensureDay: () => context.ensureCurrentUsageDayState('interleaving-test'),
    sync: () => context.syncToFirestore(),
    failNextUpload: () => { failUpload = true; },
    failNextWrite: (predicate = () => true) => { rejectSet = predicate; },
    holdNextUpload: () => {
      pauseUpload = gate();
      return { started: pauseUpload.started.promise, release: pauseUpload.release.resolve };
    },
    holdNextTickRead: () => {
      pauseRead = { ...gate(), matches: (keys) => keys.includes('siteRuleIds') && keys.includes('siteTimeData') };
      return { started: pauseRead.started.promise, release: pauseRead.release.resolve };
    },
  };
}

test('the real 4 a.m. rollover archives the prior day once when alarms and a tick overlap', async () => {
  const harness = createHarness({ storedDay: '2026-11-24', now: localTime(25, 3, 59, 59) });
  await harness.ensureDay();
  assert.equal(harness.storage.currentUsageDayKey, '2026-11-24');
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 120);
  harness.time(dayStart);
  await Promise.all([harness.ensureDay(), harness.tick(), harness.ensureDay()]);
  assert.equal(harness.storage.currentUsageDayKey, day);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 1);
  assert.equal(harness.storage.usageJournal['2026-11-24'].baselineSiteTotals[site], 120);
  assert.equal(harness.storage.usageJournal['2026-11-24'].siteTotals[site], 20);
  assert.equal(harness.storage.usageJournal['2026-11-24'].pending, true);
  assert.equal(harness.storage.usageJournal[day].siteTotals[site], 1);
  assert.equal(harness.writes.filter((values) => values.currentUsageDayKey === day).length, 1);
});

test('a restart after an offline rollover uploads both days without moving yesterday into today', async () => {
  const harness = createHarness();
  await harness.tick();
  await harness.tick();
  harness.failNextUpload();
  await harness.sync();
  assert.equal(harness.remote[day].siteTotals[site], 120);
  assert.equal(harness.storage.usageJournal[day].siteTotals[site], 22);
  harness.time(localTime(26, 4, 0, 1));
  await harness.tick();
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 1);
  harness.restart();
  await harness.sync();
  assert.equal(harness.remote[day].siteTotals[site], 122);
  assert.equal(harness.remote[nextDay].siteTotals[site], 1);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 1);
  assert.equal(harness.storage.usageJournal[day], undefined, 'Only the acknowledged old journal can be removed');
  assert.equal(harness.storage.usageJournal[nextDay].pending, false);
  assert.equal(harness.errors.length, 1);
});

test('a delayed prior-day acknowledgement cannot overwrite ticks after the real rollover', async () => {
  const harness = createHarness();
  const held = harness.holdNextUpload();
  const oldSync = harness.sync();
  await held.started;
  harness.time(localTime(26, 4));
  await harness.tick();
  await harness.tick();
  held.release();
  await oldSync;
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 2);
  assert.equal(harness.storage.usageJournal[nextDay].siteTotals[site], 2);
  assert.equal(harness.storage.usageJournal[nextDay].pending, true);
  assert.equal(harness.remote[day].siteTotals[site], 120);
  await harness.sync();
  assert.equal(harness.remote[nextDay].siteTotals[site], 2);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 2);
});

test('callbacks waiting behind a delayed storage read each retain their durable second', async () => {
  const harness = createHarness();
  const held = harness.holdNextTickRead();
  const first = harness.tick();
  await held.started;
  const second = harness.tick();
  // Drain the second callback's ready promises while the first read remains
  // stalled. Without serialization it can otherwise finish before the stall
  // is released, allowing the older snapshot to erase its recorded second.
  await new Promise((resolve) => setImmediate(resolve));
  held.release();
  await Promise.all([first, second]);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 122);
  assert.equal(harness.storage.usageJournal[day].siteTotals[site], 22);
  assert.equal(harness.writes.length, 2);
  assert.ok(harness.writes.every((values) => values.siteTimeData && values.usageJournal));
});

test('a failed tick storage commit cannot expose a second without its pending upload record', async () => {
  const harness = createHarness();
  const before = structuredClone(harness.storage);
  harness.failNextWrite((values) => values.siteTimeData && values.usageJournal);
  await assert.rejects(harness.tick(), /storage write failure/);
  assert.deepEqual(harness.storage, before);
  await harness.tick();
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 121);
  assert.equal(harness.storage.usageJournal[day].siteTotals[site], 21);
  assert.equal(harness.writes.length, 1, 'A rejected queue item must not prevent a later durable tick');
});

test('a failed rollover commit preserves the old day until the whole transition can retry', async () => {
  const harness = createHarness();
  const before = structuredClone(harness.storage);
  harness.time(localTime(26, 4));
  harness.failNextWrite((values) => values.currentUsageDayKey === nextDay);
  await assert.rejects(harness.ensureDay(), /storage write failure/);
  assert.deepEqual(harness.storage, before);
  harness.restart();
  await harness.tick();
  assert.equal(harness.storage.currentUsageDayKey, nextDay);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 1);
  assert.equal(harness.storage.usageJournal[day].baselineSiteTotals[site], 120);
  assert.equal(harness.storage.usageJournal[day].siteTotals[site], 20);
});

test('returning after several absent days archives the actual stored day and its original boundary', async () => {
  const harness = createHarness({ storedDay: '2026-11-20', journal: false });
  await harness.ensureDay();
  const archived = harness.storage.usageJournal['2026-11-20'];
  assert.equal(archived.periodStart, localTime(20, 4));
  assert.equal(archived.siteTotals[site], 20);
  assert.equal(archived.baselineSiteTotals[site], 120);
  assert.equal(harness.storage.usageJournal['2026-11-24'], undefined);
  assert.equal(harness.storage.currentUsageDayKey, day);
  await harness.sync();
  assert.equal(harness.remote['2026-11-20'].siteTotals[site], 120);
  assert.equal(harness.remote[day].totalTimeSpent, 0);
});

test('a backward clock change continues the recorded day without resetting or losing contributions', async () => {
  const harness = createHarness();
  harness.time(localTime(24, 12));
  await Promise.all([harness.ensureDay(), harness.tick(), harness.ensureDay()]);
  assert.equal(harness.storage.currentUsageDayKey, day);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 121);
  assert.equal(harness.storage.usageJournal[day].siteTotals[site], 21);
  assert.equal(harness.writes.filter((values) => values.currentUsageDayKey).length, 0);
  assert.equal(harness.observations.get(day)[site], 121);
});

test('4 a.m. boundaries preserve the previous day across both daylight saving changes', async () => {
  if (process.env.COUNTER_DST_CHILD !== '1') {
    const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=4 a.m. boundaries', fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: 'America/New_York', COUNTER_DST_CHILD: '1' }, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    return;
  }
  for (const [before, after, previousDay, currentDay, hours] of [
    ['2026-03-08T07:59:59Z', '2026-03-08T08:00:00Z', '2026-03-07', '2026-03-08', 23],
    ['2026-11-01T08:59:59Z', '2026-11-01T09:00:00Z', '2026-10-31', '2026-11-01', 25],
  ]) {
    const start = Date.parse(before), end = Date.parse(after);
    const harness = createHarness({ storedDay: previousDay, now: start, localTotal: 9, ownTotal: 5, journal: false });
    const boundary = (timestamp) => harness.context.getMostRecentResetBoundary(timestamp, 4, 0);
    assert.equal((boundary(end) - boundary(start)) / 3_600_000, hours);
    await harness.ensureDay();
    assert.equal(harness.storage.currentUsageDayKey, previousDay);
    assert.equal(harness.storage.siteTimeData[site].timeSpent, 9);
    harness.time(end);
    await Promise.all([harness.ensureDay(), harness.ensureDay()]);
    assert.equal(harness.storage.currentUsageDayKey, currentDay);
    assert.equal(harness.storage.siteTimeData[site].timeSpent, 0);
    assert.equal(harness.storage.usageJournal[previousDay].baselineSiteTotals[site], 9);
    assert.equal(harness.storage.usageJournal[previousDay].periodStart, boundary(start));
    assert.equal(harness.writes.filter((values) => values.currentUsageDayKey === currentDay).length, 1);
  }
});
