import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const helperUrl = new URL('../src/utils/usageDayReset.ts', import.meta.url);
const helperContext = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync(helperUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, helperContext);
const { shouldResetUsageDay } = helperContext.exports;

const now = new Date(2026, 10, 25, 15, 45).getTime();
const boundary = new Date(2026, 10, 25).getTime();
const yesterday = new Date(2026, 10, 24, 12).getTime();
const input = {
  expectedUsageDayKey: '2026-11-25',
  currentBoundary: boundary,
  lastResetTimestamp: yesterday,
  latestSiteUpdate: now,
};

test('the current usage day prevents a second reset despite a stale reset timestamp', () => {
  assert.equal(shouldResetUsageDay({ ...input, storedUsageDayKey: '2026-11-25' }), false);
});

test('a later stored usage day survives a backwards clock change', () => {
  assert.equal(shouldResetUsageDay({ ...input, storedUsageDayKey: '2026-11-26' }), false);
});

test('a previous usage day rolls over even if counters were touched today', () => {
  assert.equal(shouldResetUsageDay({ ...input, storedUsageDayKey: '2026-11-24' }), true);
});

test('migration preserves counters updated after the current reset boundary', () => {
  assert.equal(shouldResetUsageDay({ ...input, storedUsageDayKey: undefined }), false);
});

test('migration rolls over counters when both timestamps precede the boundary', () => {
  assert.equal(shouldResetUsageDay({ ...input, storedUsageDayKey: undefined, latestSiteUpdate: yesterday }), true);
});

test('migration uses the newer reset timestamp and ignores invalid timestamps', () => {
  assert.equal(shouldResetUsageDay({
    ...input, storedUsageDayKey: undefined, lastResetTimestamp: now, latestSiteUpdate: yesterday,
  }), false);
  assert.equal(shouldResetUsageDay({
    ...input, storedUsageDayKey: undefined, lastResetTimestamp: 'invalid', latestSiteUpdate: yesterday,
  }), true);
  assert.equal(shouldResetUsageDay({
    ...input, storedUsageDayKey: undefined, lastResetTimestamp: null, latestSiteUpdate: undefined,
  }), false);
});

test('migration preserves counters recorded exactly at the boundary or after a clock rollback', () => {
  assert.equal(shouldResetUsageDay({
    ...input, storedUsageDayKey: undefined, latestSiteUpdate: boundary,
  }), false);
  assert.equal(shouldResetUsageDay({
    ...input, storedUsageDayKey: undefined, latestSiteUpdate: now + 86_400_000,
  }), false);
});

// Run the worker's scheduled entry point as well as its day guard, so the
// regression catches a scheduled reset that bypasses the shared decision.
const workerUrl = new URL('../src/scripts/background.ts', import.meta.url);
const workerSource = fs.readFileSync(workerUrl, 'utf8');
const ast = ts.createSourceFile(workerUrl.pathname, workerSource, ts.ScriptTarget.Latest, true);
const names = new Set([
  'getCurrentUsageDayKey', 'getMostRecentResetBoundary',
  'getPreviousBoundary', 'ensureCurrentUsageDayState', 'ensureCurrentUsageDayStateInternal',
  'checkAndApplyScheduledDailyReset',
]);
const declarations = ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.has(node.name?.text)
);
assert.equal(declarations.length, names.size, 'All daily reset entry points must exist');
const workerCode = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function createScheduledHarness({ storedUsageDayKey = '2026-11-25', latestSiteUpdate = now } = {}) {
  const storage = {
    user: { uid: 'test-user' },
    ...(storedUsageDayKey ? { currentUsageDayKey: storedUsageDayKey } : {}),
    lastResetTimestamp: yesterday,
    siteTimeData: { 'chess.com': { timeSpent: 123, timeLimit: 3600, lastUpdated: latestSiteUpdate } },
    ruleUsageData: {},
  };
  const resetCalls = [];
  const errors = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    Date: FixedDate,
    console: { log() {}, error: (...args) => errors.push(args) },
    CURRENT_USAGE_DAY_KEY_STORAGE_KEY: 'currentUsageDayKey',
    shouldResetUsageDay,
    withUsageStorageLock: (operation) => operation(),
    syncToFirestore: async () => {},
    getResetSchedule: async () => ({ resetHour: 0, resetMinute: 0 }),
    format: (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-'),
    chrome: { storage: { local: {
      get: async (keys) => Object.fromEntries(keys.filter((key) => key in storage)
        .map((key) => [key, structuredClone(storage[key])])),
      set: async (values) => Object.assign(storage, structuredClone(values)),
    } } },
    resetAllSiteTime: async (...args) => { resetCalls.push(args); },
    maybeRunDailyReset: async (...args) => {
      if (args[1] < args[2]) resetCalls.push(args);
    },
  });
  vm.runInContext(workerCode, context, { filename: workerUrl.pathname });
  return {
    storage, resetCalls, errors,
    check: () => context.checkAndApplyScheduledDailyReset('regression-test'),
  };
}

test('the actual scheduled check preserves the current day and all recorded seconds', async () => {
  const { storage, resetCalls, errors, check } = createScheduledHarness();
  await check();

  assert.deepEqual(errors, []);
  assert.equal(resetCalls.length, 0, 'The current usage day must not be cleared again');
  assert.equal(storage.siteTimeData['chess.com'].timeSpent, 123);
  assert.equal(storage.currentUsageDayKey, '2026-11-25');
});

test('the actual scheduled check never moves a stored usage day backwards', async () => {
  const { storage, resetCalls, errors, check } = createScheduledHarness({ storedUsageDayKey: '2026-11-26' });
  await check();

  assert.deepEqual(errors, []);
  assert.equal(resetCalls.length, 0);
  assert.equal(storage.siteTimeData['chess.com'].timeSpent, 123);
  assert.equal(storage.currentUsageDayKey, '2026-11-26');
});

test('the actual scheduled check adopts a missing day key without clearing current counters', async () => {
  const { storage, resetCalls, errors, check } = createScheduledHarness({ storedUsageDayKey: '' });
  await check();

  assert.deepEqual(errors, []);
  assert.equal(resetCalls.length, 0);
  assert.equal(storage.siteTimeData['chess.com'].timeSpent, 123);
  assert.equal(storage.currentUsageDayKey, '2026-11-25');
});

test('the actual scheduled check resets a prior usage day', async () => {
  const { resetCalls, errors, check } = createScheduledHarness({
    storedUsageDayKey: '2026-11-24', latestSiteUpdate: yesterday,
  });
  await check();

  assert.deepEqual(errors, []);
  assert.equal(resetCalls.length, 1);
});
