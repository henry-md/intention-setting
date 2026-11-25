# Verifying that recorded time never decreases

The invariant applies to each fixed user, usage day, site, and installation. Once a permanent counter contains `seconds = N`, an application write cannot replace it with a value below N or delete the record. Starting a new usage day creates a different record; it does not clear yesterday's counter.

Firestore's atomic `maximum` transform enforces the numeric floor when each write commits. Rules independently reject lower assignments, empty replacement, identity changes, and deletion. The backend uses the verified caller token for permanent counter writes so those rules apply to it. Statistics in `users.dailyUsageHistory` remain recoverable from the permanent counters.

## Run the checks

Use Node.js 22, pnpm 9, Firebase CLI 14.9.0, and Java 21 or newer. Install dependencies from the repository root:

```sh
pnpm --dir extension install --frozen-lockfile
npm --prefix web/functions ci --no-audit --no-fund
```

Run the full suite:

```sh
npm --prefix web test
```

It runs extension regressions, backend failure and invariant tests, test sensitivity checks, and the real Firestore/Auth emulators. The emulator runner uses a `demo-` project, loopback addresses, temporary configuration and logs, and dynamically assigned ports. It needs no production credentials and shuts down its emulators afterward. It rejects production hosts and project IDs.

For the fast tests without starting Java or emulators:

```sh
npm --prefix web run test:timekeeping -- --unit-only
```

The `Timekeeping` GitHub Actions workflow runs the full suite, extension lint, and a production build on pushes to `main` and pull requests. It does not deploy functions or rules. An additional authenticated check, `npm --prefix web/functions run test:counter-rules`, evaluates both rules files through the Rules API without publishing them; it is optional and requires a saved Firebase CLI sign-in.

## Coverage and expected results

| Failure or boundary | What the test must preserve | Focused coverage |
| --- | --- | --- |
| Blur or tab switch while a tick awaits storage | The stale tick cannot reset the day or count on the replacement timer | `extension/scripts/test-timer-lifecycle.mjs` |
| Old content initialization or delayed badge render | Newer stored seconds and the newer display remain intact | `extension/scripts/test-content-timer.mjs` |
| Concurrent ticks behind a slow storage read | Each successful tick has matching visible time and a pending journal contribution | `extension/scripts/test-counter-interleavings.mjs` |
| Rejected tick or rollover storage write | The prior committed state remains available and the queue can retry | `extension/scripts/test-counter-interleavings.mjs` |
| Offline upload, worker restart, or lost acknowledgement | Pending time survives, retries count once, and sites remain distinct | `extension/scripts/test-usage-sync.mjs` and `test-counter-interleavings.mjs` |
| Overlapping 4 a.m. checks, skipped days, clock rollback, or DST | One rollover per usage day, the correct original boundary, and the previous day's journal | `extension/scripts/test-usage-day-reset.mjs` and `test-counter-interleavings.mjs` |
| Failed, stale, or wrong-user/day refresh | Local counters retain their recorded floor; an unrelated response is discarded | `extension/scripts/test-timer-startup.mjs` |
| Duplicate, sparse, or reordered uploads from several installations | Exact per-site sums of the greatest accepted installation contributions, plus the legacy baseline | `web/functions/test-counter-invariants.cjs` |
| Crash or rejection before or after a persistence boundary | No false successful acknowledgement; retry preserves existing values without adding the batch twice | `web/functions/test-counter-invariants.cjs` |
| Cached lower value reaches the database | Native maximum preserves the saved number; ordinary lower assignments are denied | `web/scripts/test-counter-emulator.cjs` |
| Empty replacement, delete, identity change, or another user | Firestore denies the write and preserves the existing counter | `web/scripts/test-counter-emulator.cjs` |
| Damaged or deleted statistics mirror | The protected counters recover the saved usage | `web/functions/test-usage.cjs` and `web/scripts/test-counter-emulator.cjs` |
| Incorrect migration permissions or overlapping broad allow rules | Protected accounts reject raw usage writes; the compatible rules retain unmigrated behavior | `web/scripts/test-counter-emulator.cjs` |

## Why these checks can catch regressions

The extension harness executes the actual worker functions, storage queue, journal, and day-transition code. It observes the per-day floor after every successful storage write. The backend sequence tests use an independent storage model and a separate exact-total oracle, rather than calling the production merge helper to calculate the expected result. Three fixed seeds reproduce 576 delivered requests across several sites, installations, and days, including a legacy baseline. Failure injection covers reads and commits before and after persistence, including the final counter write when another installation changes the mirror.

The emulator suite exercises the production counter writer and real database rules. Its permission checks use ordinary authenticated requests; administrative access is used only to prepare or deliberately damage test fixtures. Both the rollout and stricter rule variants must pass.

Emulator negative controls also remove the numeric guard or add an overlapping broad allow rule in temporary rulesets. The lower-write and deletion checks must detect those weakened rules before the original rules are restored. This checks that a passing permission test is not caused by a broken request or an unrelated denial.

Sensitivity tests run isolated, compiling copies with three deliberate defects: treating a failed authoritative read as empty, adding an absolute contribution twice, and replacing native maximum with increment. Each must fail on its intended invariant. Temporary experiments also confirmed that deleting the prior-day journal fails the restart test and removing storage serialization loses a second in the overlapping-tick test. The working application files remain untouched during these experiments.

## Scope of the guarantee

The database operation and rules enforce the invariant; finite tests check that the application is wired to that protection and handles the likely failure sequences correctly. The extension tests model Chrome's APIs rather than launching a browser. They do not make every elapsed wall-clock second durable before Chrome saves it, simulate power loss inside Chrome's storage engine, or prevent privileged Firebase administrators from bypassing rules. The local failure tests model a storage API call that commits or rejects. Existing legacy accounts gain the permanent counters and protection marker on their first guarded read or sync.

The reproduced chess.com reset, its cause, and live deployment checks are recorded in `agent-docs/bug-fixes/time-counter-resets.md`. Implementation and deployment details are in `web/functions/USAGE.md` and `extension/docs/time-syncing-doc.md`.
