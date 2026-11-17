import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the worker's real sync code without starting Chrome event listeners
// or connecting to Firebase.
const sourceUrl = new URL('../src/scripts/background.ts', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true);
const syncDeclarations = new Set([
  'normalizeSiteTotals',
  'createDailyUsageHistoryEntry',
  'getInstallationUsageTotals',
  'addSiteTotals',
  'syncToFirestore',
  'syncToFirestoreInternal',
]);
const declarations = ast.statements.filter((node) => {
  if (ts.isFunctionDeclaration(node)) return syncDeclarations.delete(node.name?.text);
  if (!ts.isVariableStatement(node)) return false;
  return node.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && syncDeclarations.delete(declaration.name.text)
  );
});
assert.equal(syncDeclarations.size, 0, 'All worker sync declarations must exist');
const { outputText } = ts.transpileModule(
  `let usageSyncPromise = null;\n${declarations.map((node) => node.getText(ast)).join('\n')}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
);

const site = 'example.com';
const dayKey = '2026-11-17';
const installationId = 'test-installation';

function createHarness({ localTotal, remoteEntry, contribution, pendingSeconds = 5 }) {
  const storage = {
    user: { uid: 'test-user', email: 'test@example.com' },
    siteTimeData: { [site]: { timeSpent: localTotal, timeLimit: 300 } },
    ...(contribution ? { usageContributionState: structuredClone(contribution) } : {}),
  };
  const remote = { dailyUsageHistory: remoteEntry ? { [dayKey]: structuredClone(remoteEntry) } : {} };
  const errors = [];
  let failNextTransaction = false;
  const context = vm.createContext({
    activeTimer: { siteKey: site },
    secondsCounter: pendingSeconds,
    USAGE_CONTRIBUTION_STATE_KEY: 'usageContributionState',
    console: { log() {}, error: (...args) => errors.push(args) },
    chrome: {
      storage: {
        local: {
          get: async (keys) => Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => key in storage)
              .map((key) => [key, structuredClone(storage[key])])
          ),
          set: async (values) => Object.assign(storage, structuredClone(values)),
        },
      },
    },
    db: {},
    doc: () => ({}),
    ensureCurrentUsageDayState: async () => {},
    getResetSchedule: async () => ({ resetHour: 0, resetMinute: 0 }),
    getMostRecentResetBoundary: () => 0,
    getCurrentUsageDayKey: () => dayKey,
    getUsageInstallationId: async () => installationId,
    runTransaction: async (_db, callback) => {
      if (failNextTransaction) {
        failNextTransaction = false;
        throw new Error('Simulated unavailable Firestore');
      }
      let pendingWrite;
      const result = await callback({
        get: async () => ({ data: () => structuredClone(remote) }),
        set: (_ref, values) => { pendingWrite = structuredClone(values); },
      });
      Object.assign(remote.dailyUsageHistory, pendingWrite.dailyUsageHistory);
      return result;
    },
  });
  vm.runInContext(outputText, context, { filename: sourceUrl.pathname });
  return {
    context,
    storage,
    remote,
    errors,
    failNext: () => { failNextTransaction = true; },
    sync: () => context.syncToFirestore(),
    entry: () => remote.dailyUsageHistory[dayKey],
  };
}

test('a fresh install counts its first batch once', async () => {
  const harness = createHarness({ localTotal: 5 });
  await harness.sync();
  assert.equal(harness.entry().siteTotals[site], 5);
  assert.equal(harness.storage.usageContributionState.siteTotals[site], 5);
  assert.equal(harness.context.secondsCounter, 0);
});

test('migration preserves legacy totals and counts only the local delta', async () => {
  const harness = createHarness({ localTotal: 105, remoteEntry: { siteTotals: { [site]: 100 } } });
  harness.storage.siteTimeData['other.example'] = { timeSpent: 25, timeLimit: 300 };
  harness.remote.dailyUsageHistory[dayKey].siteTotals['other.example'] = 20;
  await harness.sync();
  assert.deepEqual(harness.entry().siteTotals, { [site]: 105, 'other.example': 25 });
  assert.deepEqual(harness.entry().legacySiteTotals, { [site]: 100, 'other.example': 20 });
  assert.deepEqual(harness.storage.usageContributionState.siteTotals, { [site]: 5, 'other.example': 5 });
});

test('an unseeded install recovers its existing contribution', async () => {
  const harness = createHarness({
    localTotal: 155,
    remoteEntry: {
      usageFormatVersion: 2,
      legacySiteTotals: { [site]: 100 },
      installationUsage: { [installationId]: { siteTotals: { [site]: 50 }, updatedAt: 0 } },
      siteTotals: { [site]: 150 },
    },
  });
  await harness.sync();
  assert.equal(harness.entry().siteTotals[site], 155);
  assert.equal(harness.storage.usageContributionState.siteTotals[site], 55);
});

test('a seeded followup adds its next batch once', async () => {
  const harness = createHarness({
    localTotal: 110,
    contribution: { dayKey, siteTotals: { [site]: 5 }, seeded: true },
    remoteEntry: {
      usageFormatVersion: 2,
      legacySiteTotals: { [site]: 100 },
      installationUsage: { [installationId]: { siteTotals: { [site]: 5 }, updatedAt: 0 } },
      siteTotals: { [site]: 105 },
    },
  });
  await harness.sync();
  assert.equal(harness.entry().siteTotals[site], 110);
  assert.equal(harness.storage.usageContributionState.siteTotals[site], 10);
});

test('a failed transaction retains the batch for one successful retry', async () => {
  const harness = createHarness({ localTotal: 105, remoteEntry: { siteTotals: { [site]: 100 } } });
  harness.failNext();
  await harness.sync();
  assert.equal(harness.context.secondsCounter, 5);
  assert.equal(harness.entry().siteTotals[site], 100);
  assert.equal(harness.storage.usageContributionState, undefined);
  assert.equal(harness.errors.length, 1);
  await harness.sync();
  assert.equal(harness.entry().siteTotals[site], 105);
  assert.equal(harness.context.secondsCounter, 0);
});

test('overlapping sync requests share one batch', async () => {
  const harness = createHarness({ localTotal: 105, remoteEntry: { siteTotals: { [site]: 100 } } });
  const first = harness.sync();
  const second = harness.sync();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(harness.entry().siteTotals[site], 105);
  assert.equal(harness.context.secondsCounter, 0);
});
