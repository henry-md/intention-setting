import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth/web-extension";
import { auth } from "../utils/firebase";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
// TODO: Replace with your Firebase hosting URL
const FIREBASE_HOSTING_URL =
  "https://intention-setter.web.app";

let creatingOffscreenDocument;

async function hasOffscreenDocument() {
  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) =>
    client.url.endsWith(OFFSCREEN_DOCUMENT_PATH)
  );
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
  } else {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: "Firebase Authentication",
    });
    await creatingOffscreenDocument;
    creatingOffscreenDocument = null;
  }
}

async function getAuthFromOffscreen() {
  await setupOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "getAuth", target: "offscreen" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      }
    );
  });
}

function serializeFirebaseUser(user) {
  if (!user) return null;
  return typeof user.toJSON === "function" ? user.toJSON() : user;
}

function getGoogleOAuthAccessToken(authPayload) {
  return authPayload?.googleOAuthAccessToken ||
    authPayload?.oauthAccessToken ||
    authPayload?.credential?.accessToken ||
    authPayload?._tokenResponse?.oauthAccessToken ||
    null;
}

async function signInExtensionFirebaseAuth(authPayload) {
  if (authPayload?.error || (authPayload?.code && authPayload?.message && !authPayload?.user)) {
    throw new Error(authPayload.error?.message || authPayload.message || "Google sign-in failed.");
  }

  const googleOAuthAccessToken = getGoogleOAuthAccessToken(authPayload);
  if (!googleOAuthAccessToken) {
    throw new Error("Google sign-in did not return an OAuth access token. Please try signing in again.");
  }

  const credential = GoogleAuthProvider.credential(null, googleOAuthAccessToken);
  const result = await signInWithCredential(auth, credential);
  return serializeFirebaseUser(result.user);
}

// Sufficient for bringing OAuth to front: monitor tabs for authentication windows and bring them to front
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.url &&
    (changeInfo.url.includes("accounts.google.com/o/oauth2") ||
      changeInfo.url.includes("accounts.google.com/signin") ||
      changeInfo.url.includes(FIREBASE_HOSTING_URL))
  ) {
    chrome.windows.update(tab.windowId, { focused: true });
  }
});

// Redundant for bringing OAuth to front: bring all new windows to front
chrome.windows.onCreated.addListener((window) => {
  if (window.type === "popup") {
    chrome.windows.update(window.id, { focused: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "signIn") {
    getAuthFromOffscreen()
      .then(async (authPayload) => {
        const signedInUser = await signInExtensionFirebaseAuth(authPayload);
        const user = signedInUser || authPayload?.user;

        if (!user?.uid) {
          throw new Error("Google sign-in completed without a Firebase user.");
        }

        chrome.storage.local.set({ user: user }, () => {
          chrome.runtime.sendMessage({
            action: "sync-user-profile",
            user: {
              uid: user?.uid,
              email: user?.email || "",
              displayName: user?.displayName || "",
              photoURL: user?.photoURL || "",
            },
          });
          sendResponse({ user: user });
        });
      })
      .catch((error) => {
        console.error("Authentication error:", error);
        sendResponse({ error: error.message });
      });
    return true; // Indicates we will send a response asynchronously
  } else if (message.action === "signOut") {
    firebaseSignOut(auth)
      .catch((error) => {
        console.warn("Firebase sign-out failed:", error);
      })
      .finally(() => {
        chrome.storage.local.remove("user", () => {
          sendResponse();
        });
      });
    return true;
  }
});
