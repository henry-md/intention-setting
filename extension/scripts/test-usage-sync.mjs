import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { mergeUsageEntry } = require('../../web/functions/usage.js');
const sourceUrl = new URL('../src/scripts/background.ts', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true);
const required = new Set(['withUsageStorageLock', 'getJournalEntry', 'syncToFirestore', 'syncToFirestoreInternal']);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && required.delete(node.name?.text));
assert.equal(required.size, 0, 'All worker sync declarations must exist');
const { outputText } = ts.transpileModule(
  `let usageSyncPromise = null; let usageStorageQueue = Promise.resolve();\n${declarations.map(node => node.getText(ast)).join('\n')}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
);
const journalUrl = new URL('../src/utils/usageJournal.ts', import.meta.url);
const journalModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(journalUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: journalModule.exports }, { filename: journalUrl.pathname });
const { maxSiteTotals, acknowledgeUsage } = journalModule.exports;

const site = 'example.com';
const dayKey = '2026-11-25';
const nextDayKey = '2026-11-26';
const periodStart = Date.parse(`${dayKey}T00:00:00Z`);
const installationId = 'test-installation';
const entry = (siteTotals = { [site]: 5 }, baselineSiteTotals = siteTotals) => ({
  siteTotals: structuredClone(siteTotals), baselineSiteTotals: structuredClone(baselineSiteTotals), periodStart, pending: true,
});
const plain = value => JSON.parse(JSON.stringify(value));

function createHarness({ localTotals = { [site]: 5 }, journal = { [dayKey]: entry() }, remoteEntries = {}, contribution, resetAppliedAt } = {}) {
  const storage = {
    user: { uid: 'test-user' }, currentUsageDayKey: dayKey,
    siteTimeData: Object.fromEntries(Object.entries(localTotals).map(([key, seconds]) => [key, { timeSpent: seconds, timeLimit: 300 }])),
    ...(journal ? { usageJournal: structuredClone(journal) } : {}),
    ...(contribution ? { usageContributionState: structuredClone(contribution) } : {}),
    ...(resetAppliedAt !== undefined ? { usageResetAppliedAt: resetAppliedAt } : {}),
  };
  const remote = { dailyUsageHistory: structuredClone(remoteEntries) };
  const errors = [], uploads = [];
  let nextUpload, context;
  const restart = () => {
    context = vm.createContext({
      // Pending uploads must survive a restart without either activeTimer or
      // secondsCounter, so neither in-memory value exists in this harness.
      USAGE_JOURNAL_KEY: 'usageJournal', USAGE_CONTRIBUTION_STATE_KEY: 'usageContributionState',
      CURRENT_USAGE_DAY_KEY_STORAGE_KEY: 'currentUsageDayKey', maxSiteTotals, acknowledgeUsage,
      console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
      chrome: { storage: { local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
          .filter(key => key in storage).map(key => [key, structuredClone(storage[key])])),
        set: async values => Object.assign(storage, structuredClone(values)),
      } } },
      ensureCurrentUsageDayState: async () => {},
      getResetSchedule: async () => ({ resetHour: 0, resetMinute: 0 }),
      getMostRecentResetBoundary: () => periodStart,
      getUsageInstallationId: async () => installationId,
      uploadUsage: async (userId, id, day, sent) => {
        assert.equal(userId, 'test-user');
        const uploaded = structuredClone(sent);
        uploads.push({ dayKey: day, sent: uploaded });
        const behavior = nextUpload;
        nextUpload = undefined;
        if (behavior) {
          behavior.started();
          if (behavior.release) await behavior.release;
          if (behavior.failBeforeCommit) throw new Error('Simulated offline upload');
        }
        const result = mergeUsageEntry(remote.dailyUsageHistory[day], {
          installationId: id, dayKey: day, ...uploaded,
        }, periodStart + 60_000);
        remote.dailyUsageHistory[day] = result.entry;
        if (behavior?.loseAcknowledgement) throw new Error('Connection lost after server commit');
        return structuredClone(result);
      },
    });
    vm.runInContext(outputText, context, { filename: sourceUrl.pathname });
  };
  restart();
  return {
    storage, remote, errors, uploads, restart,
    get context() { return context; },
    sync: () => context.syncToFirestore(),
    savedEntry: (day = dayKey) => remote.dailyUsageHistory[day],
    failNext: () => { nextUpload = { started() {}, failBeforeCommit: true }; },
    loseNextAcknowledgement: () => { nextUpload = { started() {}, loseAcknowledgement: true }; },
    holdNext: () => {
      let notifyStarted, release;
      const started = new Promise(resolve => { notifyStarted = resolve; });
      nextUpload = { started: notifyStarted, release: new Promise(resolve => { release = resolve; }) };
      return { started, release };
    },
    tick: (key = site, seconds = 1) => context.withUsageStorageLock(async () => {
      const day = storage.currentUsageDayKey;
      const current = context.getJournalEntry(storage, day, periodStart);
      const previousVisible = storage.siteTimeData[key]?.timeSpent || 0;
      current.siteTotals[key] = (current.siteTotals[key] || 0) + seconds;
      current.baselineSiteTotals = maxSiteTotals(current.baselineSiteTotals, { [key]: previousVisible + seconds });
      current.pending = true;
      storage.siteTimeData[key] = { timeSpent: previousVisible + seconds, timeLimit: 300 };
      storage.usageJournal = { ...storage.usageJournal, [day]: structuredClone(current) };
    }),
    changeDay: () => context.withUsageStorageLock(async () => {
      storage.currentUsageDayKey = nextDayKey;
      storage.siteTimeData = { [site]: { timeSpent: 0, timeLimit: 300 } };
      storage.usageJournal[nextDayKey] = entry({}, {});
    }),
  };
}

test('a fresh installation uploads its first persisted batch exactly once', async () => {
  const harness = createHarness();
  await harness.sync();
  assert.equal(harness.savedEntry().siteTotals[site], 5);
  assert.equal(harness.storage.usageJournal[dayKey].pending, false);
  await harness.sync();
  assert.equal(harness.uploads.length, 1);
});

test('migration uploads all sites and retains their existing shared totals', async () => {
  const harness = createHarness({
    localTotals: { [site]: 105, 'other.example': 25 }, journal: null,
    contribution: { dayKey, siteTotals: { [site]: 5, 'other.example': 5 }, seeded: true },
    remoteEntries: { [dayKey]: { siteTotals: { [site]: 100, 'other.example': 20 } } },
  });
  await harness.sync();
  assert.deepEqual(harness.savedEntry().siteTotals, { [site]: 105, 'other.example': 25 });
  assert.deepEqual(plain(harness.storage.usageJournal[dayKey].siteTotals), { [site]: 5, 'other.example': 5 });
});

test('a lower local contribution cannot overwrite a higher server counter', async () => {
  const harness = createHarness({
    localTotals: { [site]: 155 }, journal: null,
    contribution: { dayKey, siteTotals: { [site]: 10 }, seeded: true },
    remoteEntries: { [dayKey]: {
      usageFormatVersion: 2, legacySiteTotals: { [site]: 100 },
      installationUsage: { [installationId]: { siteTotals: { [site]: 50 }, updatedAt: periodStart } },
      siteTotals: { [site]: 150 },
    } },
  });
  await harness.sync();
  assert.equal(harness.savedEntry().siteTotals[site], 155);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 155);
  assert.equal(harness.storage.usageJournal[dayKey].siteTotals[site], 55);
});

test('ticks during a delayed upload remain visible and pending for the next upload', async () => {
  const harness = createHarness();
  const delayed = harness.holdNext(), sync = harness.sync();
  await delayed.started;
  await harness.tick(site, 3);
  delayed.release();
  await sync;
  assert.equal(harness.savedEntry().siteTotals[site], 5);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 8);
  assert.equal(harness.storage.usageJournal[dayKey].siteTotals[site], 8);
  assert.equal(harness.storage.usageJournal[dayKey].pending, true);
  await harness.sync();
  assert.equal(harness.savedEntry().siteTotals[site], 8);
  assert.equal(harness.storage.usageJournal[dayKey].pending, false);
});

test('migration rebasing preserves ticks on a second site while the request is pending', async () => {
  const harness = createHarness({
    localTotals: { [site]: 155 }, journal: { [dayKey]: entry({ [site]: 10 }, { [site]: 155 }) },
    remoteEntries: { [dayKey]: {
      legacySiteTotals: { [site]: 100 },
      installationUsage: { [installationId]: { siteTotals: { [site]: 50 }, updatedAt: periodStart } },
      siteTotals: { [site]: 150 },
    } },
  });
  const delayed = harness.holdNext(), sync = harness.sync();
  await delayed.started;
  await harness.tick(site, 2);
  await harness.tick('other.example', 1);
  delayed.release();
  await sync;
  assert.equal(harness.storage.usageJournal[dayKey].siteTotals[site], 57);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 157);
  assert.equal(harness.storage.siteTimeData['other.example'].timeSpent, 1);
  await harness.sync();
  assert.deepEqual(harness.savedEntry().siteTotals, { [site]: 157, 'other.example': 1 });
});

test('a lost server acknowledgement retries safely after a worker restart', async () => {
  const harness = createHarness();
  harness.loseNextAcknowledgement();
  await harness.sync();
  assert.equal(harness.savedEntry().siteTotals[site], 5);
  assert.equal(harness.storage.usageJournal[dayKey].pending, true);
  harness.restart();
  assert.equal('activeTimer' in harness.context, false);
  assert.equal('secondsCounter' in harness.context, false);
  await harness.sync();
  assert.equal(harness.savedEntry().siteTotals[site], 5);
  assert.equal(harness.storage.usageJournal[dayKey].pending, false);
  assert.equal(harness.uploads.length, 2);
});

test('a failed network request leaves every site in the persistent journal', async () => {
  const harness = createHarness();
  await harness.tick('other.example', 2);
  const before = structuredClone(harness.storage.usageJournal);
  harness.failNext();
  await harness.sync();
  assert.deepEqual(harness.storage.usageJournal, before);
  assert.equal(harness.savedEntry(), undefined);
  assert.equal(harness.errors.length, 1);
  await harness.sync();
  assert.deepEqual(harness.savedEntry().siteTotals, { [site]: 5, 'other.example': 2 });
});

test('overlapping sync requests share the same upload', async () => {
  const harness = createHarness();
  const delayed = harness.holdNext(), first = harness.sync(), second = harness.sync();
  assert.equal(first, second);
  await delayed.started;
  delayed.release();
  await Promise.all([first, second]);
  assert.equal(harness.uploads.length, 1);
  assert.equal(harness.savedEntry().siteTotals[site], 5);
});

test('an old-day acknowledgement cannot overwrite the next day counter', async () => {
  const harness = createHarness();
  const delayed = harness.holdNext(), sync = harness.sync();
  await delayed.started;
  await harness.changeDay();
  await harness.tick(site, 1);
  delayed.release();
  await sync;
  assert.equal(harness.savedEntry().siteTotals[site], 5);
  assert.equal(harness.storage.siteTimeData[site].timeSpent, 1);
  assert.equal(harness.storage.usageJournal[dayKey], undefined);
  assert.equal(harness.storage.usageJournal[nextDayKey].pending, true);
  await harness.sync();
  assert.equal(harness.savedEntry(nextDayKey).siteTotals[site], 1);
});

test('a previously applied reset marker still permits normal acknowledgements', async () => {
  const harness = createHarness({ resetAppliedAt: 123 });
  await harness.sync();
  assert.equal(harness.storage.usageJournal[dayKey].pending, false);
});

test('a reset during an upload prevents its response from reviving cleared time', async () => {
  const harness = createHarness();
  const delayed = harness.holdNext(), sync = harness.sync();
  await delayed.started;
  await harness.context.withUsageStorageLock(async () => {
    harness.storage.usageResetAppliedAt = 456;
    harness.storage.usageJournal = {};
    harness.storage.siteTimeData = {};
  });
  delayed.release();
  await sync;
  assert.deepEqual(harness.storage.siteTimeData, {});
  assert.deepEqual(harness.storage.usageJournal, {});
});

test('acknowledgement retains a higher local baseline until the server saves it', () => {
  const sent = entry({ [site]: 5 }, { [site]: 105 });
  const current = entry({ [site]: 5 }, { [site]: 109 });
  const result = acknowledgeUsage(current, sent, { [site]: 5 }, { [site]: 105 });
  assert.equal(result.journalEntry.baselineSiteTotals[site], 109);
  assert.equal(result.journalEntry.pending, true);
});
