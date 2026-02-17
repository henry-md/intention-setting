**Important:** Chrome Extension Manifest V3 (MV3) imposes strict Content Security Policy (CSP) restrictions, which block inline scripts and remote script injection. This mean certain approaches and things, especially integrations with third party tools, have lots of depricated approaches that no longer work in V3 extensions. Since I'm using a V3 manifest, MAKE SURE to validate all proposed third party integrations to make sure that they are not depricated, and don't break the very strict CSP restrictions we now have. 

In fact, when suggesting a third party integration, explicitly specify in your answer that it abides by the CSP in V3 extensions, since there are many outdated tutorials you have to disregard.

## Offscreen Document Pattern
The offscreen document pattern handles Firebase authentication in a separate, invisible document because Chrome’s extension security model requires isolating sensitive operations. This is achieved using chrome.offscreen.createDocument(), which creates a secure, sandboxed environment for authentication flows. This approach is fundamentally necessary because methods like signInWithPopup are incompatible with Chrome extensions due to process isolation and security restrictions that prevent direct communication between extension scripts and OAuth popups.

## Firebase OAuth Flow
```
Popup → Background Script → Offscreen Document → Firebase Hosting → Firebase Auth
```

## File Structure & Responsibilities
- `/extension/src/background/background.js`: Service worker managing offscreen document lifecycle and message routing
- `/extension/src/public/offscreen.js`: Creates iframe to Firebase hosting URL, handles auth initiation
- `/extension/src/popup/popup.js`: UI interaction and Chrome storage management
- `/web/public/signInWithPopup.js`: Hosted on Firebase, handles actual Firebase auth flow

## Message Passing
```javascript
// Background to offscreen
chrome.runtime.sendMessage({action: 'getAuth', target: 'offscreen'})

// Offscreen to hosted popup
iframe.contentWindow.postMessage({initAuth: true}, FIREBASE_HOSTING_URL)

// Hosted popup response
window.parent.postMessage(JSON.stringify(result), PARENT_FRAME)
```

## Security & Configuration
- Firebase config exposed in client-side code (intentional, project identifier only)
- Chrome extension requires public key from Chrome Web Store
- OAuth client ID must be configured in Google Cloud Console
- Extension ID must be added to Firebase authorized domains

## Storage Pattern
- User data stored in chrome.storage.local
- Async storage operations with callbacks
- UI updates based on stored auth state

## Error Handling Considerations
- CORS issues are often resolved by proper Firebase hosting URL configuration
- CSP restrictions require hosted popup approach (not inline scripts)
- Extension ID and public key required for production deployment

## Build Requirements
- Webpack configuration for background/popup entry points
- CopyWebpackPlugin for static assets (manifest, offscreen.html)
- Firebase hosting deployment for OAuth popup

## Dependencies
- firebase SDK (auth module)
- webpack build tools
- Chrome extension APIs (offscreen, storage, runtime)

## When working with this codebase:
- Always use the offscreen document pattern for Firebase OAuth
- Reference hosted Firebase URLs, not local files
- Handle async Chrome extension messaging properly
- Remember Chrome Web Store deployment is required for public key
