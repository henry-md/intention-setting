
## Permanent time counters

The background worker persists per-day installation contributions before uploading them. `syncUsage` and `getUsage` in `web/functions/index.js` use permanent counters under `usageCounters/{uid}/days/{dayKey}/values/{counterId}`. Numeric writes use Firestore's atomic maximum and the verified caller token; database rules forbid decreases, identity changes, empty replacement, and deletion. Failed reads abort. Daily rollover creates new records without clearing old ones. The `users.dailyUsageHistory` statistics mirror is recoverable from these counters, and a server-owned `usageCountersVersion` marker protects migrated accounts from direct client overwrites. See `web/functions/USAGE.md` and `extension/docs/time-syncing-doc.md`.
