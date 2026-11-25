# Limits failed to save after counter protection

The counter rollout requires authenticated owner writes to migrated user documents. The extension's UI reads its signed-in user from Chrome storage, but its Firestore Lite settings writes relied on the Firebase SDK's current user. Those states can differ. On November 25, 2026, an isolated extension browser reproduced a 60-to-30-minute edit returning HTTP 403 while the stored user remained signed in and the SDK user was null. The form stayed open without a visible error, and Firestore retained the old 60-minute limit.

`saveUserSettings` obtains the existing user's Firebase ID token, including the stored-token refresh path, and sends an authenticated Firestore PATCH. Its allowlist and update masks permit only `rules`, `groups`, and `conversationHistory`; usage fields cannot enter this write. Manual forms, assistant tools, and tutorial setup use this helper. Optional undefined object fields are omitted so unnamed rule edits also serialize correctly.

The rule form waits for database persistence before publishing saved state or closing. A failed database save leaves the edited values available, shows an error, and permits retry. A pending save disables duplicate submissions. Numeric defaults preserve zero soft extensions when reopening a rule.

Local rule-index synchronization retains its existing best-effort behavior. A failed refresh logs the error and preserves the previous local indexes until a later successful sync, including extension initialization. A database write that succeeded must remain a successful save; treating a later refresh failure as a creation failure can cause retries to create duplicate rules.

Browser verification used a disposable migrated account with no SDK user. Saving 60 to 30 minutes survived reload; a forced network failure kept the edited form open and the previous database limit intact, then retry succeeded. An unnamed rule also saved. Both the usage mirror and permanent total stayed at 213 seconds throughout. These checks changed no real account settings.

Limits may increase or decrease. The monotonic invariant applies to recorded seconds in the permanent counters. Both database rule variants test lower hard/soft limits, fewer or shorter extensions, tighter schedules, and rule/group deletion while preserving the usage mirror and permanent seconds. Anonymous saves, wrong-user saves, and settings writes bundled with usage changes must fail. Run `npm --prefix web test` for these regressions and the existing counter suite.
