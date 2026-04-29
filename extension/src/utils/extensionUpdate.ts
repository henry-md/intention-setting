import {
  DEFAULT_PUBLIC_SITE_URL,
  EXTENSION_CLIENT_MESSAGES_ENDPOINT_PATH,
  EXTENSION_CLIENT_MESSAGE_SEEN_STORAGE_KEY,
  EXTENSION_UPDATE_PROMPT_INTERVAL_MS,
  EXTENSION_UPDATE_PROMPT_STORAGE_KEY,
} from '../constants';

export interface ExtensionVersionResponse {
  latestVersion: string;
  minSupportedVersion?: string;
  storeUrl?: string;
  upgradeMessage?: string;
  modalMessage?: string;
  aiChatFocusModalMessage?: string;
  tutorialDisabledMessage?: string;
  showUpgradeModalBeforeMessageModal?: boolean;
  showMessageModalIfUpgradeModalIsActive?: boolean;
}

export interface ExtensionUpdatePrompt {
  currentVersion: string;
  latestVersion: string;
  minSupportedVersion?: string;
  storeUrl?: string;
  message?: string;
  isRequired: boolean;
}

export interface ExtensionClientMessagePrompt {
  message: string;
}

export interface ExtensionClientModalState {
  updatePrompt: ExtensionUpdatePrompt | null;
  messagePrompt: ExtensionClientMessagePrompt | null;
  aiChatFocusMessagePrompt: ExtensionClientMessagePrompt | null;
  tutorialDisabledMessagePrompt: ExtensionClientMessagePrompt | null;
  showUpgradeModalBeforeMessageModal: boolean;
  showMessageModalIfUpgradeModalIsActive: boolean;
}

export interface ExtensionUpdateCheckResult {
  status: 'update_available' | 'no_update' | 'throttled' | 'unsupported' | 'error';
  version?: string;
  message: string;
}

function getStorageValue<T>(key: string): Promise<T | undefined> {
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      resolve(result[key] as T | undefined);
    });
  });
}

function setStorageValue(key: string, value: unknown): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

function getPublicSiteUrl(): string {
  const envUrl = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.trim();
  return (envUrl || DEFAULT_PUBLIC_SITE_URL).replace(/\/+$/, '');
}

function isVersionString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+){0,3}$/.test(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function compareExtensionVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(part => Number(part));
  const rightParts = right.split('.').map(part => Number(part));
  const maxLength = Math.max(leftParts.length, rightParts.length, 4);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  return 0;
}

async function fetchExtensionClientMessages(): Promise<ExtensionVersionResponse | null> {
  const response = await fetch(`${getPublicSiteUrl()}${EXTENSION_CLIENT_MESSAGES_ENDPOINT_PATH}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Version endpoint returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  const data = await response.json() as Partial<ExtensionVersionResponse>;

  if (!isVersionString(data.latestVersion)) {
    throw new Error('Version endpoint returned an invalid latestVersion.');
  }

  if (data.minSupportedVersion !== undefined && !isVersionString(data.minSupportedVersion)) {
    throw new Error('Version endpoint returned an invalid minSupportedVersion.');
  }

  return {
    latestVersion: data.latestVersion,
    minSupportedVersion: data.minSupportedVersion,
    storeUrl: typeof data.storeUrl === 'string' ? data.storeUrl : undefined,
    upgradeMessage: readOptionalString(data.upgradeMessage),
    modalMessage: readOptionalString(data.modalMessage),
    aiChatFocusModalMessage: readOptionalString(data.aiChatFocusModalMessage),
    tutorialDisabledMessage: readOptionalString(data.tutorialDisabledMessage),
    showUpgradeModalBeforeMessageModal:
      typeof data.showUpgradeModalBeforeMessageModal === 'boolean'
        ? data.showUpgradeModalBeforeMessageModal
        : true,
    showMessageModalIfUpgradeModalIsActive:
      typeof data.showMessageModalIfUpgradeModalIsActive === 'boolean'
        ? data.showMessageModalIfUpgradeModalIsActive
        : false,
  };
}

async function getDailyExtensionUpdatePrompt(
  versionInfo: ExtensionVersionResponse
): Promise<ExtensionUpdatePrompt | null> {
  const currentVersion = chrome.runtime.getManifest().version;
  const isBehindLatest = compareExtensionVersions(currentVersion, versionInfo.latestVersion) < 0;
  const isBelowMinimum = versionInfo.minSupportedVersion
    ? compareExtensionVersions(currentVersion, versionInfo.minSupportedVersion) < 0
    : false;

  if (!isBehindLatest && !isBelowMinimum) {
    return null;
  }

  const lastShownAt = Number(await getStorageValue<number>(EXTENSION_UPDATE_PROMPT_STORAGE_KEY) || 0);
  if (Date.now() - lastShownAt < EXTENSION_UPDATE_PROMPT_INTERVAL_MS) {
    return null;
  }

  await setStorageValue(EXTENSION_UPDATE_PROMPT_STORAGE_KEY, Date.now());

  return {
    currentVersion,
    latestVersion: versionInfo.latestVersion,
    minSupportedVersion: versionInfo.minSupportedVersion,
    storeUrl: versionInfo.storeUrl,
    message: versionInfo.upgradeMessage,
    isRequired: isBelowMinimum,
  };
}

export async function getExtensionClientModalState(): Promise<ExtensionClientModalState | null> {
  const versionInfo = await fetchExtensionClientMessages();

  if (!versionInfo) {
    return null;
  }

  const updatePrompt = await getDailyExtensionUpdatePrompt(versionInfo);
  const seenMessage = await getStorageValue<string>(EXTENSION_CLIENT_MESSAGE_SEEN_STORAGE_KEY);
  const messagePrompt = versionInfo.modalMessage && versionInfo.modalMessage !== seenMessage
    ? { message: versionInfo.modalMessage }
    : null;
  const aiChatFocusMessagePrompt = versionInfo.aiChatFocusModalMessage
    ? { message: versionInfo.aiChatFocusModalMessage }
    : null;
  const tutorialDisabledMessagePrompt = versionInfo.tutorialDisabledMessage
    ? { message: versionInfo.tutorialDisabledMessage }
    : null;

  if (!updatePrompt && !messagePrompt && !aiChatFocusMessagePrompt && !tutorialDisabledMessagePrompt) {
    return null;
  }

  return {
    updatePrompt,
    messagePrompt,
    aiChatFocusMessagePrompt,
    tutorialDisabledMessagePrompt,
    showUpgradeModalBeforeMessageModal: versionInfo.showUpgradeModalBeforeMessageModal ?? true,
    showMessageModalIfUpgradeModalIsActive: versionInfo.showMessageModalIfUpgradeModalIsActive ?? false,
  };
}

export async function markClientMessagePromptSeen(message: string): Promise<void> {
  await setStorageValue(EXTENSION_CLIENT_MESSAGE_SEEN_STORAGE_KEY, message);
}

export async function requestExtensionUpdate(): Promise<ExtensionUpdateCheckResult> {
  if (!chrome.runtime.requestUpdateCheck) {
    return {
      status: 'unsupported',
      message: 'Chrome cannot check for extension updates from this install.',
    };
  }

  try {
    const result = await chrome.runtime.requestUpdateCheck();

    if (result.status === 'update_available') {
      return {
        status: 'update_available',
        version: result.version,
        message: 'Update downloaded. Reload the extension to finish.',
      };
    }

    if (result.status === 'throttled') {
      return {
        status: 'throttled',
        message: 'Chrome is throttling update checks. Try again later or open the Web Store page.',
      };
    }

    return {
      status: 'no_update',
      message: 'Chrome did not find an update yet. It may still be rolling out.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Update check failed.',
    };
  }
}
