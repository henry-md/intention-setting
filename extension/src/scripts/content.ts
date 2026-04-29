// Content script for intention setting
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import IntentionPopup from '../components/IntentionPopup';
import SoftLimitPopup from '../components/SoftLimitPopup';
import TimerBadge from '../components/TimerBadge';
import DebugPanel from '../components/DebugPanel';
import {
  ALLOW_CUSTOM_RESET_TIME,
  DEFAULT_DAILY_RESET_TIME,
  DEFAULT_UPCOMING_LIMIT_REMINDER_SECONDS,
  MAX_UPCOMING_LIMIT_REMINDER_SECONDS,
  MIN_UPCOMING_LIMIT_REMINDER_SECONDS,
  TUTORIAL_INSTAGRAM_BADGE_STEP_KEY,
} from '../constants';
import { getMostRestrictiveRuleIdForSite, getTotalAllowedSeconds } from '../utils/ruleSelection';
import { normalizeHostname } from '../utils/urlNormalization';

/** Shape of a site rule as stored in chrome.storage (siteRules[siteKey]) */
interface StoredSiteRule {
  ruleType?: 'hard' | 'soft' | 'session';
  timeLimit?: number;
  ruleId?: string;
  plusOnes?: number;
  plusOneDuration?: number;
}

interface TutorialInstagramBadgeStepState {
  status?: string;
  tabId?: number;
  windowId?: number;
  updatedAt?: string;
  url?: string;
}

// ============================================================================
// CHROME API WRAPPERS - Handle extension context invalidation gracefully
// ============================================================================

let hasDetectedInvalidContext = false;
const CONTEXT_INVALIDATION_TEXT = 'extension context invalidated';

const isContextInvalidationError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.toLowerCase().includes(CONTEXT_INVALIDATION_TEXT);
};

/**
 * Check if Chrome extension context is still valid
 * When extension is reloaded, chrome.runtime.id becomes undefined
 * If invalid, auto-refresh the page to load new content script
 */
function isExtensionContextValid(): boolean {
  try {
    // Accessing chrome.runtime.id will throw if context is invalidated
    const isValid = chrome.runtime?.id !== undefined;

    if (!isValid && !hasDetectedInvalidContext) {
      hasDetectedInvalidContext = true;
      console.log('[Extension] Context invalidated - reloading page to inject new content script');

      // Small delay to ensure console message is visible
      setTimeout(() => {
        window.location.reload();
      }, 100);
    }

    return isValid;
  } catch {
    if (!hasDetectedInvalidContext) {
      hasDetectedInvalidContext = true;
      console.log('[Extension] Context invalidated - reloading page to inject new content script');

      setTimeout(() => {
        window.location.reload();
      }, 100);
    }
    return false;
  }
}

/**
 * Safely get from chrome.storage.local, handling context invalidation
 * Returns null if extension was reloaded
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chrome storage returns loose objects
async function safeStorageGet(keys: string[]): Promise<Record<string, any> | null> {
  if (!isExtensionContextValid()) {
    console.log('[Storage] Extension context invalidated - cannot read');
    return null;
  }

  try {
    return await chrome.storage.local.get(keys);
  } catch (error: unknown) {
    if (isContextInvalidationError(error)) {
      console.log('[Storage] Extension was reloaded - storage read failed');
      return null;
    }
    throw error;
  }
}

/**
 * Safely set to chrome.storage.local, handling context invalidation
 * Returns false if extension was reloaded, true if successful
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chrome storage accepts loose objects
async function safeStorageSet(items: Record<string, any>): Promise<boolean> {
  if (!isExtensionContextValid()) {
    console.log('[Storage] Extension context invalidated - cannot write');
    return false;
  }

  try {
    await chrome.storage.local.set(items);
    return true;
  } catch (error: unknown) {
    if (isContextInvalidationError(error)) {
      console.log('[Storage] Extension was reloaded - storage write failed');
      return false;
    }
    throw error;
  }
}

/**
 * Safely send message to background, handling context invalidation
 * Returns null if extension was reloaded
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chrome messaging API is loosely typed
async function safeSendMessage(message: any): Promise<any | null> {
  if (!isExtensionContextValid()) {
    console.log('[Message] Extension context invalidated - cannot send');
    return null;
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error: unknown) {
    if (isContextInvalidationError(error)) {
      console.log('[Message] Extension was reloaded - message not sent');
      return null;
    }
    throw error;
  }
}

const reportAsyncError = (context: string, error: unknown): void => {
  if (isContextInvalidationError(error)) {
    console.log(`[Extension] ${context} ignored after context invalidation`);
    return;
  }

  console.error(`[Extension] ${context} failed:`, error);
};

console.log('Intention Setting content script loaded');
console.log('[Timer] Initial state - document.hidden:', document.hidden, 'visibilityState:', document.visibilityState);

// Content script state (timer management moved to background service worker)
let currentSiteKey: string | null = null;
let containerRoot: Root | null = null; // Root for the flex container holding both components
let softLimitRoot: Root | null = null;
let softLimitContainer: HTMLElement | null = null;
let nearLimitOverlay: HTMLElement | null = null;
let nearLimitOverlayStyle: HTMLStyleElement | null = null;
let timerBadgeWrapper: HTMLElement | null = null;
let tutorialBadgeSpotlightContainer: HTMLElement | null = null;
let isTutorialBadgeSpotlightOpening = false;
const DEBUG_UI = import.meta.env.VITE_DEBUG_UI === 'true';
const clampReminderSeconds = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_UPCOMING_LIMIT_REMINDER_SECONDS;
  return Math.min(
    MAX_UPCOMING_LIMIT_REMINDER_SECONDS,
    Math.max(MIN_UPCOMING_LIMIT_REMINDER_SECONDS, Math.round(parsed))
  );
};

// Check if current URL matches user's saved URLs
const checkAndShowIntentionPopup = async () => {
  try {
    // Get current URL's normalized domain
    const currentUrl = new URL(window.location.href);
    const currentDomain = normalizeHostname(currentUrl.hostname);

    // Get user data from chrome storage
    const result = await safeStorageGet(['user']);
    if (!result?.user?.uid) {
      console.log('No user found, skipping intention check');
      return;
    }

    // Get site rules from chrome storage
    const rulesResult = await safeStorageGet(['siteRules']);
    if (!rulesResult) return; // Extension reloaded
    const siteRules: Record<string, StoredSiteRule> = rulesResult.siteRules || {};

    // Check if current domain has a rule
    const ruleData = siteRules[currentDomain];

    if (ruleData) {
      // Check if we've already visited this site in the current reset window
      const result = await safeStorageGet(
        ALLOW_CUSTOM_RESET_TIME ? ['siteTimeData', 'dailyResetTime'] : ['siteTimeData']
      );
      if (!result) return; // Extension reloaded
      const siteTimeData = result.siteTimeData || {};
      const siteData = siteTimeData[currentDomain];
      const dailyResetTime = ALLOW_CUSTOM_RESET_TIME ? result.dailyResetTime : DEFAULT_DAILY_RESET_TIME;

      const hasVisitedToday = siteData && siteData.lastUpdated && !isNewDay(siteData.lastUpdated, dailyResetTime);

      if (hasVisitedToday) {
        // Same day revisit - for hard/soft rules, just show the timer badge
        // For session rules, skip everything (already prompted today)
        console.log('Already visited today');
        if (ruleData.ruleType !== 'session' && ruleData.timeLimit != null) {
          console.log('Starting timer for same-day revisit:', ruleData);
          await startTimeTracking(ruleData.timeLimit);
        }
        return;
      }

      // New day or first visit
      // Only show intention popup for session rules
      if (ruleData.ruleType === 'session') {
        pauseAllMedia();
        showIntentionPopup();
      } else if (ruleData.timeLimit != null) {
        // For hard/soft rules, start timer immediately with the configured time limit
        console.log('Starting timer for hard/soft rule (first visit today):', ruleData);
        await startTimeTracking(ruleData.timeLimit);
      }
    }
  } catch (error) {
    console.error('Error checking intention:', error);
  }
};

// Pause all video/audio players on the page.
const pauseAllMedia = () => {
  const mediaElements = document.querySelectorAll<HTMLMediaElement>('video, audio');
  mediaElements.forEach((mediaEl) => {
    try {
      mediaEl.pause();
    } catch {
      // Ignore player pause errors
    }
  });
};

// Resume all video/audio players on the page.
const resumeAllMedia = () => {
  const mediaElements = document.querySelectorAll<HTMLMediaElement>('video, audio');
  mediaElements.forEach((mediaEl) => {
    mediaEl.play().catch(() => {
      // Ignore autoplay errors
    });
  });
};

// Get the current site key (normalized hostname)
const getCurrentSiteKey = (): string => {
  const hostname = new URL(window.location.href).hostname;
  return normalizeHostname(hostname);
};

/**
 * Calculates the most recent reset boundary for a timestamp.
 */
const getMostRecentResetBoundary = (timestamp: number, resetHour: number, resetMinute: number): number => {
  const date = new Date(timestamp);
  const todayReset = new Date(date);
  todayReset.setHours(resetHour, resetMinute, 0, 0);

  if (date < todayReset) {
    const yesterdayReset = new Date(todayReset);
    yesterdayReset.setDate(yesterdayReset.getDate() - 1);
    return yesterdayReset.getTime();
  }

  return todayReset.getTime();
};

const parseResetTime = (resetTime: unknown): { resetHour: number; resetMinute: number } => {
  const [fallbackHour, fallbackMinute] = DEFAULT_DAILY_RESET_TIME.split(':').map(Number);
  const fallback = { resetHour: fallbackHour, resetMinute: fallbackMinute };
  if (typeof resetTime !== 'string') return fallback;

  const [hourStr, minuteStr] = resetTime.split(':');
  const resetHour = Number(hourStr);
  const resetMinute = Number(minuteStr);

  if (
    Number.isNaN(resetHour) ||
    Number.isNaN(resetMinute) ||
    resetHour < 0 ||
    resetHour > 23 ||
    resetMinute < 0 ||
    resetMinute > 59
  ) {
    return fallback;
  }

  return { resetHour, resetMinute };
};

// Check if lastUpdated falls before the current reset boundary.
const isNewDay = (lastUpdated: number, resetTime: unknown): boolean => {
  const { resetHour, resetMinute } = parseResetTime(resetTime);
  const currentBoundary = getMostRecentResetBoundary(Date.now(), resetHour, resetMinute);
  return lastUpdated < currentBoundary;
};

// Start tracking time for current site (simplified - notifies background worker)
const startTimeTracking = async (timeLimit: number) => {
  currentSiteKey = getCurrentSiteKey();

  // Get existing time data
  const result = await safeStorageGet(['siteTimeData']);
  if (!result) return; // Extension reloaded

  const siteTimeData = result.siteTimeData || {};

  // Initialize time tracking for this site if not exists
  if (!siteTimeData[currentSiteKey]) {
    siteTimeData[currentSiteKey] = {
      timeSpent: 0,
      timeLimit: timeLimit,
      lastUpdated: Date.now()
    };
  } else {
    // Update time limit if provided
    siteTimeData[currentSiteKey].timeLimit = timeLimit;
  }

  const success = await safeStorageSet({ siteTimeData });
  if (!success) return; // Extension reloaded

  // Show timer badge
  await showTimerBadge(siteTimeData[currentSiteKey].timeSpent, timeLimit);

  // Notify background worker if tab is visible
  if (!document.hidden) {
    await safeSendMessage({
      action: 'tab-focused',
      siteKey: currentSiteKey,
      url: window.location.href
    });
  }
};

// Get debug info for the debug panel
const getDebugInfo = async () => {
  const isVisible = !document.hidden && document.visibilityState === 'visible';
  const isStale = !isExtensionContextValid();
  const normalizedHostname = currentSiteKey || getCurrentSiteKey();
  const storage = await safeStorageGet(['siteRuleIds', 'compiledRules', 'siteTimeData']);
  const siteRuleIds: Record<string, string[]> = storage?.siteRuleIds || {};
  const compiledRules: Record<string, {
    ruleType: 'hard' | 'soft' | 'session';
    timeLimit: number;
    plusOnes?: number;
    plusOneDuration?: number;
    siteKeys: string[];
    ruleName?: string;
  }> = storage?.compiledRules || {};
  const siteTimeData: Record<string, { timeSpent: number }> = storage?.siteTimeData || {};
  const selectedRuleId = getMostRestrictiveRuleIdForSite(normalizedHostname, siteRuleIds, compiledRules);

  type ApplicableLimitItem = {
    ruleId: string;
    ruleName?: string;
    ruleType: 'hard' | 'soft' | 'session';
    plusOnes?: number;
    plusOneDuration?: number;
    totalAllowedTime: number;
    timeLimit: number;
    timeSpent: number;
    siteBreakdown: Array<{ siteKey: string; timeSpent: number }>;
  };

  const applicableLimits: ApplicableLimitItem[] = (selectedRuleId ? [selectedRuleId] : [])
    .map((ruleId): ApplicableLimitItem | null => {
      const rule = compiledRules[ruleId];
      if (!rule) return null;
      const siteBreakdown = rule.siteKeys
        .map((siteKey) => ({
          siteKey,
          timeSpent: siteTimeData[siteKey]?.timeSpent || 0
        }))
        .sort((a, b) => b.timeSpent - a.timeSpent);
      const timeSpent = siteBreakdown.reduce((sum, site) => sum + site.timeSpent, 0);
      return {
        ruleId,
        ruleName: rule.ruleName,
        ruleType: rule.ruleType,
        plusOnes: rule.plusOnes,
        plusOneDuration: rule.plusOneDuration,
        totalAllowedTime: getTotalAllowedSeconds(rule),
        timeLimit: rule.timeLimit,
        timeSpent,
        siteBreakdown,
      };
    })
    .filter((rule): rule is ApplicableLimitItem => rule !== null)
    .sort((a, b) => b.timeSpent - a.timeSpent);

  return {
    currentUrl: window.location.href,
    normalizedHostname,
    instanceId: 'N/A (managed by background)',
    isActiveTimer: false, // Timer managed by background worker now
    isTabVisible: isVisible,
    isStaleTab: isStale,
    applicableLimits
  };
};

const setNearLimitOverlayVisible = (isVisible: boolean) => {
  if (isVisible) {
    if (!nearLimitOverlayStyle) {
      nearLimitOverlayStyle = document.createElement('style');
      nearLimitOverlayStyle.id = 'near-limit-overlay-style';
      nearLimitOverlayStyle.textContent = `
        @keyframes near-limit-edge-pulse {
          0% { opacity: 0.35; }
          100% { opacity: 0.85; }
        }
      `;
      document.head.appendChild(nearLimitOverlayStyle);
    }

    if (!nearLimitOverlay) {
      nearLimitOverlay = document.createElement('div');
      nearLimitOverlay.id = 'near-limit-overlay';
      nearLimitOverlay.style.position = 'fixed';
      nearLimitOverlay.style.inset = '0';
      nearLimitOverlay.style.pointerEvents = 'none';
      nearLimitOverlay.style.zIndex = '999995';
      nearLimitOverlay.style.background = `
        radial-gradient(120% 70% at 50% -20%, rgba(239,68,68,0.45) 0%, rgba(239,68,68,0) 60%),
        radial-gradient(120% 70% at 50% 120%, rgba(239,68,68,0.45) 0%, rgba(239,68,68,0) 60%),
        linear-gradient(to right, rgba(239,68,68,0.38) 0%, rgba(239,68,68,0) 20%, rgba(239,68,68,0) 80%, rgba(239,68,68,0.38) 100%)
      `;
      nearLimitOverlay.style.animation = 'near-limit-edge-pulse 280ms ease-in-out infinite alternate';
      document.body.appendChild(nearLimitOverlay);
    }
    return;
  }

  if (nearLimitOverlay) {
    nearLimitOverlay.remove();
    nearLimitOverlay = null;
  }
};

const getTutorialSpotlightRect = (): { top: number; left: number; width: number; height: number } | null => {
  if (!timerBadgeWrapper) return null;

  const rect = timerBadgeWrapper.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const padding = 8;
  const left = Math.max(8, rect.left + 20 - padding);
  const top = Math.max(8, rect.top + 20 - padding);
  const right = Math.min(window.innerWidth - 8, rect.right - 20 + padding);
  const bottom = Math.min(window.innerHeight - 8, rect.bottom - 20 + padding);

  return {
    top,
    left,
    width: Math.max(24, right - left),
    height: Math.max(24, bottom - top),
  };
};

const closeTutorialBadgeSpotlight = () => {
  isTutorialBadgeSpotlightOpening = false;
  if (tutorialBadgeSpotlightContainer) {
    tutorialBadgeSpotlightContainer.remove();
    tutorialBadgeSpotlightContainer = null;
  }
};

const getTutorialBadgeStepState = async (): Promise<TutorialInstagramBadgeStepState> => {
  const storage = await safeStorageGet([TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]);
  const state = storage?.[TUTORIAL_INSTAGRAM_BADGE_STEP_KEY];
  return state && typeof state === 'object' ? state as TutorialInstagramBadgeStepState : {};
};

const isCurrentTutorialInstagramTab = async (stepState: TutorialInstagramBadgeStepState): Promise<boolean> => {
  if (typeof stepState.tabId !== 'number') return true;

  const response = await safeSendMessage({ action: 'get-current-tab-id' });
  return response?.tabId === stepState.tabId;
};

const showTutorialBadgeSpotlight = async () => {
  if (tutorialBadgeSpotlightContainer || isTutorialBadgeSpotlightOpening || getCurrentSiteKey() !== 'instagram.com') return;

  const rect = getTutorialSpotlightRect();
  if (!rect) return;
  isTutorialBadgeSpotlightOpening = true;

  const stepState = await getTutorialBadgeStepState();
  if (!(await isCurrentTutorialInstagramTab(stepState))) {
    isTutorialBadgeSpotlightOpening = false;
    return;
  }

  const success = await safeStorageSet({
    [TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]: {
      ...stepState,
      status: 'showing',
      updatedAt: new Date().toISOString(),
      url: window.location.href,
    },
  });
  if (!success) {
    isTutorialBadgeSpotlightOpening = false;
    return;
  }

  tutorialBadgeSpotlightContainer = document.createElement('div');
  tutorialBadgeSpotlightContainer.id = 'intention-tutorial-badge-spotlight';
  const shadowRoot = tutorialBadgeSpotlightContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      color-scheme: dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .layer {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
    }
    .dim {
      position: fixed;
      background: rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(1.5px);
    }
    .spotlight {
      position: fixed;
      border: 1px solid rgba(110, 231, 183, 0.92);
      border-radius: 12px;
      box-shadow:
        0 0 0 1px rgba(16, 185, 129, 0.28),
        0 0 34px rgba(16, 185, 129, 0.28);
      animation: badge-spotlight-pulse 1100ms ease-in-out infinite alternate;
    }
    .card {
      position: fixed;
      width: min(328px, calc(100vw - 32px));
      box-sizing: border-box;
      border: 1px solid rgba(110, 231, 183, 0.55);
      border-radius: 14px;
      background: rgba(9, 9, 11, 0.96);
      color: white;
      padding: 16px;
      box-shadow:
        0 0 0 1px rgba(16, 185, 129, 0.18),
        0 22px 68px rgba(0, 0, 0, 0.54);
      pointer-events: auto;
    }
    .header {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
    }
    .icon {
      display: flex;
      width: 34px;
      height: 34px;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border: 1px solid rgba(52, 211, 153, 0.38);
      border-radius: 10px;
      background: rgba(52, 211, 153, 0.12);
      color: #a7f3d0;
    }
    .eyebrow {
      margin: 0;
      color: rgba(167, 243, 208, 0.88);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      line-height: 1.1;
      text-transform: uppercase;
    }
    .title {
      margin: 3px 0 0;
      color: #fff;
      font-size: 17px;
      font-weight: 750;
      line-height: 1.16;
    }
    .body {
      margin: 0;
      color: #d4d4d8;
      font-size: 14px;
      line-height: 1.45;
    }
    .button {
      display: flex;
      width: 100%;
      height: 40px;
      align-items: center;
      justify-content: center;
      margin-top: 14px;
      border: 1px solid rgba(52, 211, 153, 0.8);
      border-radius: 10px;
      background: #5eead4;
      color: #09090b;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 750;
      transition: background 150ms ease;
    }
    .button:hover {
      background: #99f6e4;
    }
    @keyframes badge-spotlight-pulse {
      from { opacity: 0.72; transform: scale(0.992); }
      to { opacity: 1; transform: scale(1.012); }
    }
  `;

  const layer = document.createElement('div');
  layer.className = 'layer';
  const topDim = document.createElement('div');
  const bottomDim = document.createElement('div');
  const leftDim = document.createElement('div');
  const rightDim = document.createElement('div');
  const spotlight = document.createElement('div');
  const card = document.createElement('section');

  topDim.className = 'dim';
  bottomDim.className = 'dim';
  leftDim.className = 'dim';
  rightDim.className = 'dim';
  spotlight.className = 'spotlight';
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Timer badge tutorial');
  card.innerHTML = `
    <div class="header">
      <div class="icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2"/>
        </svg>
      </div>
      <div>
        <p class="eyebrow">Step 2 of 8</p>
        <h2 class="title">That is your timer badge</h2>
      </div>
    </div>
    <p class="body">It follows the whole Social Media Daily Limit. Time spent here rolls up with the other social sites in the rule.</p>
    <button class="button" type="button">Got it</button>
  `;

  const updateLayout = () => {
    const nextRect = getTutorialSpotlightRect();
    if (!nextRect) return;

    topDim.style.cssText = `left:0;right:0;top:0;height:${nextRect.top}px;`;
    bottomDim.style.cssText = `left:0;right:0;top:${nextRect.top + nextRect.height}px;bottom:0;`;
    leftDim.style.cssText = `left:0;top:${nextRect.top}px;width:${nextRect.left}px;height:${nextRect.height}px;`;
    rightDim.style.cssText = `left:${nextRect.left + nextRect.width}px;right:0;top:${nextRect.top}px;height:${nextRect.height}px;`;
    spotlight.style.cssText = `left:${nextRect.left}px;top:${nextRect.top}px;width:${nextRect.width}px;height:${nextRect.height}px;`;

    const cardWidth = Math.min(328, window.innerWidth - 32);
    const cardLeft = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, nextRect.left - cardWidth - 14));
    const placeBelow = nextRect.top + nextRect.height + 166 < window.innerHeight;
    const cardTop = placeBelow
      ? nextRect.top + nextRect.height + 14
      : Math.max(16, nextRect.top - 166);
    card.style.left = `${cardLeft}px`;
    card.style.top = `${cardTop}px`;
  };

  const finishStep = async () => {
    closeTutorialBadgeSpotlight();
    const stepState = await getTutorialBadgeStepState();
    const didStoreCompletion = await safeStorageSet({
      [TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]: {
        ...stepState,
        status: 'completed',
        updatedAt: new Date().toISOString(),
        url: window.location.href,
      },
    });

    if (didStoreCompletion) {
      await safeSendMessage({ action: 'close-tutorial-instagram-tab' });
    }
  };

  card.querySelector<HTMLButtonElement>('.button')?.addEventListener('click', () => {
    void finishStep().catch((error) => reportAsyncError('tutorial badge spotlight completion', error));
  });

  layer.append(topDim, bottomDim, leftDim, rightDim, spotlight, card);
  shadowRoot.append(style, layer);
  document.body.appendChild(tutorialBadgeSpotlightContainer);
  isTutorialBadgeSpotlightOpening = false;
  updateLayout();

  const intervalId = window.setInterval(updateLayout, 180);
  const cleanupObserver = new MutationObserver(() => {
    if (!tutorialBadgeSpotlightContainer) {
      window.clearInterval(intervalId);
      cleanupObserver.disconnect();
    }
  });
  cleanupObserver.observe(document.body, { childList: true });
};

const showTutorialBadgeSpotlightIfNeeded = async () => {
  const stepState = await getTutorialBadgeStepState();
  const status = stepState.status;
  if (status !== 'armed' && status !== 'showing') return;
  if (!(await isCurrentTutorialInstagramTab(stepState))) return;
  await showTutorialBadgeSpotlight();
};

// Render the container with both timer badge and debug panel
const renderContainer = async (timeSpent?: number, timeLimit?: number) => {
  // Check if container already exists
  let container = document.getElementById('timer-debug-container');

  if (!container) {
    // Create container
    container = document.createElement('div');
    container.id = 'timer-debug-container';

    // Create shadow DOM
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // Create wrapper that will hold drag handle and content
    const wrapper = document.createElement('div');

    // Load saved position from storage
    let savedPosition;
    const POSITION_VERSION = 2; // Increment when position calculation changes

    const storage = await safeStorageGet(['timerPosition']);

    // If extension reloaded or no saved position, use default
    if (!storage) {
      savedPosition = { top: 0, right: 0, version: POSITION_VERSION };
    } else {
      savedPosition = storage.timerPosition;

      // Reset position if it's from old code version (no version field) or invalid
      if (!savedPosition || savedPosition.version !== POSITION_VERSION) {
        console.log('[Timer] Using fresh default position (v2)');
        savedPosition = { top: 0, right: 0, version: POSITION_VERSION };
        await safeStorageSet({ timerPosition: savedPosition });
      } else {
        // Additional validation (reset if out of reasonable bounds)
        const maxTop = window.innerHeight - 100;
        const maxRight = window.innerWidth - 100;

        if (savedPosition.top < 0 || savedPosition.top > maxTop ||
            savedPosition.right < 0 || savedPosition.right > maxRight) {
          console.log('[Timer] Resetting out-of-bounds position');
          savedPosition = { top: 0, right: 0, version: POSITION_VERSION };
          await safeStorageSet({ timerPosition: savedPosition });
        }
      }
    }

    // Add styles to wrapper (flush to edges, padding creates the 20px spacing)
    wrapper.style.cssText = `
      position: fixed;
      top: ${savedPosition.top}px;
      right: ${savedPosition.right}px;
      z-index: 999998;
      cursor: grab;
      user-select: none;
      margin: 0;
      padding: 20px;
    `;
    wrapper.title = 'Drag to reposition';
    timerBadgeWrapper = wrapper;

    // Create content container for React components
    const shadowContainer = document.createElement('div');
    shadowContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    // Make it draggable
    let isDragging = false;
    let didDrag = false;
    let suppressClickUntil = 0;
    let currentX: number;
    let currentY: number;
    let initialX: number;
    let initialY: number;

    const onMouseDown = (e: MouseEvent) => {
      // Get initial mouse position
      initialX = e.clientX;
      initialY = e.clientY;
      didDrag = false;

      // Get current position
      const rect = wrapper.getBoundingClientRect();
      currentX = rect.left;
      currentY = rect.top;

      isDragging = true;
      wrapper.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      e.preventDefault();

      // Calculate new position
      const deltaX = e.clientX - initialX;
      const deltaY = e.clientY - initialY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        didDrag = true;
      }

      const newX = currentX + deltaX;
      const newY = currentY + deltaY;

      // Update position (keep as left/top for easier calculation)
      wrapper.style.left = `${newX}px`;
      wrapper.style.top = `${newY}px`;
      wrapper.style.right = 'auto'; // Remove right positioning
    };

    const onMouseUp = async () => {
      if (!isDragging) return;

      isDragging = false;
      wrapper.style.cursor = 'grab';
      if (didDrag) {
        suppressClickUntil = Date.now() + 250;
      }

      // Save position to storage
      const rect = wrapper.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;

      // Calculate right offset (distance from right edge)
      const rightOffset = viewportWidth - rect.right;
      const topOffset = rect.top;

      // Re-anchor to right so future width expansion grows leftward.
      wrapper.style.left = 'auto';
      wrapper.style.right = `${rightOffset}px`;
      wrapper.style.top = `${topOffset}px`;

      const success = await safeStorageSet({
        timerPosition: {
          top: topOffset,
          right: rightOffset
        }
      });

      if (success) {
        console.log('[Timer] Position saved:', { top: rect.top, right: rightOffset });
      }
    };

    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() <= suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    wrapper.addEventListener('mousedown', onMouseDown);
    wrapper.addEventListener('click', onClickCapture, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Build DOM structure: wrapper > shadowContainer
    wrapper.appendChild(shadowContainer);
    shadowRoot.appendChild(wrapper);
    document.body.appendChild(container);

    // Create React root
    containerRoot = createRoot(shadowContainer);
  }

  // Get debug info
  const debugInfo = await getDebugInfo();
  const relevantLimit = debugInfo.applicableLimits[0];

  const reminderStorage = await safeStorageGet(['upcomingLimitReminderSeconds']);
  const reminderSeconds = clampReminderSeconds(reminderStorage?.upcomingLimitReminderSeconds);

  const operativeSpent = relevantLimit?.timeSpent ?? timeSpent ?? 0;
  let reminderTarget = relevantLimit?.timeLimit ?? timeLimit ?? 0;

  // Soft rules should warn before the NEXT soft boundary (base limit, then each extension step).
  if (relevantLimit?.ruleType === 'soft') {
    const baseLimit = relevantLimit.timeLimit;
    const plusOneDuration = relevantLimit.plusOneDuration || 0;
    const plusOnes = Math.max(0, relevantLimit.plusOnes || 0);

    if (plusOneDuration > 0 && plusOnes > 0) {
      if (operativeSpent < baseLimit) {
        reminderTarget = baseLimit;
      } else {
        const elapsedAfterBase = operativeSpent - baseLimit;
        const usedExtensions = Math.max(0, Math.floor(elapsedAfterBase / plusOneDuration));
        const nextBoundaryStep = Math.min(usedExtensions + 1, plusOnes);
        reminderTarget = baseLimit + (nextBoundaryStep * plusOneDuration);
      }
    } else {
      reminderTarget = baseLimit;
    }
  }

  const remaining = reminderTarget - operativeSpent;
  const isNearLimit = reminderTarget > 0 && remaining > 0 && remaining <= reminderSeconds;
  setNearLimitOverlayVisible(isNearLimit);

  // Render both components
  const components = [];

  // Add timer badge if we have time data
  if (timeSpent !== undefined && timeLimit !== undefined) {
    components.push(
      React.createElement(TimerBadge, {
        key: 'timer',
        timeSpent: timeSpent,
        timeLimit: timeLimit,
        isNearLimit,
        currentSiteKey: debugInfo.normalizedHostname,
        relevantLimit
      })
    );
  }

  // Add debug panel if DEBUG_UI is enabled
  if (DEBUG_UI) {
    components.push(
      React.createElement(DebugPanel, {
        key: 'debug',
        debugInfo: debugInfo
      })
    );
  }

  // Render the components
  if (containerRoot && components.length > 0) {
    containerRoot.render(React.createElement(React.Fragment, null, ...components));
    await showTutorialBadgeSpotlightIfNeeded();
  }
};

// Show timer badge (now part of the container)
const showTimerBadge = async (timeSpent: number, timeLimit: number) => {
  await renderContainer(timeSpent, timeLimit);
};

// Update timer badge display (now updates the whole container)
const updateTimerBadge = async (timeSpent: number, timeLimit: number) => {
  await renderContainer(timeSpent, timeLimit);
};

// Show debug panel on its own (when there's no timer)
const showDebugPanel = async () => {
  if (DEBUG_UI) {
    setNearLimitOverlayVisible(false);
    await renderContainer();
  }
};

// Check if we should show timer badge (site is in list)
const checkAndShowTimer = async () => {
  try {
    const currentDomain = getCurrentSiteKey();
    const rulesResult = await safeStorageGet(['siteRules']);
    if (!rulesResult) return; // Extension reloaded
    const siteRules: Record<string, StoredSiteRule> = rulesResult.siteRules || {};

    const ruleData = siteRules[currentDomain];

    if (ruleData) {
      const result = await safeStorageGet(['siteTimeData']);
      if (!result) return; // Extension reloaded
      const siteTimeData = result.siteTimeData || {};
      const siteData = siteTimeData[currentDomain];

      if (siteData) {
        // Start tracking and show badge
        startTimeTracking(siteData.timeLimit);
      }
    }
  } catch (error) {
    console.error('Error checking timer:', error);
  }
};

// Show the intention popup using React
const showIntentionPopup = () => {
  // Check if popup already exists
  if (document.getElementById('intention-popup-container')) {
    return;
  }

  // Create container for React app
  const container = document.createElement('div');
  container.id = 'intention-popup-container';

  // Create shadow DOM to isolate styles
  const shadowRoot = container.attachShadow({ mode: 'open' });
  const shadowContainer = document.createElement('div');
  shadowRoot.appendChild(shadowContainer);

  // Append to body
  document.body.appendChild(container);

  // Handle continue
  const handleContinue = async (timeLimit: number, intention: string) => {
    if (intention) {
      // Save intention
      await safeSendMessage({
        action: 'saveIntention',
        intention: intention,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        timeLimit: timeLimit
      });
    }

    // Remove popup and resume videos
    root.unmount();
    container.remove();
    resumeAllMedia();

    // Start time tracking
    await startTimeTracking(timeLimit);
  };

  // Handle cancel
  const handleCancel = () => {
    root.unmount();
    container.remove();
    // Navigate back
    window.history.back();
  };

  // Render React component
  const root = createRoot(shadowContainer);
  root.render(
    React.createElement(IntentionPopup, {
      onContinue: handleContinue,
      onCancel: handleCancel
    })
  );
};

const closeSoftLimitPopup = () => {
  if (softLimitRoot) {
    softLimitRoot.unmount();
    softLimitRoot = null;
  }

  if (softLimitContainer) {
    softLimitContainer.remove();
    softLimitContainer = null;
  }
};

const showSoftLimitPopup = (
  ruleId: string,
  derivedRemainingSnoozes: number,
  plusOneDuration: number
) => {
  closeSoftLimitPopup();
  pauseAllMedia();

  softLimitContainer = document.createElement('div');
  softLimitContainer.id = 'soft-limit-popup-container';

  const shadowRoot = softLimitContainer.attachShadow({ mode: 'open' });
  const shadowContainer = document.createElement('div');
  shadowRoot.appendChild(shadowContainer);
  document.body.appendChild(softLimitContainer);

  const handleSnooze = async () => {
    const siteKey = currentSiteKey || getCurrentSiteKey();
    const result = await safeSendMessage({
      action: 'soft-limit-snooze',
      ruleId,
      siteKey
    });

    if (result?.success) {
      closeSoftLimitPopup();
      resumeAllMedia();
      return;
    }

    console.error('[SoftLimit] Snooze failed:', result?.error || 'Unknown error');
  };

  const handleLeave = async () => {
    await safeSendMessage({ action: 'soft-limit-leave' });
    closeSoftLimitPopup();
  };

  softLimitRoot = createRoot(shadowContainer);
  softLimitRoot.render(
    React.createElement(SoftLimitPopup, {
      derivedRemainingSnoozes,
      plusOneDuration,
      onSnooze: () => {
        void handleSnooze();
      },
      onLeave: () => {
        void handleLeave();
      }
    })
  );
};

// Listen for storage changes to update badge in real-time
chrome.storage.onChanged.addListener((changes) => {
  void (async () => {
    if (changes.siteRules) {
      // Site rules updated, could trigger re-check if needed
    }

    if (changes[TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]) {
      const status = changes[TUTORIAL_INSTAGRAM_BADGE_STEP_KEY].newValue?.status;
      if (status === 'armed' || status === 'showing') {
        await showTutorialBadgeSpotlightIfNeeded();
      } else {
        closeTutorialBadgeSpotlight();
      }
    }

    const shouldRefreshForDebug = !!(
      changes.siteRuleIds ||
      changes.compiledRules ||
      changes.ruleUsageData
    );

    // If siteTimeData changes and we're not the active tab, update our display
    if ((changes.siteTimeData || shouldRefreshForDebug) && currentSiteKey && !document.hidden) {
      const newData = changes.siteTimeData?.newValue || {};
      const siteData = newData[currentSiteKey];
      if (siteData && containerRoot) {
        await updateTimerBadge(siteData.timeSpent, siteData.timeLimit);
      } else if (DEBUG_UI && containerRoot) {
        // Update debug panel even if no timer data
        await showDebugPanel();
      }
    }
  })().catch((error) => reportAsyncError('storage.onChanged handler', error));
});

// Listen for messages from background worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    console.log('[Content] Extension context invalidated - ignoring message');
    return false;
  }

  console.log('[Content] Message received:', message);

  if (message.action === 'show-soft-limit-popup') {
    const ruleId = message.ruleId as string | undefined;
    const derivedRemainingSnoozes = Number(message.derivedRemainingSnoozes || 0);
    const plusOneDuration = Number(message.plusOneDuration || 0);

    if (!ruleId) {
      sendResponse({ handled: false, error: 'Missing ruleId' });
      return false;
    }

    showSoftLimitPopup(ruleId, derivedRemainingSnoozes, plusOneDuration);
    sendResponse({ handled: true });
    return false;
  }

  if (message.action === 'get-current-site') {
    (async () => {
      const storage = await safeStorageGet(['siteRules']);
      const siteRules = storage?.siteRules || {};
      const hasSiteRule = !!siteRules[currentSiteKey || ''];

      sendResponse({
        siteKey: currentSiteKey,
        url: window.location.href,
        hasSiteRule: hasSiteRule
      });
    })();
    return true; // Will respond asynchronously
  }
});

// Listen for visibility changes - notify background worker
const handleVisibilityChange = async () => {
  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    console.log('[Timer] Extension context invalidated - skipping visibility change');
    return;
  }

  console.log('[Timer] ⚠️ VISIBILITY CHANGED EVENT FIRED');
  console.log('[Timer] document.hidden:', document.hidden);
  console.log('[Timer] document.visibilityState:', document.visibilityState);
  console.log('[Timer] currentSiteKey:', currentSiteKey);

  const isHidden = document.hidden || document.visibilityState === 'hidden';

  if (!currentSiteKey) {
    console.log('[Timer] No currentSiteKey, skipping visibility change handling');
    return;
  }

  if (isHidden) {
    // Tab is now hidden - notify background to stop timer
    console.log('[Timer] 🔽 Tab hidden - notifying background');
    await safeSendMessage({
      action: 'tab-blurred',
      siteKey: currentSiteKey
    });
  } else {
    // Tab is now visible - notify background to start timer
    console.log('[Timer] 🔼 Tab visible - notifying background');
    await safeSendMessage({
      action: 'tab-focused',
      siteKey: currentSiteKey,
      url: window.location.href
    });
  }

  // Update UI to reflect changes
  if (containerRoot) {
    const result = await safeStorageGet(['siteTimeData']);
    if (!result) return; // Extension reloaded

    const siteTimeData = result.siteTimeData || {};
    const siteData = currentSiteKey ? siteTimeData[currentSiteKey] : null;

    if (siteData) {
      await updateTimerBadge(siteData.timeSpent, siteData.timeLimit);
    } else if (DEBUG_UI) {
      await showDebugPanel();
    }
  }

  console.log('[Timer] ✓ Visibility change handling complete');
};

document.addEventListener('visibilitychange', handleVisibilityChange);
console.log('[Timer] ✓ Visibility change listener attached');

// FALLBACK: Poll visibility every 500ms in case visibilitychange doesn't fire (some sites block it)
let lastVisibilityState = document.hidden;
setInterval(() => {
  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    return; // Silently ignore if extension was reloaded
  }

  const currentVisibilityState = document.hidden;

  // If state changed but event didn't fire, manually trigger
  if (currentVisibilityState !== lastVisibilityState) {
    console.log('[Timer] 🔄 POLLING DETECTED VISIBILITY CHANGE (event did not fire!)');
    console.log('[Timer] Was hidden:', lastVisibilityState, '→ Now hidden:', currentVisibilityState);
    lastVisibilityState = currentVisibilityState;
    void handleVisibilityChange().catch((error) => reportAsyncError('visibility poll handler', error));
  }
}, 500);

// Initialize on page load
const initialize = async () => {
  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    console.log('[Init] Extension context invalidated - skipping initialization');
    return;
  }

  await checkAndShowIntentionPopup();
  await checkAndShowTimer();
  // Show debug panel if DEBUG_UI is enabled (even if no timer)
  await showDebugPanel();
};

// Run check when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initialize().catch((error) => reportAsyncError('DOMContentLoaded initialize', error));
  });
} else {
  void initialize().catch((error) => reportAsyncError('immediate initialize', error));
}

// Also run on navigation (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    return; // Silently ignore if extension was reloaded
  }

  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;

    const previousSiteKey = currentSiteKey;
    const newSiteKey = getCurrentSiteKey();

    console.log('[Timer] URL changed:', lastUrl, '→', url);
    console.log('[Timer] Site key:', previousSiteKey, '→', newSiteKey);

    // If site changed (different domain), notify background
    if (previousSiteKey && previousSiteKey !== newSiteKey) {
      void safeSendMessage({
        action: 'tab-navigated',
        previousSiteKey: previousSiteKey,
        newSiteKey: newSiteKey,
        url: url
      }).catch((error) => reportAsyncError('tab-navigated message', error));
    }

    // Re-initialize UI
    void initialize().catch((error) => reportAsyncError('mutation initialize', error));
  }
}).observe(document, { subtree: true, childList: true });

// STALE TAB DETECTION: Poll every second to detect if extension was reloaded
setInterval(() => {
  isExtensionContextValid(); // Will auto-reload if stale
}, 1000);

window.addEventListener('unhandledrejection', (event) => {
  if (isContextInvalidationError(event.reason)) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  if (isContextInvalidationError(event.error ?? event.message)) {
    event.preventDefault();
  }
});
