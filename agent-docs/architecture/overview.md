## Extension Onboarding Tutorial

The extension popup owns the discoverability tutorial in `extension/src/pages/Popup.tsx`. It stores a versioned status in `chrome.storage.local` using `TUTORIAL_STORAGE_KEY` so the modal appears for users who have not declined, dismissed, or completed the flow.

Tutorial UI lives in `extension/src/components/TutorialOverlay.tsx`. It renders four dimmed/blurred overlay panels around a transparent spotlight rectangle, plus a modal card with an exit button. Step targets are ordinary DOM nodes marked with `data-tutorial-target` attributes.

The tutorial prompt is intentionally deterministic: while the tutorial is on the AI step, `LLMPanel` requires the exact `TUTORIAL_EXACT_PROMPT`, creates/updates the Social Media hard limit directly, then guides the user through turning it into a soft limit with five one-minute extensions.

The public-site client messages endpoint also returns `TUTORIAL_DISABLED_MSG` as `tutorialDisabledMessage`. When it is non-empty, `Popup.tsx` does not auto-launch the tutorial and the Settings replay button shows that message without changing tutorial completion storage.

## Extension Version Update Prompt

The public Next app exposes `GET /api/extension-version` with the latest Chrome Web Store extension version and `GET /api/extension-client-messages` with server-owned strings/booleans for update copy and client notices. The extension checks the client messages endpoint from `extension/src/utils/extensionUpdate.ts`, compares the latest version with `chrome.runtime.getManifest().version`, and stores `extensionUpdatePromptLastShownAt` in `chrome.storage.local` so stale users see the update modal at most once per day. General message modals are rendered from plain text only and remember the last exact message in `extensionClientMessageLastSeen`. `AI_CHAT_FOCUS_MODAL_MSG` is also returned as plain text; when it is non-empty, the popup shows that message when the AI chat input receives focus outside the tutorial.

Production extension client messaging should point to the public-site Railway app at `https://intention-setting-production.up.railway.app`. Keep `VITE_FIREBASE_HOSTING_URL` on the Firebase-hosted OAuth helper separately.

## AI Chat Backend

The extension calls `openaiChatCompletion` in `web/functions/index.js` through `extension/src/utils/openaiProxy.ts`. The OpenAI API key is a Firebase Functions secret named `OPENAI_API_KEY`; the chat model is server-owned via `OPENAI_CHAT_MODEL` in `web/functions/.env` and should not be sent from the extension client.
