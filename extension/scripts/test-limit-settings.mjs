import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const sourceUrl = new URL('../src/utils/saveUserSettings.ts', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(sourceUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const uid = 'settings-user';
const token = 'test-firebase-id-token';
const rule = (timeLimit = 30, extra = {}) => ({
  id: 'rule:chess', type: 'hard', targets: [{ type: 'url', id: 'chess.com' }],
  timeLimit, createdAt: '2026-11-25T16:00:00.000Z', ...extra,
});

function createHarness({ status = 200, tokenError, fetchError, errorBody } = {}) {
  const requests = [], users = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, AbortSignal, URLSearchParams,
    require: (name) => {
      if (name === './firebase') return { firebaseConfig: { projectId: 'settings-test-project' }, auth: { currentUser: null } };
      if (name === './firebaseIdToken') return { getFirebaseIdToken: async (expectedUserId) => {
        users.push(expectedUserId);
        if (tokenError) throw tokenError;
        assert.equal(expectedUserId, uid);
        return token;
      } };
      throw new Error(`Unexpected settings dependency: ${name}`);
    },
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), ...options, data: JSON.parse(options.body) });
      if (fetchError) throw fetchError;
      return { ok: status >= 200 && status < 300, status, json: async () => errorBody ?? {} };
    },
  }, { filename: sourceUrl.pathname });
  return { requests, users, save: (patch, userId = uid) => exports.saveUserSettings(userId, patch) };
}

test('a limit can decrease from 60 to 30 using the verified user token without SDK auth', async () => {
  const harness = createHarness();
  const original = rule(60);
  await harness.save({ rules: [{ ...original, timeLimit: 30 }] });
  assert.deepEqual(harness.users, [uid]);
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0];
  assert.equal(request.method, 'PATCH');
  assert.equal(request.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.url.origin, 'https://firestore.googleapis.com');
  assert.equal(request.url.pathname, `/v1/projects/settings-test-project/databases/(default)/documents/users/${uid}`);
  assert.deepEqual(request.url.searchParams.getAll('updateMask.fieldPaths'), ['rules']);
  assert.deepEqual(Object.keys(request.data.fields), ['rules']);
  assert.equal(request.data.fields.rules.arrayValue.values[0].mapValue.fields.timeLimit.integerValue, '30');
  assert.equal(original.timeLimit, 60, 'Saving must not mutate the caller\'s previous rule');
  assert.equal(request.signal.aborted, false);
});

test('configuration updates contain only their supplied fields and never usage counters', async () => {
  const harness = createHarness();
  await harness.save({ rules: [rule()], groups: [], conversationHistory: [{ role: 'user', content: 'Shorter limit' }] });
  const request = harness.requests[0];
  const expected = ['rules', 'groups', 'conversationHistory'];
  assert.deepEqual(request.url.searchParams.getAll('updateMask.fieldPaths'), expected);
  assert.deepEqual(Object.keys(request.data.fields), expected);
  for (const key of ['dailyUsageHistory', 'usageCountersVersion', 'usageResetRequestedAt', 'usageResetAppliedAt', 'siteTimeData', 'seconds']) {
    assert.equal(request.body.includes(`"${key}"`), false, `${key} must not be in a configuration write`);
  }
});

test('unnamed rule edits omit optional undefined fields without changing their limit', async () => {
  const harness = createHarness();
  const patch = { rules: [rule(5, { name: undefined, plusOnes: undefined, schedule: undefined })] };
  await harness.save(patch);
  const fields = harness.requests[0].data.fields.rules.arrayValue.values[0].mapValue.fields;
  assert.equal(fields.timeLimit.integerValue, '5');
  assert.equal('name' in fields, false);
  assert.equal('plusOnes' in fields, false);
  assert.equal('schedule' in fields, false);
  assert.equal('name' in patch.rules[0], true, 'Serialization must not delete caller fields');
});

test('nested configuration scalars, arrays, empty values, and fractional minutes retain their types', async () => {
  const harness = createHarness();
  await harness.save({ conversationHistory: [{ text: '', enabled: false, optional: null, number: 0.5, nested: { items: [] } }] });
  const fields = harness.requests[0].data.fields.conversationHistory.arrayValue.values[0].mapValue.fields;
  assert.deepEqual(fields.text, { stringValue: '' });
  assert.deepEqual(fields.enabled, { booleanValue: false });
  assert.deepEqual(fields.optional, { nullValue: null });
  assert.deepEqual(fields.number, { doubleValue: 0.5 });
  assert.deepEqual(fields.nested, { mapValue: { fields: { items: { arrayValue: { values: [] } } } } });
});

test('empty, malformed, or counter-bearing patches fail before token lookup or network access', async () => {
  for (const patch of [null, [], {}, { rules: undefined }, { rules: null }, { rules: {} },
    { dailyUsageHistory: {} }, { usageCountersVersion: 0 }, { rules: [], usageResetRequestedAt: 1 }]) {
    const harness = createHarness();
    await assert.rejects(harness.save(patch));
    assert.deepEqual(harness.users, []);
    assert.deepEqual(harness.requests, []);
  }
});

test('invalid nested values and circular objects fail before token lookup or network access', async () => {
  const circular = {}; circular.self = circular;
  class Unsupported { constructor() { this.value = 1; } }
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, undefined,
    1n, Symbol('test'), () => {}, new Date(), new Map(), new Set(), new Unsupported(), circular]) {
    const harness = createHarness();
    await assert.rejects(harness.save({ conversationHistory: [value] }));
    assert.deepEqual(harness.users, []);
    assert.deepEqual(harness.requests, []);
  }
  const harness = createHarness();
  await assert.rejects(harness.save({ conversationHistory: Array(1) }));
  assert.deepEqual(harness.requests, []);
});

test('invalid user identities fail before requesting a token or writing data', async () => {
  for (const userId of ['', 'other/user', 'a'.repeat(129), '\u0000']) {
    const harness = createHarness();
    await assert.rejects(harness.save({ rules: [] }, userId));
    assert.deepEqual(harness.users, []);
    assert.deepEqual(harness.requests, []);
  }
});

test('token refresh or user mismatch failures cannot report a saved limit', async () => {
  const failure = new Error('Stored user did not match the expected user');
  const harness = createHarness({ tokenError: failure });
  await assert.rejects(harness.save({ rules: [rule(10)] }), failure);
  assert.deepEqual(harness.users, [uid]);
  assert.deepEqual(harness.requests, []);
});

test('HTTP failures reject instead of acknowledging a saved limit', async () => {
  for (const status of [401, 403, 500]) {
    const harness = createHarness({ status });
    await assert.rejects(harness.save({ rules: [rule(10)] }), new RegExp(`\\(${status}\\)`));
    assert.equal(harness.requests.length, 1);
  }
  const harness = createHarness({ status: 403, errorBody: { error: { message: 'Owner authentication required' } } });
  await assert.rejects(harness.save({ rules: [rule(10)] }), /Owner authentication required/);
});

test('network and timeout failures reject instead of acknowledging a saved limit', async () => {
  for (const failure of [new Error('Network unavailable'), new DOMException('Request timed out', 'TimeoutError')]) {
    const harness = createHarness({ fetchError: failure });
    await assert.rejects(harness.save({ rules: [rule(10)] }), failure);
    assert.equal(harness.requests.length, 1);
  }
});
