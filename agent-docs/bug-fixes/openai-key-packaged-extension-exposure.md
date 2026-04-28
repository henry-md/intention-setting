# OpenAI Key Exposed In Packaged Extension Build

## What broke

The AI assistant in the Chrome extension originally read `VITE_OPENAI_API_KEY` directly in the client code. Because Vite embeds all `VITE_*` variables into the built bundle, the OpenAI key ended up inside `extension/build/...` and would therefore also be present in any packaged Chrome Web Store upload.

This was **not** a git-history leak in the commits we checked, but it **was** a distributed client-secret leak because the packaged extension could be inspected by anyone who installed or downloaded it.

## Why it matters

- A service-owned OpenAI key cannot be kept secret inside browser extension client code.
- Ignoring `.env` in git is not enough if the build step compiles the secret into distributable assets.
- For this project, the important threat model is not just GitHub exposure; it is also packaged extension exposure.

## Fix applied

- Removed the direct client-side OpenAI usage from `extension/src/components/LLMPanel.tsx`.
- Added `extension/src/utils/openaiProxy.ts` so the extension calls a Firebase Function instead of OpenAI directly.
- Added `extension/src/utils/firebaseIdToken.ts` so the extension authenticates to the backend with a Firebase ID token.
- Added `web/functions/index.js` with `openaiChatCompletion`, which:
  - verifies the Firebase auth token,
  - reads `OPENAI_API_KEY` from Firebase Secret Manager,
  - sends the real request to OpenAI server-side.
- Removed the direct `openai.com` host permission from the extension manifest and replaced it with Firebase Functions access.
- Updated setup docs so `OPENAI_API_KEY` is configured as a Firebase Functions secret, not a `VITE_` env var.

## Rule going forward

Never place service-owned API keys in:

- `VITE_*` variables used by extension or frontend code
- browser extension source code
- public frontend bundles
- packaged extension assets

If the extension needs a secret-backed third-party API, route it through a server-side endpoint and keep the secret in managed server-side config such as Firebase Functions secrets.
