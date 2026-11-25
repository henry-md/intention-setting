import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const plain = value => JSON.parse(JSON.stringify(value));
const uid = 'rule-form-user';
const targets = [{ type: 'url', id: 'chess.com' }];
const originalRule = {
  id: 'rule:chess', type: 'hard', targets, timeLimit: 60,
  createdAt: '2026-11-25T12:00:00.000Z',
};
const formMarker = 'actual-rule-form-props';

function compile(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return { filename: url.pathname, code: ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText };
}

const scheduleExports = {};
const scheduleSource = compile('../src/utils/timeLimitSchedule.ts');
vm.runInNewContext(scheduleSource.code, { exports: scheduleExports }, { filename: scheduleSource.filename });

function tokenModule() {
  return new Proxy({ __esModule: true, default: 'unused-component' }, {
    get: (target, key) => key in target ? target[key] : String(key),
  });
}

// Execute the real TSX components. Only React's hook/render plumbing and their
// external services are doubled, so events call the production save handlers.
function renderer(relativePath, exportName, props, modules = {}) {
  const source = compile(relativePath);
  const hooks = [], errors = [];
  let cursor = 0, tree;
  const effects = [];
  const changed = (previous, next) => !previous || !next || previous.length !== next.length
    || previous.some((value, index) => !Object.is(value, next[index]));
  const react = {
    Fragment: 'fragment',
    createElement: (type, properties, ...children) => ({ type, props: properties || {}, children }),
    useState: (initial) => {
      const index = cursor++;
      hooks[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (value) => {
        hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;
      }];
    },
    useRef: (initial) => {
      const index = cursor++;
      hooks[index] ||= { current: initial };
      return hooks[index];
    },
    useCallback: (callback, dependencies) => {
      const index = cursor++;
      if (!hooks[index] || changed(hooks[index].dependencies, dependencies)) {
        hooks[index] = { value: callback, dependencies };
      }
      return hooks[index].value;
    },
    useEffect: (effect, dependencies) => {
      const index = cursor++;
      if (!hooks[index] || changed(hooks[index].dependencies, dependencies)) {
        hooks[index] = { dependencies };
        effects.push(effect);
      }
    },
  };
  const exports = {};
  const constants = { DEFAULT_PLUS_ONE_DURATION_SECONDS: 60, DEFAULT_SOFT_RULE_PLUS_ONES: 3, TUTORIAL_RULE_NAME: 'Social Media' };
  vm.runInNewContext(source.code, {
    exports,
    require: (name) => {
      if (name === 'react') return { ...react, default: react };
      if (name.endsWith('/timeLimitSchedule')) return scheduleExports;
      if (name.endsWith('/constants')) return constants;
      if (name.endsWith('/urlDisplay')) return {
        formatUrlForDisplay: value => value, getFaviconUrl: () => 'test-favicon', FAVICON_FALLBACK: 'test-fallback',
      };
      if (name in modules) return modules[name];
      return tokenModule();
    },
    console: { log() {}, error: (...args) => errors.push(args) },
    window: { addEventListener() {}, removeEventListener() {} },
    chrome: { storage: {
      local: { get: async () => ({ siteTimeData: { 'chess.com': { timeSpent: 150 } } }) },
      onChanged: { addListener() {}, removeListener() {} },
    } },
  }, { filename: source.filename });
  const component = exports[exportName];
  assert.equal(typeof component, 'function');
  const render = () => { cursor = 0; tree = component(props); return tree; };
  return {
    render, errors,
    tree: () => tree,
    async settle() {
      for (let pass = 0; pass < 8; pass += 1) {
        const current = effects.splice(0);
        for (const effect of current) effect();
        await new Promise(resolve => setImmediate(resolve));
        render();
        if (effects.length === 0) return;
      }
      throw new Error('Component effects did not settle');
    },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.children)];
}

function find(tree, predicate) {
  const result = nodes(tree).find(predicate);
  assert.ok(result, 'The expected visible control must exist');
  return result;
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return text(tree.children);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function editRules(save, initialRule = originalRule, sync) {
  const calls = [], syncs = [];
  const view = renderer('../src/pages/Rules.tsx', 'default', {
    user: { uid }, onNavigateToGroups() {}, onEditGroup() {},
  }, {
    'firebase/firestore/lite': {
      doc: (_db, collection, userId) => ({ collection, userId }),
      getDoc: async () => ({ exists: () => true, data: () => ({ rules: [initialRule], groups: [] }) }),
    },
    '../utils/firebase': { db: {} },
    '../components/RuleForm': { RuleForm: formMarker },
    '../utils/saveUserSettings': { saveUserSettings: async (userId, patch) => {
      calls.push({ userId, patch: plain(patch), rawPatch: patch });
      return save?.(userId, patch);
    } },
    '../utils/syncRulesToStorage': { syncRulesToStorage: async userId => {
      syncs.push(userId);
      return sync?.(userId);
    } },
  });
  view.render();
  await view.settle();
  find(view.tree(), node => node.type === 'div' && node.props.key === initialRule.id).props.onClick();
  view.render();
  return { view, calls, syncs, form: () => find(view.tree(), node => node.type === formMarker) };
}

function formView(onSave, extra = {}) {
  const view = renderer('../src/components/RuleForm.tsx', 'RuleForm', {
    ruleId: originalRule.id, initialTargetItems: targets, initialRuleType: 'hard', initialTimeLimit: 60,
    groups: [], onSave, onCancel() {}, ...extra,
  });
  view.render();
  return view;
}

function submitButton(view) {
  return find(view.tree(), node => node.type === 'button' && node.props['data-tutorial-target'] === 'save-rule-button');
}

function setLimit(view, value) {
  find(view.tree(), node => node.type === 'input' && node.props.type === 'number' && node.props.min === '1')
    .props.onChange({ target: { value: String(value) } });
  view.render();
}

function syncHarness({ readError, writeError } = {}) {
  const prior = {
    siteRules: { 'chess.com': { ruleType: 'hard', timeLimit: 3600, ruleId: originalRule.id } },
    siteRuleIds: { 'chess.com': [originalRule.id] },
    compiledRules: { [originalRule.id]: { ruleType: 'hard', timeLimit: 3600, siteKeys: ['chess.com'] } },
    ruleUsageData: { [originalRule.id]: { timeSpent: 150, lastUpdated: 123456789 } },
    siteTimeData: { 'chess.com': { timeSpent: 150, lastUpdated: 123456789 } },
  };
  const local = plain(prior), writes = [], errors = [];
  const quietConsole = { log() {}, error: (...args) => errors.push(args), warn() {} };
  const load = (path, modules = {}, globals = {}) => {
    const source = compile(path), exports = {};
    vm.runInNewContext(source.code, {
      exports, URL, console: quietConsole, ...globals,
      require: name => {
        assert.ok(name in modules, `Unexpected utility dependency: ${name}`);
        return modules[name];
      },
    }, { filename: source.filename });
    return exports;
  };
  const utility = load('../src/utils/syncRulesToStorage.ts', {
    'firebase/firestore/lite': {
      doc: (_db, collection, userId) => ({ collection, userId }),
      getDoc: async ref => {
        assert.deepEqual(plain(ref), { collection: 'users', userId: uid });
        if (readError) throw readError;
        return { exists: () => true, data: () => ({ rules: [{ ...originalRule, timeLimit: 30 }], groups: [] }) };
      },
    },
    './firebase': { db: {} },
    './ruleHelpers': load('../src/utils/ruleHelpers.ts'),
    './urlNormalization': load('../src/utils/urlNormalization.ts'),
    './timeLimitSchedule': scheduleExports,
  }, {
    chrome: { storage: { local: {
      get: async keys => Object.fromEntries(keys.map(key => [key, plain(local[key])])),
      set: async patch => {
        writes.push(plain(patch));
        if (writeError) throw writeError;
        Object.assign(local, plain(patch));
      },
    } } },
  });
  return { prior, local, writes, errors, sync: () => utility.syncRulesToStorage(uid) };
}

test('the real Rules save handler lowers an unnamed rule from 60 to 30 using only the settings field', async () => {
  const gate = deferred();
  const harness = await editRules(() => gate.promise);
  const pending = harness.form().props.onSave('', targets, 'hard', 30);
  harness.view.render();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].userId, uid);
  assert.deepEqual(Object.keys(harness.calls[0].patch), ['rules']);
  assert.equal(harness.calls[0].patch.rules[0].timeLimit, 30);
  assert.equal('name' in harness.calls[0].rawPatch.rules[0], false);
  assert.equal(harness.form().props.initialTimeLimit, 60, 'Unconfirmed settings must not be published');
  assert.deepEqual(harness.syncs, []);
  gate.resolve();
  await pending;
  harness.view.render();
  assert.equal(nodes(harness.view.tree()).some(node => node.type === formMarker), false);
  assert.match(text(harness.view.tree()), /30 min/);
  assert.deepEqual(harness.syncs, [uid]);
  assert.equal(originalRule.timeLimit, 60);
});

test('a rejected Rules save retains the prior value and keeps the edit form open', async () => {
  const harness = await editRules(async () => { throw new Error('Permission denied'); });
  await assert.rejects(harness.form().props.onSave('', targets, 'hard', 30), /Permission denied/);
  harness.view.render();
  assert.equal(harness.form().props.initialTimeLimit, 60);
  assert.deepEqual(harness.syncs, []);
  assert.equal(harness.calls[0].patch.rules[0].timeLimit, 30);
});

test('remote rule edits and creations remain saved when best-effort local enforcement sync fails', async () => {
  for (const create of [false, true]) {
    const localSync = syncHarness({ readError: new Error('Local sync read unavailable') });
    const harness = await editRules(undefined, originalRule, localSync.sync);
    if (create) {
      harness.form().props.onCancel();
      harness.view.render();
      find(harness.view.tree(), node => node.type === 'button' && node.props.title === 'Create Rule').props.onClick();
      harness.view.render();
    }
    await harness.form().props.onSave('', targets, 'hard', 30);
    harness.view.render();
    assert.equal(harness.calls.length, 1);
    const savedRules = harness.calls[0].patch.rules;
    assert.equal(savedRules.length, create ? 2 : 1);
    assert.equal(savedRules.at(-1).timeLimit, 30);
    assert.deepEqual(harness.syncs, [uid]);
    assert.equal(nodes(harness.view.tree()).some(node => node.type === formMarker), false,
      'A committed save must close the form rather than invite a duplicate creation retry');
    assert.match(text(harness.view.tree()), /30 min/);
    assert.equal(localSync.errors.length, 1);
    assert.deepEqual(localSync.local, localSync.prior);
  }
});

test('the real enforcement sync logs a failed settings read and preserves local settings and counters', async () => {
  const harness = syncHarness({ readError: new Error('Settings read failed') });
  await harness.sync();
  assert.equal(harness.errors.length, 1);
  assert.match(String(harness.errors[0][1]), /Settings read failed/);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.local, harness.prior);
});

test('the real enforcement sync logs a failed Chrome write and preserves prior local settings', async () => {
  const harness = syncHarness({ writeError: new Error('Chrome storage failed') });
  await harness.sync();
  assert.equal(harness.errors.length, 1);
  assert.match(String(harness.errors[0][1]), /Chrome storage failed/);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].compiledRules[originalRule.id].timeLimit, 1800);
  assert.deepEqual(harness.local, harness.prior);
});

test('the real enforcement sync compiles a stricter limit without writing the tracked site counter', async () => {
  const harness = syncHarness();
  await harness.sync();
  assert.equal(harness.local.siteRules['chess.com'].timeLimit, 1800);
  assert.equal(harness.local.compiledRules[originalRule.id].timeLimit, 1800);
  assert.equal(harness.local.ruleUsageData[originalRule.id].timeSpent, 150);
  assert.equal(harness.local.ruleUsageData[originalRule.id].lastUpdated, 123456789);
  assert.deepEqual(harness.local.siteTimeData, harness.prior.siteTimeData);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(Object.keys(harness.writes[0]).sort(), ['compiledRules', 'ruleUsageData', 'siteRuleIds', 'siteRules']);
});

test('the real RuleForm shows a failed save and retries the same lower limit successfully', async () => {
  const calls = [];
  const view = formView(async (...args) => {
    calls.push(plain(args));
    if (calls.length === 1) throw new Error('Offline');
  });
  await view.settle();
  setLimit(view, 30);
  await submitButton(view).props.onClick();
  view.render();
  assert.match(text(find(view.tree(), node => node.props.role === 'alert')), /Could not save/);
  assert.equal(submitButton(view).props.disabled, false);
  assert.equal(calls[0][3], 30);
  await submitButton(view).props.onClick();
  view.render();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][3], 30);
  assert.equal(nodes(view.tree()).some(node => node.props.role === 'alert'), false);
});

test('duplicate clicks cannot submit twice while the real RuleForm waits for persistence', async () => {
  const gate = deferred();
  let writes = 0;
  const view = formView(async () => { writes += 1; await gate.promise; });
  await view.settle();
  setLimit(view, 30);
  const click = submitButton(view).props.onClick;
  const first = click();
  const duplicate = click();
  view.render();
  assert.equal(writes, 1);
  assert.equal(submitButton(view).props.disabled, true);
  assert.equal(text(submitButton(view)), 'Saving...');
  gate.resolve();
  await Promise.all([first, duplicate]);
  view.render();
  assert.equal(submitButton(view).props.disabled, false);
});

test('editing a soft limit preserves zero allowed extensions and saves a stricter base limit', async () => {
  const softRule = { ...originalRule, type: 'soft', plusOnes: 0, plusOneDuration: 60 };
  const harness = await editRules(undefined, softRule);
  assert.equal(harness.form().props.initialPlusOnes, 0, 'A saved zero must not fall back to the default allowance');
  const view = formView(harness.form().props.onSave, harness.form().props);
  await view.settle();
  setLimit(view, 30);
  await submitButton(view).props.onClick();
  assert.equal(harness.calls[0].patch.rules[0].timeLimit, 30);
  assert.equal(harness.calls[0].patch.rules[0].plusOnes, 0);
  assert.equal(harness.calls[0].patch.rules[0].plusOneDuration, 60);
  harness.view.render();
  assert.equal(nodes(harness.view.tree()).some(node => node.type === formMarker), false);
});

test('editing a time-window rule retains its zero numeric duration and actual schedule', async () => {
  const timeRule = { ...originalRule, type: 'time', timeLimit: 0,
    schedule: { days: ['mon'], startTime: '10:00', endTime: '18:00' } };
  const harness = await editRules(undefined, timeRule);
  assert.equal(harness.form().props.initialTimeLimit, 0);
  const view = formView(harness.form().props.onSave, harness.form().props);
  await view.settle();
  await submitButton(view).props.onClick();
  assert.equal(harness.calls[0].patch.rules[0].timeLimit, 0);
  assert.deepEqual(harness.calls[0].patch.rules[0].schedule, timeRule.schedule);
});

test('a failed rule deletion retains the rule and exposes the error in the open confirmation', async () => {
  const harness = await editRules(async () => { throw new Error('Permission denied'); });
  harness.form().props.onCancel();
  harness.view.render();
  find(harness.view.tree(), node => node.type === 'button' && node.props.title === 'Delete Rule')
    .props.onClick({ stopPropagation() {} });
  harness.view.render();
  find(harness.view.tree(), node => node.type === 'button' && text(node) === 'Delete')
    .props.onClick({ stopPropagation() {} });
  await harness.view.settle();
  assert.equal(find(harness.view.tree(), node => node.type === 'Dialog').props.open, true);
  assert.match(text(find(harness.view.tree(), node => node.props.role === 'alert')), /Could not delete/);
  assert.ok(find(harness.view.tree(), node => node.type === 'div' && node.props.key === originalRule.id));
  assert.deepEqual(harness.calls[0].patch.rules, []);
  assert.deepEqual(harness.syncs, []);
});
