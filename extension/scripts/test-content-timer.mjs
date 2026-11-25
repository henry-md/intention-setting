import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const sourceUrl = new URL('../src/scripts/content.ts', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const ast = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((item) =>
    ts.isIdentifier(item.name) && item.name.text === 'startTimeTracking'
  )
);
assert.ok(declaration, 'The content script timer entry point must exist');
const { outputText } = ts.transpileModule(
  `${declaration.getText(ast)}\nglobalThis.start = startTimeTracking;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
);

function createHarness({ siteTimeData = {}, hidden = false, invalidContext = false } = {}) {
  const storage = { siteTimeData: structuredClone(siteTimeData) };
  const messages = [];
  const writes = [];
  const displays = [];
  let resolveRead;
  const readStarted = new Promise((resolve) => { resolveRead = resolve; });
  let resumeRead;
  const readGate = new Promise((resolve) => { resumeRead = resolve; });
  const context = vm.createContext({
    currentSiteKey: null,
    getCurrentSiteKey: () => 'chess.com',
    safeStorageGet: async () => {
      const snapshot = invalidContext ? null : structuredClone(storage);
      resolveRead();
      await readGate;
      return snapshot;
    },
    safeStorageSet: async (values) => {
      writes.push(structuredClone(values));
      Object.assign(storage, structuredClone(values));
      return true;
    },
    showTimerBadge: async (...args) => { displays.push(args); },
    safeSendMessage: async (message) => { messages.push(structuredClone(message)); },
    document: { hidden },
    window: { location: { href: 'https://www.chess.com/play/online' } },
  });
  vm.runInContext(outputText, context, { filename: sourceUrl.pathname });
  return { storage, messages, writes, displays, readStarted, resumeRead, start: () => context.start(600) };
}

test('a stale tab initialization preserves newer seconds and other sites', async () => {
  const harness = createHarness({
    siteTimeData: { 'chess.com': { timeSpent: 100, timeLimit: 600, lastUpdated: 0 } },
  });
  const initialization = harness.start();
  await harness.readStarted;
  harness.storage.siteTimeData['chess.com'].timeSpent = 101;
  harness.storage.siteTimeData['youtube.com'] = { timeSpent: 20, timeLimit: 300, lastUpdated: 1 };
  harness.resumeRead();
  await initialization;

  assert.equal(harness.storage.siteTimeData['chess.com'].timeSpent, 101);
  assert.equal(harness.storage.siteTimeData['youtube.com'].timeSpent, 20);
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.messages, [{
    action: 'tab-focused', siteKey: 'chess.com', url: 'https://www.chess.com/play/online',
  }]);
});

test('a first visit delegates counter initialization to the background', async () => {
  const harness = createHarness();
  const initialization = harness.start();
  harness.resumeRead();
  await initialization;

  assert.deepEqual(harness.storage.siteTimeData, {});
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.messages[0].action, 'tab-focused');
  assert.deepEqual(harness.displays, [[0, 600]]);
});

test('a hidden tab reads the badge without writing counters or starting a timer', async () => {
  const harness = createHarness({ hidden: true });
  const initialization = harness.start();
  harness.resumeRead();
  await initialization;

  assert.equal(harness.writes.length, 0);
  assert.equal(harness.messages.length, 0);
});

test('an invalidated extension context stops initialization', async () => {
  const harness = createHarness({ invalidContext: true });
  const initialization = harness.start();
  harness.resumeRead();
  await initialization;

  assert.equal(harness.writes.length, 0);
  assert.equal(harness.messages.length, 0);
  assert.equal(harness.displays.length, 0);
});

const renderDeclarations = ast.statements.filter((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((item) =>
    ts.isIdentifier(item.name) && ['renderContainerGeneration', 'renderContainer'].includes(item.name.text)
  )
);
const renderCode = ts.transpileModule(
  `${renderDeclarations.map((node) => node.getText(ast)).join('\n')}\nglobalThis.render = renderContainer;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
).outputText;

test('a delayed badge render cannot replace a newer counter', async () => {
  const displays = [];
  const overlays = [];
  let total = 100;
  let resolveFirstRead;
  const firstRead = new Promise((resolve) => { resolveFirstRead = resolve; });
  let resumeFirstRead;
  const firstReadGate = new Promise((resolve) => { resumeFirstRead = resolve; });
  let reads = 0;
  const context = vm.createContext({
    document: { getElementById: () => ({}) },
    containerRoot: { render: (view) => displays.push(view.children[0].props.relevantLimit.timeSpent) },
    getDebugInfo: async () => ({
      normalizedHostname: 'chess.com',
      applicableLimits: [{ ruleType: 'hard', timeSpent: total, timeLimit: 600 }],
    }),
    safeStorageGet: async () => {
      reads += 1;
      if (reads === 1) {
        resolveFirstRead();
        await firstReadGate;
      }
      return { upcomingLimitReminderSeconds: 5 };
    },
    clampReminderSeconds: (value) => value,
    setNearLimitOverlayVisible: (visible) => overlays.push(visible),
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }) },
    TimerBadge: 'timer',
    DEBUG_UI: false,
    showTutorialBadgeSpotlightIfNeeded: async () => {},
  });
  vm.runInContext(renderCode, context, { filename: sourceUrl.pathname });
  const olderRender = context.render(100, 600);
  await firstRead;
  total = 101;
  await context.render(101, 600);
  assert.deepEqual(displays, [101]);
  resumeFirstRead();
  await olderRender;

  assert.deepEqual(displays, [101], 'The older async render must not decrease the badge');
  assert.equal(overlays.length, 1, 'The older async render must not change the warning overlay');
});
