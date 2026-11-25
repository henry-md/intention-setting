# Time counter resets

On November 25, 2026, Chrome's local usage records showed chess.com falling from 885 seconds to zero at 3:41:08 p.m. Eastern, then from 152 seconds to zero at 3:43:45 p.m. The stored usage day had already advanced to November 25 at 4:16 a.m. Both zero writes also updated `lastResetTimestamp`. Firestore recorded the second reset; no remote clear request was present.

`timerTick` checked that the global `lastTickTimestamp` was non-null, then awaited storage reads before using it. If the tab blurred during either await, `stopCurrentTimer` set that timestamp to null. The resumed tick interpreted null as January 1970, detected a false daily boundary crossing, and reset the counters. An isolated test executing the actual worker function reproduced that false boundary.

The local records also contained repeated one-second decreases. Separate races let content scripts, shared-usage hydration, and completed syncs write old copies of `siteTimeData` over newer ticks. A seeded local contribution could also overwrite a larger contribution already saved in Firestore.

Daily resets must use the persisted usage day and serialize with counter writes. A tick whose timer changed during an await must stop before changing usage. Content scripts must only read counters. Pending contributions must survive worker restarts, and both local merges and backend transactions must preserve the largest recorded value for each site and usage day.

Run `pnpm --dir extension test:timer-lifecycle` to check tab changes during daily checks and storage reads. The tests execute the worker's timer functions with Chrome API mocks.

The corrected local build was reloaded on November 25. Its new journal entry reached `pending: false`, confirming a live upload acknowledgement. The `syncUsage` function was deployed with the initial repair. A subsequent database safeguard adds permanent counters, rule-enforced nondecreasing seconds, and native maximum writes authenticated as the caller. See `web/functions/USAGE.md` for the current deployment and permission model.

The database safeguard uses a separate counter namespace so stale statistics cannot erase the saved floor. `getUsage` recovers from those counters; failed reads abort instead of becoming zero. The compatible rollout rules protect migrated accounts with a server-owned marker while preserving legacy behavior for accounts that have not migrated. Normal application code never assigns or deletes the permanent seconds fields.

The database safeguard was deployed and verified live on November 25. Direct lower writes and deletion were rejected; a damaged test mirror recovered from its permanent counters. After reloading the local extension, the real account had `usageCountersVersion: 1` and permanent counters matching its saved statistics.
