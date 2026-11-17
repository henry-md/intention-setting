# Shared usage on the first sync

The first contribution sync after an upgrade or fresh install could count its pending batch twice. Local `siteTimeData` already included those seconds, but the unseeded contribution calculation added the batch again. A shared total of 100 seconds with 105 local seconds and 5 pending seconds became 110.

Subtract the active site's pending batch when deriving its initial contribution, then add the batch once through the common sync path. Seeded contributions keep their existing behavior.

Run `pnpm --dir extension test:usage-sync` to check fresh installs, migration, contribution recovery, followup batches, retries, and overlapping sync requests. The tests execute the worker's actual sync functions with Chrome storage and Firestore mocks.
