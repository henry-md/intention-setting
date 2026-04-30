export const EXTENSION_STORE_URL =
  'https://chromewebstore.google.com/detail/intention-setting/fnemliooiheogciefhmbiknheoeflaal';

const EXTENSION_LATEST_VERSION = '1.0.4';
const EXTENSION_MIN_SUPPORTED_VERSION = '1.0.4';

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readStringEnv(value: string | undefined): string {
  return value?.trim() || '';
}

export const EXTENSION_VERSION_RESPONSE = {
  latestVersion: EXTENSION_LATEST_VERSION,
  minSupportedVersion: EXTENSION_MIN_SUPPORTED_VERSION,
  storeUrl: EXTENSION_STORE_URL,
  forceUpgradeModalToShow: false,
};

function getNextPatchVersion(version: string): string {
  const parts = version.split('.').map(part => Number(part));
  const normalizedParts = [
    parts[0] || 0,
    parts[1] || 0,
    parts[2] || 0,
  ];

  normalizedParts[2] += 1;
  return normalizedParts.join('.');
}

export function getExtensionVersionResponse() {
  const forceUpgradeModalToShow = readBooleanEnv(process.env.FORCE_UPGRADE_MODAL_TO_SHOW, false);

  if (!forceUpgradeModalToShow) {
    return EXTENSION_VERSION_RESPONSE;
  }

  const forcedVersion = getNextPatchVersion(EXTENSION_VERSION_RESPONSE.latestVersion);

  return {
    ...EXTENSION_VERSION_RESPONSE,
    latestVersion: forcedVersion,
    minSupportedVersion: forcedVersion,
    forceUpgradeModalToShow,
  };
}

export function getExtensionClientMessages() {
  const upgradeMessage = readStringEnv(process.env.UPGRADE_MSG);
  const modalMessage = readStringEnv(process.env.MODAL_MSG);
  const aiChatFocusModalMessage = readStringEnv(process.env.AI_CHAT_FOCUS_MODAL_MSG);
  const tutorialDisabledMessage = readStringEnv(process.env.TUTORIAL_DISABLED_MSG);

  return {
    ...getExtensionVersionResponse(),
    upgradeMessage,
    modalMessage,
    aiChatFocusModalMessage,
    tutorialDisabledMessage,
    showUpgradeModalBeforeMessageModal: readBooleanEnv(
      process.env.SHOW_UPGRADE_MODAL_BEFORE_MSG_MODAL,
      true
    ),
    showMessageModalIfUpgradeModalIsActive: readBooleanEnv(
      process.env.SHOW_MSG_MODAL_IF_UPGRADE_MODAL_IS_ACTIVE,
      false
    ),
  };
}
