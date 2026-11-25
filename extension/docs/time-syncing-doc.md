# Time tracking and sync

The background service worker owns time tracking. Content scripts report focus and navigation events and display counters; they do not write `siteTimeData`. Only the active tracked tab has a timer.

## Local persistence

`withUsageStorageLock` serializes counter increments, daily transitions, shared-usage merges, and journal acknowledgements. Network requests run outside that queue so an unavailable backend cannot stop local tracking.

Every tick saves the visible `siteTimeData` counter and its pending upload record in the same `chrome.storage.local.set` call. A callback captures its timer before joining the queue and checks that timer again after awaits. A tab change cancels the old callback, including callbacks still waiting for the queue.

`usageJournal` stores entries by usage day:

```typescript
{
  "2026-11-25": {
    siteTotals: { "example.com": 42 },
    baselineSiteTotals: { "example.com": 142 },
    periodStart: 1795597200000,
    pending: true
  }
}
```

`siteTotals` contains this installation's absolute contributions. `baselineSiteTotals` preserves the largest known shared/local totals, including usage recorded before the journal migration. `usageInstallationId` identifies the installed copy across worker and browser restarts. Pending upload accounting does not depend on a running timer or an in-memory seconds counter.

## Backend writes

The worker uploads pending entries through the authenticated `syncUsage` HTTP function. The server derives the user ID from the Firebase token and validates the payload. Permanent counters live under `usageCounters/{uid}/days/{dayKey}/values/{counterId}`. Their `seconds` fields are written only with Firestore's atomic `maximum` transform. Database rules also reject lower numbers, deletion, empty replacement, and identity changes. The backend uses the verified caller token for these writes, so those rules apply to it. Repeating or reordering an upload cannot lower a saved counter or count the same absolute contribution twice.

The server preserves legacy usage and any previously saved aggregate that exceeds its contribution breakdown. It derives the shared per-site totals from that baseline plus the installation contributions, while keeping existing aggregate totals as a floor. The resulting history remains in `users/{uid}.dailyUsageHistory.{dayKey}`, with `usageFormatVersion: 2`.

`web/firebase.json` selects `firestore-counter-rollout.rules`. Those rules protect the permanent namespace and reserve root usage history for the server after the account receives `usageCountersVersion: 1`. Accounts that have not migrated retain their previous behavior. The stricter `firestore.rules` variant is available for a later full rollout. Deploy the compatible rules before the guarded functions.

## Acknowledgements and refreshes

A completed upload reacquires the storage queue and reads the latest local state. Its acknowledgement keeps seconds recorded while the request was in flight and leaves them pending for the next upload. Shared refreshes call the authenticated `getUsage` endpoint, which reads the permanent counters as well as the statistics mirror. A first read migrates existing usage without adding time. Refreshes merge with the latest local counters using the larger value. Both paths discard responses for a different user, usage day, or explicit reset generation where applicable.

Failed uploads leave the journal in local storage for retry. Sync runs while tracking and through the scheduled usage alarm, so saved pending contributions can upload after a worker restart or when no tracked tab remains open.

## Daily transitions

The configured local reset time determines the usage day; the default is 4 a.m. `currentUsageDayKey` is the authority for deciding whether a day has advanced. An already recorded day cannot reset again because of a stopped timer, an old timestamp, or a backward clock change.

A daily transition preserves the previous day's pending journal entry before starting new daily counters. Permanent database records for previous days are never zeroed or deleted. Late acknowledgements update that day's journal without replacing the new day's visible counters. An explicit remote clear has a separate reset generation so stale responses cannot restore cleared local data.

## Regression checks

- `pnpm --dir extension test:timer-lifecycle` checks tab changes during awaits, queued callbacks, atomic tick persistence, and worker restarts.
- `pnpm --dir extension test:usage-sync` checks upload retries, delayed acknowledgements, day changes, and pending journal recovery.
- `pnpm --dir extension test:usage-day-reset` checks the persisted day guard and scheduled reset behavior.
- `pnpm --dir extension test:content-timer` checks that tab initialization cannot overwrite counters.
- `pnpm --dir web/functions test:usage` checks backend validation and monotonic transaction merges.

The November 25 chess.com incident and its reproduced trigger are recorded in `agent-docs/bug-fixes/time-counter-resets.md`.
