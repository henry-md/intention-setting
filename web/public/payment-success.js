// This script is on a public page and redirects back to the extension

// TODO: Replace with your local extension ID
const EXTENSION_ID = "mpogjlmfglgmddglidjmhkdgcdaplicd";

document.addEventListener("DOMContentLoaded", () => {
  const extensionUrl = `chrome-extension://${EXTENSION_ID}/success.html`;
  console.log("[Payment Success] Redirecting to extension:", extensionUrl);
  window.location.replace(extensionUrl);
});
