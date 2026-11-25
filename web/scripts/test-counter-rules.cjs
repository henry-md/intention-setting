'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Compile and evaluate rules through the Rules API without releasing them or
// writing documents. Each test supplies its resource; the rules do no lookups.
const projectId = process.env.FIREBASE_PROJECT_ID || 'intention-setter';
const cliRoot = process.env.FIREBASE_TOOLS_ROOT || '/opt/homebrew/lib/node_modules/firebase-tools';
const firebaseAuth = require(path.join(cliRoot, 'lib/auth.js'));
const owner = 'counter-rules-test-owner';
const counterPath = `/databases/(default)/documents/usageCounters/${owner}/days/2026-11-25/values/test-total`;
const counter = { seconds: 100, kind: 'total', siteKey: '', installationId: '' };

function makeCase(label, expectation, {
  method = 'update', next = counter, before = counter, uid = owner, documentPath = counterPath,
} = {}) {
  const request = {
    method,
    path: documentPath,
    auth: uid ? { uid, token: {} } : null,
  };
  if (next !== null) request.resource = { data: next, name: documentPath };
  const testCase = { expectation, request, pathEncoding: 'PLAIN' };
  if (before !== null) testCase.resource = { data: before, name: documentPath };
  return { label, testCase };
}

function testCases(strict) {
  const cases = [
    makeCase('owner can create a counter', 'ALLOW', { method: 'create', before: null, next: { ...counter, seconds: 0 } }),
    makeCase('owner can retain the same number', 'ALLOW'),
    makeCase('owner can increase the number', 'ALLOW', { next: { ...counter, seconds: 101 } }),
    makeCase('owner can write the maximum safe integer', 'ALLOW', { next: { ...counter, seconds: Number.MAX_SAFE_INTEGER } }),
    makeCase('a smaller number is rejected', 'DENY', { next: { ...counter, seconds: 99 } }),
    makeCase('a zero replacement is rejected', 'DENY', { next: { ...counter, seconds: 0 } }),
    makeCase('an empty replacement is rejected', 'DENY', { next: {} }),
    makeCase('removing seconds is rejected', 'DENY', { next: { kind: 'total', siteKey: '', installationId: '' } }),
    makeCase('negative seconds are rejected', 'DENY', { method: 'create', before: null, next: { ...counter, seconds: -1 } }),
    makeCase('fractional seconds are rejected', 'DENY', { next: { ...counter, seconds: 100.5 } }),
    makeCase('string seconds are rejected', 'DENY', { next: { ...counter, seconds: '101' } }),
    makeCase('unsafe integers are rejected', 'DENY', { next: { ...counter, seconds: Number.MAX_SAFE_INTEGER + 1 } }),
    makeCase('extra fields are rejected', 'DENY', { next: { ...counter, seconds: 101, reset: true } }),
    makeCase('changing kind is rejected', 'DENY', { next: { ...counter, seconds: 101, kind: 'site' } }),
    makeCase('changing site is rejected', 'DENY', { next: { ...counter, seconds: 101, siteKey: 'other.example' } }),
    makeCase('changing installation is rejected', 'DENY', { next: { ...counter, seconds: 101, installationId: 'other-installation' } }),
    makeCase('invalid kinds are rejected', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'reset' } }),
    makeCase('total counters cannot name a site', 'DENY', { method: 'create', before: null, next: { ...counter, siteKey: 'example.invalid' } }),
    makeCase('total counters cannot name an installation', 'DENY', { method: 'create', before: null, next: { ...counter, installationId: 'test-installation' } }),
    makeCase('site counters require a site identity', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'site' } }),
    makeCase('legacy counters require a site identity', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'legacy' } }),
    makeCase('site counters cannot name an installation', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'site', siteKey: 'example.invalid', installationId: 'test-installation' } }),
    makeCase('installation counters require an installation identity', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'installation', siteKey: 'example.invalid' } }),
    makeCase('installation counters require a site identity', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'installation', installationId: 'test-installation' } }),
    makeCase('oversized site identities are rejected', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'site', siteKey: 'a'.repeat(254) } }),
    makeCase('oversized installation identities are rejected', 'DENY', { method: 'create', before: null, next: { ...counter, kind: 'installation', siteKey: 'example.invalid', installationId: 'a'.repeat(129) } }),
    makeCase('non-string site identity is rejected', 'DENY', { method: 'create', before: null, next: { ...counter, siteKey: 1 } }),
    makeCase('non-string installation identity is rejected', 'DENY', { method: 'create', before: null, next: { ...counter, installationId: 1 } }),
    makeCase('deleting a counter is rejected', 'DENY', { method: 'delete', next: null }),
    makeCase('another user cannot update a counter', 'DENY', { uid: 'other-user', next: { ...counter, seconds: 101 } }),
    makeCase('anonymous writes are rejected', 'DENY', { uid: null, next: { ...counter, seconds: 101 } }),
    makeCase('owner can read a counter', 'ALLOW', { method: 'get', next: null }),
    makeCase('another user cannot read a counter', 'DENY', { method: 'get', uid: 'other-user', next: null }),
    makeCase('anonymous reads are rejected', 'DENY', { method: 'get', uid: null, next: null }),
    makeCase('counter owner cannot write the namespace root', 'DENY', { method: 'create', before: null, documentPath: `/databases/(default)/documents/usageCounters/${owner}` }),
    makeCase('counter owner cannot write a day wrapper', 'DENY', { method: 'create', before: null, documentPath: `/databases/(default)/documents/usageCounters/${owner}/days/2026-11-25` }),
    makeCase('counter owner cannot write nested documents', 'DENY', { method: 'create', before: null, documentPath: `${counterPath}/extra/nested` }),
    makeCase('counter owner cannot create the wrong path', 'DENY', { method: 'create', before: null, documentPath: `/databases/(default)/documents/usageCounters/${owner}/other/test` }),
    makeCase('legacy clients retain profile updates', 'ALLOW', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { email: 'before@example.invalid' }, next: { email: 'after@example.invalid' } }),
    makeCase('unrelated collections retain current access', 'ALLOW', { uid: null, documentPath: '/databases/(default)/documents/products/test', before: {}, next: { name: 'test' } }),
    makeCase('legacy usage writes follow the selected rollout mode', strict ? 'DENY' : 'ALLOW', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { dailyUsageHistory: { test: 100 } }, next: { dailyUsageHistory: { test: 0 } } }),
    makeCase('migrated root usage cannot be lowered directly', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1, dailyUsageHistory: { test: 100 } }, next: { usageCountersVersion: 1, dailyUsageHistory: { test: 0 } } }),
    makeCase('migrated root usage cannot be removed', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1, dailyUsageHistory: { test: 100 } }, next: { usageCountersVersion: 1 } }),
    makeCase('migrated root reset requests cannot be changed directly', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1 }, next: { usageCountersVersion: 1, usageResetRequestedAt: 1 } }),
    makeCase('migrated root reset acknowledgements cannot be changed directly', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1 }, next: { usageCountersVersion: 1, usageResetAppliedAt: 1 } }),
    makeCase('the migration marker cannot be removed', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1 }, next: {} }),
    makeCase('the migration marker cannot be downgraded', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1 }, next: { usageCountersVersion: 0 } }),
    makeCase('the migration marker cannot be supplied at creation', 'DENY', { method: 'create', before: null, documentPath: `/databases/(default)/documents/users/${owner}`, next: { usageCountersVersion: 1 } }),
    makeCase('the migration marker cannot be added by a client', 'DENY', { documentPath: `/databases/(default)/documents/users/${owner}`, before: {}, next: { usageCountersVersion: 1 } }),
    makeCase('migrated root documents cannot be deleted', 'DENY', { method: 'delete', next: null, documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1 } }),
    makeCase('unmigrated root deletion follows the rollout mode', strict ? 'DENY' : 'ALLOW', { method: 'delete', next: null, documentPath: `/databases/(default)/documents/users/${owner}`, before: {} }),
    makeCase('migrated owners retain profile updates', 'ALLOW', { documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1, email: 'before@example.invalid' }, next: { usageCountersVersion: 1, email: 'after@example.invalid' } }),
    makeCase('anonymous users cannot modify migrated root profiles', 'DENY', { uid: null, documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1, email: 'before@example.invalid' }, next: { usageCountersVersion: 1, email: 'after@example.invalid' } }),
    makeCase('other users cannot modify migrated root profiles', 'DENY', { uid: 'other-user', documentPath: `/databases/(default)/documents/users/${owner}`, before: { usageCountersVersion: 1, email: 'before@example.invalid' }, next: { usageCountersVersion: 1, email: 'after@example.invalid' } }),
    makeCase('unmigrated anonymous root updates follow the rollout mode', strict ? 'DENY' : 'ALLOW', { uid: null, documentPath: `/databases/(default)/documents/users/${owner}`, before: { email: 'before@example.invalid' }, next: { email: 'after@example.invalid' } }),
    makeCase('user subcollections retain existing permissions', 'ALLOW', { uid: null, documentPath: `/databases/(default)/documents/users/${owner}/example/test`, before: {}, next: { example: true } }),
  ];
  for (const kind of ['legacy', 'installation', 'site', 'total']) {
    const siteKey = kind === 'total' ? '' : 'example.invalid';
    const installationId = kind === 'installation' ? 'test-installation' : '';
    cases.push(makeCase(`owner can create the ${kind} kind`, 'ALLOW', { method: 'create', before: null, next: { ...counter, kind, siteKey, installationId } }));
  }
  return cases;
}

async function verifyFile(filename, strict, accessToken) {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const cases = testCases(strict);
  const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}:test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] }, testSuite: { testCases: cases.map(({ testCase }) => testCase) } }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Rules API HTTP ${response.status}: ${result.error?.message || 'request failed'}`);
  const issues = (result.issues || []).filter(({ severity }) => severity === 'ERROR');
  assert.deepEqual(issues, [], `${filename} must compile`);
  assert.equal(result.testResults?.length, cases.length, `${filename} must run every case`);
  const failures = result.testResults.flatMap((testResult, index) => testResult.state === 'SUCCESS' ? [] : [{ label: cases[index].label, ...testResult }]);
  assert.deepEqual(failures, [], `${filename} must enforce counter invariants`);
  return { filename, tests: cases.length, passed: cases.length };
}

async function main() {
  const account = firebaseAuth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('A saved Firebase CLI sign-in is required.');
  const token = await firebaseAuth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const results = await Promise.all([
    verifyFile('firestore.rules', true, token.access_token),
    verifyFile('firestore-counter-rollout.rules', false, token.access_token),
  ]);
  for (const result of results) console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
