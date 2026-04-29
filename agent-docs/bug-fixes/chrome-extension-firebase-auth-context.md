# Chrome Extension Firebase Auth Context

## What broke

The extension stored the Firebase `user` object returned by the hosted offscreen sign-in page, then later tried to restore Firebase Auth with `GoogleAuthProvider.credential(null, storedUser.accessToken)`.

That token is a Firebase ID token, not a Google OAuth access token, so Google rejected it with `auth/invalid-credential` / `Invalid Value`. Firestore calls then ran without a valid extension-origin Firebase Auth user.

## Fix applied

- The hosted sign-in page now posts back the real Google OAuth access token from `GoogleAuthProvider.credentialFromResult`.
- The extension background signs its own `firebase/auth/web-extension` instance in with that Google credential before saving the user to `chrome.storage.local`.
- Stripe auth checks now wait for Firebase Auth persistence to initialize and ask the user to sign in again if the extension-origin auth state is missing.
- `pnpm zip` now recreates the archive from scratch after a production build, and Vite emits relative asset URLs to reduce stale/dev asset packaging mistakes that can show up as HTML being loaded as script.
