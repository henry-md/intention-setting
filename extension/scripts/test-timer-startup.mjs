import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const sourceUrl = new URL('../src/scripts/background.ts', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true);
const names = new Set(['startTimerForTab', 'stopCurrentTimer', 'hydrateSharedUsageForCurrentDay']);
const declarations = ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.has(node.name?.text)
);
assert.equal(declarations.length, names.size, 'All timer startup functions must exist');
const { outputText } = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
});

function createHarness({ network = 'offline', remoteEntry } = {}) {
  const storage = {
    user: { uid: 'test-user' },
    currentUsageDayKey: '2026-11-25',
    siteRules: {
      'chess.com': { ruleType: 'hard', timeLimit: 600, ruleId: 'chess' },
      'youtube.com': { ruleType: 'hard', timeLimit: 600, ruleId: 'youtube' },
    },
    siteTimeData: {},
    ruleUsageData: {},
    compiledRules: {},
    siteRuleIds: {},
  };
  const intervals = [];
  const errors = [];
  const loads = [];
  const writes = [];
  let ticks = 0;
  let resolveNetwork;
  let resolveLoadStarted;
  const networkGate = new Promise((resolve) => { resolveNetwork = resolve; });
  const loadStarted = new Promise((resolve) => { resolveLoadStarted = resolve; });
  const context = vm.createContext({
    activeTimer: null,
    syncIntervalId: null,
    timerStartGeneration: 0,
    usageHydrationPromise: null,
    CURRENT_USAGE_DAY_KEY_STORAGE_KEY: 'currentUsageDayKey',
    TIMER_TICK_INTERVAL: 1000,
    FIRESTORE_SYNC_INTERVAL: 5000,
    console: { log() {}, error: (...args) => errors.push(args) },
    chrome: {
      tabs: { get: async (tabId) => ({ id: tabId, active: true, url: tabId === 1 ? 'https://chess.com/' : 'https://youtube.com/' }) },
      storage: { local: {
        get: async (keys) => Object.fromEntries(keys.filter((key) => key in storage)
          .map((key) => [key, structuredClone(storage[key])])),
        set: async (values) => {
          writes.push(structuredClone(values));
          Object.assign(storage, structuredClone(values));
        },
      } },
    },
    loadUsage: async (...args) => {
      loads.push(args);
      resolveLoadStarted();
      if (network === 'offline') throw new Error('Simulated offline usage endpoint');
      await networkGate;
      return structuredClone(remoteEntry);
    },
    checkAndApplyRemoteUsageReset: async () => {},
    ensureCurrentUsageDayState: async () => {},
    withUsageStorageLock: (operation) => operation(),
    getMessagesRedirect: () => null,
    isDirectMessageUrl: () => false,
    getMostRestrictiveRuleIdForSite: () => null,
    getBlockingTimeRuleId: () => null,
    getResetSchedule: async () => ({ resetHour: 4, resetMinute: 0 }),
    getTimezoneAbbreviation: () => 'EST',
    formatDateWithTimezone: () => 'test reset time',
    syncToFirestore: async () => {},
    timerTick: () => { ticks += 1; },
    setInterval: (callback, milliseconds) => {
      const interval = { callback, milliseconds, cleared: false };
      intervals.push(interval);
      return interval;
    },
    clearInterval: (interval) => { interval.cleared = true; },
  });
  vm.runInContext(outputText, context, { filename: sourceUrl.pathname });
  return {
    context, intervals, errors, loads, writes, storage, loadStarted,
    start: (tabId = 1, siteKey = 'chess.com') => context.startTimerForTab(tabId, siteKey),
    tick: () => context.activeTimer.intervalId.callback(),
    ticks: () => ticks,
    releaseNetwork: () => resolveNetwork(),
  };
}

test('duplicate focus events for the active site retain the same timer', async () => {
  const harness = createHarness();
  await harness.start();
  const original = harness.context.activeTimer;
  await harness.start();

  assert.equal(harness.context.activeTimer, original);
  assert.equal(original.intervalId.cleared, false);
  assert.equal(harness.intervals.length, 2, 'Only one timer interval and one sync interval are needed');
});

test('authoritative hydration retains seconds recorded while its request was pending', async () => {
  const harness = createHarness({
    network: 'stalled',
    remoteEntry: { siteTotals: { 'chess.com': 150, 'youtube.com': 20 } },
  });
  harness.storage.siteTimeData = { 'chess.com': { timeSpent: 100, timeLimit: 600 } };
  const hydration = harness.context.hydrateSharedUsageForCurrentDay();
  await harness.loadStarted;
  harness.storage.siteTimeData['chess.com'].timeSpent = 155;
  harness.releaseNetwork();
  await hydration;

  assert.deepEqual(harness.loads, [['test-user', '2026-11-25']]);
  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 155);
  assert.equal(harness.storage.siteTimeData['youtube.com'].timeSpent, 20);
  assert.equal(harness.errors.length, 0);
});

for (const [changed, applyChange] of [
  ['usage day', (storage) => { storage.currentUsageDayKey = '2026-11-26'; }],
  ['reset generation', (storage) => { storage.usageResetAppliedAt = 100; }],
  ['signed-in user', (storage) => { storage.user = { uid: 'different-user' }; }],
]) {
  test(`authoritative hydration discards a response after the ${changed} changes`, async () => {
    const harness = createHarness({ network: 'stalled', remoteEntry: { siteTotals: { 'chess.com': 200 } } });
    harness.storage.siteTimeData = { 'chess.com': { timeSpent: 25, timeLimit: 600 } };
    const hydration = harness.context.hydrateSharedUsageForCurrentDay();
    await harness.loadStarted;
    applyChange(harness.storage);
    harness.releaseNetwork();
    await hydration;

    assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 25);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.errors.length, 0);
  });
}

test('an absent authoritative history does not overwrite local counters', async () => {
  const harness = createHarness({ network: 'stalled' });
  harness.storage.siteTimeData = { 'chess.com': { timeSpent: 25, timeLimit: 600 } };
  const hydration = harness.context.hydrateSharedUsageForCurrentDay();
  await harness.loadStarted;
  harness.releaseNetwork();
  await hydration;

  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 25);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.errors.length, 0);
});

test('offline shared usage hydration still starts local counting', async () => {
  const harness = createHarness();
  await harness.start();

  assert.equal(harness.context.activeTimer.siteKey, 'chess.com');
  harness.tick();
  assert.equal(harness.ticks(), 1);
  assert.equal(harness.errors.length, 1, 'The offline refresh failure is recorded');
});

test('a stalled network refresh does not delay local timer startup', { timeout: 1000 }, async () => {
  const harness = createHarness({ network: 'stalled' });
  try {
    await harness.start();
    assert.equal(harness.context.activeTimer.siteKey, 'chess.com');
    harness.tick();
    assert.equal(harness.ticks(), 1);
  } finally {
    harness.releaseNetwork();
    await harness.context.usageHydrationPromise;
  }
});

test('switching sites replaces the old timer and leaves one timer running', async () => {
  const harness = createHarness();
  await harness.start();
  const originalInterval = harness.context.activeTimer.intervalId;
  await harness.start(2, 'youtube.com');

  assert.equal(originalInterval.cleared, true);
  assert.equal(harness.context.activeTimer.siteKey, 'youtube.com');
  assert.equal(harness.intervals.filter((interval) => interval.milliseconds === 1000 && !interval.cleared).length, 1);
});

function extractFunction(name) {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} must exist`);
  return ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

test('overlapping remote reset checks preserve seconds recorded after the first clear', async () => {
  const storage = { user: { uid: 'test-user' }, usageResetAppliedAt: 0, timeSpent: 0 };
  const responses = [];
  const errors = [];
  let resolveBothStarted;
  const bothStarted = new Promise((resolve) => { resolveBothStarted = resolve; });
  let clears = 0;
  let stops = 0;
  const context = vm.createContext({
    lastUsageResetCheckAt: 0,
    USAGE_RESET_CHECK_INTERVAL_MS: 10_000,
    console: { log() {}, error: (...args) => errors.push(args) },
    db: {},
    doc: () => ({}),
    chrome: { storage: { local: { get: async () => structuredClone(storage) } } },
    getDoc: () => new Promise((resolve) => {
      responses.push(resolve);
      if (responses.length === 2) resolveBothStarted();
    }),
    withUsageStorageLock: (operation) => operation(),
    stopCurrentTimer: () => { stops += 1; },
    clearAllUsageFromLocalStorage: async (appliedAt) => {
      storage.usageResetAppliedAt = appliedAt;
      storage.timeSpent = 0;
      clears += 1;
    },
  });
  vm.runInContext(extractFunction('checkAndApplyRemoteUsageReset'), context, { filename: sourceUrl.pathname });
  const first = context.checkAndApplyRemoteUsageReset(true);
  const second = context.checkAndApplyRemoteUsageReset(true);
  await bothStarted;
  const snapshot = { exists: () => true, data: () => ({ usageResetRequestedAt: 100 }) };
  responses[0](snapshot);
  await first;
  storage.timeSpent = 5;
  responses[1](snapshot);
  await second;

  assert.deepEqual(errors, []);
  assert.equal(clears, 1);
  assert.equal(stops, 1);
  assert.equal(storage.timeSpent, 5);
});

function createRecoveryHarness(focused, { missingReceiver = false, url = 'https://chess.com/play/online' } = {}) {
  const starts = [];
  let tabQueries = 0;
  const context = vm.createContext({
    activeTimer: null,
    console: { log() {} },
    URL,
    normalizeHostname: (hostname) => hostname,
    chrome: {
      windows: { getLastFocused: async () => ({ focused }) },
      tabs: {
        query: async () => { tabQueries += 1; return [{ id: 1, url }]; },
        sendMessage: async () => {
          if (missingReceiver) throw new Error('Could not establish connection. Receiving end does not exist.');
          return { siteKey: 'chess.com', hasSiteRule: true, url: 'https://chess.com/' };
        },
      },
    },
    startTimerForTab: async (...args) => { starts.push(args); },
  });
  vm.runInContext(extractFunction('recoverActiveTimer'), context, { filename: sourceUrl.pathname });
  return { starts, queries: () => tabQueries, recover: () => context.recoverActiveTimer() };
}

test('alarm recovery does not count a Chrome window while another app has focus', async () => {
  const harness = createRecoveryHarness(false);
  await harness.recover();
  assert.equal(harness.queries(), 0);
  assert.equal(harness.starts.length, 0);
});

test('alarm recovery resumes the tracked tab in the focused Chrome window', async () => {
  const harness = createRecoveryHarness(true);
  await harness.recover();
  assert.equal(harness.queries(), 1);
  assert.equal(harness.starts.length, 1);
  assert.equal(harness.starts[0][0], 1);
  assert.equal(harness.starts[0][1], 'chess.com');
});

test('alarm recovery uses the tab URL when an extension reload invalidates the content script', async () => {
  const url = 'https://chess.com/play/online';
  const harness = createRecoveryHarness(true, { missingReceiver: true, url });
  await harness.recover();

  assert.equal(harness.starts.length, 1);
  assert.equal(harness.starts[0][0], 1);
  assert.equal(harness.starts[0][1], 'chess.com');
  assert.equal(harness.starts[0][2].url, url);
});

test('alarm recovery skips internal Chrome tabs without a content script', async () => {
  const harness = createRecoveryHarness(true, { missingReceiver: true, url: 'chrome://extensions/' });
  await harness.recover();
  assert.equal(harness.starts.length, 0);
});
