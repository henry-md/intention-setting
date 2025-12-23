// TODO: Replace with your Firebase hosting URL
const FIREBASE_HOSTING_URL = "https://intention-setter.web.app";

const iframe = document.createElement("iframe");
iframe.src = FIREBASE_HOSTING_URL;
document.body.appendChild(iframe);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("message", message);
  if (message.action === "getAuth" && message.target === "offscreen") {
    function handleIframeMessage({ data }) {
      // Skip Firebase internal messages
      if (typeof data === "string" && data.startsWith("!_")) {
        return;
      }

      // If the user is signed in, send the user object to the background script
      try {
        const parsedData = JSON.parse(data);
        window.removeEventListener("message", handleIframeMessage);
        sendResponse(parsedData.user);
      } catch (e) {
        console.error("Error parsing iframe message:", e);
      }
    }

    window.addEventListener("message", handleIframeMessage);
    iframe.contentWindow.postMessage({ initAuth: true }, FIREBASE_HOSTING_URL);
    return true; // Indicates we will send a response asynchronously
  }
});
