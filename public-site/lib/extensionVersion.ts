export const EXTENSION_STORE_URL =
  'https://chromewebstore.google.com/detail/intention-setting/fnemliooiheogciefhmbiknheoeflaal';

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
  latestVersion: '1.0.3',
  minSupportedVersion: '1.0.3',
  storeUrl: EXTENSION_STORE_URL,
};

export function getExtensionClientMessages() {
  const upgradeMessage = readStringEnv(process.env.UPGRADE_MSG);
  const modalMessage = readStringEnv(process.env.MODAL_MSG);
  const aiChatFocusModalMessage = readStringEnv(process.env.AI_CHAT_FOCUS_MODAL_MSG);
  const tutorialDisabledMessage = readStringEnv(process.env.TUTORIAL_DISABLED_MSG);

  return {
    ...EXTENSION_VERSION_RESPONSE,
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
