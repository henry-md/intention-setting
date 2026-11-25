import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const sourceUrl = new URL('../src/scripts/background.ts', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true);
const names = new Set(['timerTick', 'timerTickInternal', 'getMostRecentResetBoundary', 'getJournalEntry', 'withUsageStorageLock']);
const declarations = ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.has(node.name?.text)
);
assert.ok(declarations.some((node) => node.name?.text === 'timerTick'));
const journalUrl = new URL('../src/utils/usageJournal.ts', import.meta.url);
const journalSource = fs.readFileSync(journalUrl, 'utf8');
const journalAst = ts.createSourceFile(journalUrl.pathname, journalSource, ts.ScriptTarget.Latest, true);
const maxSiteTotals = journalAst.statements.find((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((declaration) => declaration.name?.text === 'maxSiteTotals'));
assert.ok(maxSiteTotals);
const { outputText } = ts.transpileModule([
  maxSiteTotals.getText(journalAst).replace(/^export\s+/, ''),
  ...declarations.map((node) => node.getText(ast)),
].join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
});

const now = Date.parse('2026-11-25T20:40:00Z');
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

function createHarness({ pauseAt, replaceTimer = false, initialStorage } = {}) {
  const writes = [];
  const resets = [];
  const storage = structuredClone(initialStorage || {
    user: { uid: 'test-user' },
    currentUsageDayKey: '2026-11-25',
    siteTimeData: { 'chess.com': { timeSpent: 885, timeLimit: 3600, lastUpdated: now - 1000 } },
    siteRuleIds: {}, compiledRules: {}, ruleUsageData: {},
    usageJournal: {},
    usageContributionState: {
      dayKey: '2026-11-25', siteTotals: { 'chess.com': 880 }, seeded: true,
    },
  });
  let invalidated = false;
  let context;
  const invalidate = () => {
    if (invalidated) return;
    invalidated = true;
    context.activeTimer = replaceTimer
      ? { tabId: 2, siteKey: 'chess.com', intervalId: 2, startedAt: now }
      : null;
    context.lastTickTimestamp = replaceTimer ? now : null;
  };
  const checkDay = async () => { if (pauseAt === 'day-check') invalidate(); };
  context = vm.createContext({
    Date: TestDate,
    activeTimer: { tabId: 1, siteKey: 'chess.com', intervalId: 1, startedAt: now - 10_000 },
    lastTickTimestamp: now - 1000,
    secondsCounter: 0,
    usageStorageQueue: Promise.resolve(),
    USAGE_JOURNAL_KEY: 'usageJournal',
    USAGE_JOURNAL_STORAGE_KEY: 'usageJournal',
    USAGE_CONTRIBUTION_STATE_KEY: 'usageContributionState',
    CURRENT_USAGE_DAY_KEY_STORAGE_KEY: 'currentUsageDayKey',
    console: { log() {}, error() {}, warn() {} },
    chrome: {
      tabs: { get: async () => ({ active: true }) },
      storage: { local: {
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const result = Object.fromEntries(list.filter((key) => key in storage)
            .map((key) => [key, structuredClone(storage[key])]));
          if (pauseAt === 'usage-read' && list.includes('siteTimeData')) invalidate();
          return result;
        },
        set: async (values) => {
          writes.push(structuredClone(values));
          Object.assign(storage, structuredClone(values));
        },
      } },
    },
    ensureCurrentUsageDayStateInternal: checkDay,
    ensureCurrentUsageDayState: checkDay,
    getResetSchedule: async () => { await checkDay(); return { resetHour: 4, resetMinute: 0 }; },
    maybeRunDailyReset: async (_userId, previousBoundary, currentBoundary) => {
      if (previousBoundary < currentBoundary) resets.push({ previousBoundary, currentBoundary });
    },
    stopCurrentTimer: invalidate,
    getBlockingTimeRuleId: () => null,
    getMostRestrictiveRuleIdForSite: () => null,
    getApplicableTimeRuleIdsForSite: () => [],
  });
  vm.runInContext(outputText, context, { filename: sourceUrl.pathname });
  return { context, storage, writes, resets, tick: () => context.timerTick() };
}

test('blurring during the daily check cannot reset the current usage day', async () => {
  const harness = createHarness({ pauseAt: 'day-check' });
  await harness.tick();
  assert.equal(harness.resets.length, 0, 'A stopped timer must not turn null into a 1970 reset boundary');
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 885);
  assert.equal(harness.writes.length, 0);
});

test('blurring while reading usage cannot commit a stale tick', async () => {
  const harness = createHarness({ pauseAt: 'usage-read' });
  await harness.tick();
  assert.equal(harness.resets.length, 0);
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 885);
  assert.equal(harness.writes.length, 0);
});

test('switching to another chess tab during the daily check cancels the old tick', async () => {
  const harness = createHarness({ pauseAt: 'day-check', replaceTimer: true });
  await harness.tick();
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 885);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.context.activeTimer.tabId, 2);
});

test('a valid tick saves its visible counter and pending contribution in one write', async () => {
  const harness = createHarness();
  await harness.tick();
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 886);
  assert.equal(harness.storage.usageJournal['2026-11-25'].siteTotals['chess.com'], 881);
  assert.equal(harness.storage.usageJournal['2026-11-25'].baselineSiteTotals['chess.com'], 886);
  assert.equal(harness.storage.usageJournal['2026-11-25'].pending, true);
  assert.equal(harness.writes.length, 1);
  assert.ok(harness.writes[0].siteTimeData);
  assert.ok(harness.writes[0].usageJournal);
});

test('a restarted worker continues the persisted contribution without losing its pending tick', async () => {
  const first = createHarness();
  await first.tick();
  const restarted = createHarness({ initialStorage: first.storage });
  await restarted.tick();
  assert.equal(restarted.storage.siteTimeData['chess.com'].timeSpent, 887);
  assert.equal(restarted.storage.usageJournal['2026-11-25'].siteTotals['chess.com'], 882);
  assert.equal(restarted.storage.usageJournal['2026-11-25'].pending, true);
});

test('a tick queued for one timer cannot count time on its replacement', async () => {
  const harness = createHarness();
  let release;
  harness.context.usageStorageQueue = new Promise((resolve) => { release = resolve; });
  const tick = harness.tick();
  harness.context.activeTimer = { tabId: 2, siteKey: 'chess.com', intervalId: 2, startedAt: now };
  release();
  await tick;
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 885);
  assert.equal(harness.writes.length, 0);
});

test('the first tick of a fresh installation records one pending second', async () => {
  const initial = createHarness().storage;
  initial.siteTimeData['chess.com'].timeSpent = 0;
  delete initial.usageContributionState;
  const harness = createHarness({ initialStorage: initial });
  await harness.tick();
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 1);
  assert.equal(harness.storage.usageJournal['2026-11-25'].siteTotals['chess.com'], 1);
  assert.equal(harness.storage.usageJournal['2026-11-25'].baselineSiteTotals['chess.com'], 1);
  assert.equal(harness.writes.length, 1);
});

test('a callback received without a timer cannot count a later startup timer', async () => {
  const harness = createHarness();
  let release;
  harness.context.usageStorageQueue = new Promise((resolve) => { release = resolve; });
  harness.context.activeTimer = null;
  const tick = harness.tick();
  harness.context.activeTimer = { tabId: 2, siteKey: 'chess.com', intervalId: 2, startedAt: now };
  release();
  await tick;
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 885);
  assert.equal(harness.writes.length, 0);
});
