# Permanent usage counters

`usageCounters/{uid}/days/{dayKey}/values/{counterId}` stores the permanent usage counters. Each document has an integer `seconds` and an immutable identity: `kind`, `siteKey`, and `installationId`. Separate records hold legacy usage, installation contributions, site totals, and the daily total.

The application never assigns `seconds`. It submits Firestore's native `maximum` transform, which compares against the value inside the database when the write commits. A delayed request containing 10 cannot replace a saved 50. No earlier read is needed for that comparison.

Firestore rules independently require nondecreasing integer seconds, preserve each counter's identity, and forbid deletion or empty replacement. The backend writes these counters using the request's verified Firebase ID token, so the rules apply to its writes. It does not use Admin credentials to write the permanent counters.

## Reads and acknowledgements

Admin reads obtain the current counters without an offline cache. A failed or malformed read aborts the request; it never becomes an empty baseline. `syncUsage` combines the permanent counters with the existing statistics, raises the counters, reads them back, and repairs the statistics before returning success. Retries use absolute contributions and do not add the same seconds twice.

`users/{uid}.dailyUsageHistory` is a statistics mirror. `getUsage` returns the protected values if that mirror is missing or lower; `syncUsage` repairs the stored mirror. The extension refreshes through `getUsage`, so recovery does not depend on trusting the mirror alone. A first read of existing usage also creates the permanent counters without adding time.

The server sets `usageCountersVersion: 1` after a successful counter commit. The deployed rollout rules then reserve that account's usage history and reset fields for the server. Clients cannot remove the marker, replace the saved history, or delete the user document. Accounts that have not migrated retain their previous client behavior.

## Daily limits and maintenance

A new usage day creates new counter documents. Previous days are never zeroed, and the normal application has no counter deletion operation. Root-history cleanup scripts affect only the statistics mirror; they cannot remove the saved counters, and a later sync restores their recorded floor.

Privileged Firebase administrators can bypass rules. Administrative code must not overwrite or delete the `usageCounters` namespace. The nondecreasing guarantee covers the application's rule-enforced writes, including the backend write path, rather than deliberate administrator deletion.

## Verification and deployment

- `npm --prefix web/functions run test:usage` exercises merges, failed reads, guarded writes, retries, recovery, and native maximum payloads.
- `npm --prefix web/functions run test:counter-rules` compiles both rule variants and evaluates their permission cases through the Rules API without publishing or changing documents.
- `pnpm --dir extension test:timekeeping` exercises local persistence, tab changes, restarts, and authoritative refreshes.

`web/firebase.json` selects `firestore-counter-rollout.rules`, which protects the new namespace and migrated accounts while keeping compatibility for accounts that have not migrated. `firestore.rules` is the stricter variant for a later full rollout. Deploy the compatible rules before deploying the guarded `syncUsage` and `getUsage` functions, then reload or distribute the updated extension.

The compatible rules and both guarded functions were deployed on November 25, 2026. Live tests confirmed lower replacements, empty writes, deletion, identity changes, and migrated-root overwrites receive HTTP 403. A native maximum with zero preserved 55 seconds. A deliberately damaged synthetic statistics mirror recovered 55 from the permanent counters. All synthetic documents and Auth accounts were removed afterward. The reloaded local extension's real account was verified to have the protection marker and matching permanent and mirrored totals.
