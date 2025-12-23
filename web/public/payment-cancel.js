// This script is on a public page and redirects back to the extension

// TODO: Replace with your local extension ID
const EXTENSION_ID = "mpogjlmfglgmddglidjmhkdgcdaplicd";

document.addEventListener("DOMContentLoaded", () => {
  const extensionUrl = `chrome-extension://${EXTENSION_ID}/cancel.html`;
  console.log("[Payment Cancel] Redirecting to extension:", extensionUrl);
  window.location.replace(extensionUrl);
});
