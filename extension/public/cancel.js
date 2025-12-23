// Sends message to background script to close the cancel tab
document.addEventListener("DOMContentLoaded", () => {
  const closeButton = document.getElementById("close-window-button");
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "close-cancel-tab" });
    });
  }
});
