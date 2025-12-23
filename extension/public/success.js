// Sends message to background script to close the success tab
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Extension Success Page] Loaded successfully");
  const closeButton = document.getElementById("close-window-button");
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "close-success-tab" });
    });
  }
});
