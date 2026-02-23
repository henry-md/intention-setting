import "./firebase-config";
import { format } from 'date-fns';
import { doc, setDoc } from 'firebase/firestore';
import { ALLOW_CUSTOM_RESET_TIME, DEFAULT_DAILY_RESET_TIME } from '../constants';
import { db } from '../utils/firebase';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import { formatDateWithTimezone, getTimezoneAbbreviation } from '../utils/timezone';

// Test imports
const testDate = new Date();
console.log('Hello from background.ts @', format(testDate, 'yyyy-MM-dd HH:mm:ss'));

// ============================================================================
// TIMER STATE MANAGEMENT
// ============================================================================

interface ActiveTimerState {
  tabId: number;
  siteKey: string;
  startedAt: number;
  intervalId: NodeJS.Timeout | null;
}

interface SiteTimeData {
  timeSpent: number;
  timeLimit: number;
  lastUpdated: number;
}

interface SiteRules {
  [siteKey: string]: {
    ruleType: 'hard' | 'soft' | 'session';
    timeLimit: number;
    ruleId: string;
    plusOnes?: number;
    plusOneDuration?: number;
  };
}

interface SiteRuleIds {
  [siteKey: string]: string[];
}

interface CompiledRules {
  [ruleId: string]: {
    ruleType: 'hard' | 'soft' | 'session';
    timeLimit: number;
    plusOnes?: number;
    plusOneDuration?: number;
    siteKeys: string[];
  };
}

interface RuleUsageData {
  [ruleId: string]: {
    timeSpent: number;
    lastUpdated: number;
    snoozesUsed: number;
  };
}

interface ExceededRuleInfo {
  ruleId: string;
  rule: {
    ruleType: 'hard' | 'soft' | 'session';
    timeLimit: number;
    plusOnes?: number;
    plusOneDuration?: number;
    siteKeys: string[];
  };
  usage: {
    timeSpent: number;
    lastUpdated: number;
    snoozesUsed: number;
  };
  effectiveLimit: number;
  remainingOneMores: number;
}

let activeTimer: ActiveTimerState | null = null;
let syncIntervalId: NodeJS.Timeout | null = null;
let secondsCounter = 0;
let lastTickTimestamp: number | null = null; // Track last tick time for reset boundary detection

const TIMER_TICK_INTERVAL = 1000;  // 1 second
const FIRESTORE_SYNC_INTERVAL = 5000;  // 5 seconds

async function hydrateCompiledRuleIndexes(): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(['user']);
    const userId = storage.user?.uid;

    if (!userId) {
      console.log('[Timer] No user found - skipping rule index hydration');
      return;
    }

    await syncRulesToStorage(userId);
    console.log('[Timer] ✓ Rule indexes hydrated');
  } catch (error) {
    console.error('[Timer] Failed to hydrate rule indexes:', error);
  }
}

async function redirectTabToRandomUrl(tabId: number): Promise<boolean> {
  const redirectStorage = await chrome.storage.local.get(['redirectUrls']);
  const redirectUrls: string[] = redirectStorage.redirectUrls || [];

  if (redirectUrls.length === 0) {
    console.log('[Timer] No redirect URLs configured - limit exceeded but not redirecting');
    return false;
  }

  const randomIndex = Math.floor(Math.random() * redirectUrls.length);
  const redirectUrl = redirectUrls[randomIndex];
  console.log(`[Timer] Redirecting to: ${redirectUrl}`);

  try {
    await chrome.tabs.update(tabId, { url: redirectUrl });
    console.log(`[Timer] ✓ Redirected tab ${tabId} to ${redirectUrl}`);
    return true;
  } catch (error) {
    console.error('[Timer] Failed to redirect tab:', error);
    return false;
  }
}

async function showSoftLimitPopup(tabId: number, siteKey: string, exceededRule: ExceededRuleInfo): Promise<boolean> {
  if (exceededRule.rule.ruleType !== 'soft') return false;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'show-soft-limit-popup',
      siteKey,
      ruleId: exceededRule.ruleId,
      remainingOneMores: exceededRule.remainingOneMores,
      plusOneDuration: exceededRule.rule.plusOneDuration || 0
    });

    return !!response?.handled;
  } catch (error) {
    console.error('[Timer] Failed to show soft-limit popup in content script:', error);
    return false;
  }
}

// ============================================================================
// DAILY RESET LOGIC
// ============================================================================

/**
 * Calculates the most recent reset boundary timestamp for a given time.
 *
 * @param timestamp - The timestamp to check
 * @param resetHour - Hour of day for reset (0-23)
 * @param resetMinute - Minute of hour for reset (0-59)
 * @returns The timestamp of the most recent reset boundary
 */
function getMostRecentResetBoundary(timestamp: number, resetHour: number, resetMinute: number): number {
  const date = new Date(timestamp);

  // Create today's reset time
  const todayReset = new Date(date);
  todayReset.setHours(resetHour, resetMinute, 0, 0);

  // If current time is before today's reset, the boundary is yesterday's reset
  if (date < todayReset) {
    const yesterdayReset = new Date(todayReset);
    yesterdayReset.setDate(yesterdayReset.getDate() - 1);
    return yesterdayReset.getTime();
  }

  // Otherwise, the boundary is today's reset
  return todayReset.getTime();
}

/**
 * Resets all site time tracking to 0.
 * Called when we cross a daily reset boundary.
 */
async function resetAllSiteTime(userId: string | null): Promise<void> {
  console.log('[DailyReset] ✓✓✓ CROSSING RESET BOUNDARY - Resetting all site time to 0 ✓✓✓');

  try {
    const storage = await chrome.storage.local.get(['siteTimeData', 'ruleUsageData']);
    const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
    const ruleUsageData: RuleUsageData = storage.ruleUsageData || {};
    const now = Date.now();

    // Reset all time spent values to 0
    const resetSiteTimeData: Record<string, SiteTimeData> = {};
    for (const siteKey in siteTimeData) {
      resetSiteTimeData[siteKey] = {
        ...siteTimeData[siteKey],
        timeSpent: 0,
        lastUpdated: now
      };
    }

    const resetRuleUsageData: RuleUsageData = {};
    for (const ruleId in ruleUsageData) {
      resetRuleUsageData[ruleId] = {
        ...ruleUsageData[ruleId],
        timeSpent: 0,
        lastUpdated: now,
        snoozesUsed: 0
      };
    }

    // Save to chrome storage
    await chrome.storage.local.set({
      siteTimeData: resetSiteTimeData,
      ruleUsageData: resetRuleUsageData,
      lastResetTimestamp: now
    });

    console.log('[DailyReset] ✓ All site times reset to 0 in local storage');

    // Also sync to Firestore if user is logged in
    if (userId) {
      const userDocRef = doc(db, 'users', userId);
      const timeTrackingData: Record<string, SiteTimeData> = {};
      for (const siteKey in resetSiteTimeData) {
        timeTrackingData[siteKey] = resetSiteTimeData[siteKey];
      }

      setDoc(userDocRef, {
        timeTracking: timeTrackingData,
        lastDailyResetTimestamp: now
      }, { merge: true }).catch((error) => {
        console.error('[DailyReset] Error syncing reset to Firestore:', error);
      });

      console.log('[DailyReset] ✓ Reset synced to Firestore');
    }
  } catch (error) {
    console.error('[DailyReset] Error resetting site time:', error);
  }
}

// ============================================================================
// CORE TIMER FUNCTIONS
// ============================================================================

/**
 * Syncs accumulated time to Firestore.
 * Called every 5 seconds by syncInterval or immediately on timer stop.
 */
async function syncToFirestore(): Promise<void> {
  if (!activeTimer || secondsCounter === 0) {
    return;
  }

  const { siteKey } = activeTimer;

  console.log(`[Timer] Syncing ${secondsCounter}s to Firestore for ${siteKey}`);

  try {
    // Get user and time data
    const storage = await chrome.storage.local.get(['user', 'siteTimeData']);
    const user = storage.user;
    const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};

    if (!user?.uid || !siteTimeData[siteKey]) {
      console.log('[Timer] Cannot sync - no user or site data');
      return;
    }

    // Write directly to Firestore
    const userDocRef = doc(db, 'users', user.uid);
    console.log(`[Timer] Writing to Firestore: users/${user.uid}/timeTracking/${siteKey}`, siteTimeData[siteKey]);

    await setDoc(userDocRef, {
      timeTracking: {
        [siteKey]: siteTimeData[siteKey]
      }
    }, { merge: true });

    secondsCounter = 0;
    console.log('[Timer] ✓ Firestore sync complete - data written successfully');
  } catch (error) {
    console.error('[Timer] Firestore sync failed (will retry):', error);
    // Don't reset counter - will retry on next interval
  }
}

/**
 * Called every second by the timer interval.
 * This is the ONLY place where time is incremented.
 * Also checks for daily reset boundary crossing on each tick.
 */
async function timerTick(): Promise<void> {
  // Capture current timer state at start of tick to avoid race conditions
  const currentTimer = activeTimer;

  if (!currentTimer) {
    console.error('[Timer] timerTick called but no active timer!');
    return;
  }

  const tickStartTime = Date.now();
  const currentTickTimestamp = Date.now();
  console.log(`[Timer] Tick for tab ${currentTimer.tabId}, site ${currentTimer.siteKey}, interval ID: ${currentTimer.intervalId}`);

  // Verify tab still exists and is active
  try {
    const tab = await chrome.tabs.get(currentTimer.tabId);

    // Stop timer if tab is no longer active
    if (!tab.active) {
      console.log(`[Timer] Tab ${currentTimer.tabId} no longer active, stopping timer`);
      stopCurrentTimer();
      return;
    }
  } catch {
    console.log(`[Timer] Tab ${currentTimer.tabId} no longer exists, stopping timer`);
    stopCurrentTimer();
    return;
  }

  // Check if activeTimer changed during async operations (another timer started)
  if (activeTimer?.intervalId !== currentTimer.intervalId) {
    console.log(`[Timer] Timer changed during tick (old: ${currentTimer.intervalId}, new: ${activeTimer?.intervalId}), aborting this tick`);
    return;
  }

  const { siteKey } = currentTimer;

  // ============================================================================
  // CHECK FOR DAILY RESET BOUNDARY CROSSING
  // ============================================================================
  if (lastTickTimestamp !== null) {
    try {
      const storage = await chrome.storage.local.get(['dailyResetTime', 'user']);
      const resetTime = ALLOW_CUSTOM_RESET_TIME
        ? storage.dailyResetTime || DEFAULT_DAILY_RESET_TIME
        : DEFAULT_DAILY_RESET_TIME;
      const [resetHour, resetMinute] = resetTime.split(':').map(Number);
      const userId = storage.user?.uid || null;

      // Calculate the most recent reset boundary for both timestamps
      const previousBoundary = getMostRecentResetBoundary(lastTickTimestamp, resetHour, resetMinute);
      const currentBoundary = getMostRecentResetBoundary(currentTickTimestamp, resetHour, resetMinute);

      // If boundaries are different, we crossed a reset point
      if (previousBoundary !== currentBoundary) {
        console.log('[Timer] ====== DAILY RESET BOUNDARY CROSSED ======');
        console.log('[Timer] Previous tick:', formatDateWithTimezone(new Date(lastTickTimestamp)));
        console.log('[Timer] Current tick:', formatDateWithTimezone(new Date(currentTickTimestamp)));
        console.log('[Timer] Previous boundary:', formatDateWithTimezone(new Date(previousBoundary)));
        console.log('[Timer] Current boundary:', formatDateWithTimezone(new Date(currentBoundary)));

        // Reset all site time immediately
        await resetAllSiteTime(userId);

        console.log('[Timer] ============================================');
      }
    } catch (error) {
      console.error('[Timer] Error checking reset boundary:', error);
    }
  }

  // Update last tick timestamp
  lastTickTimestamp = currentTickTimestamp;

  // ============================================================================
  // INCREMENT TIME
  // ============================================================================
  const storage = await chrome.storage.local.get(['siteTimeData', 'siteRuleIds', 'compiledRules', 'ruleUsageData']);
  const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
  const siteRuleIds: SiteRuleIds = storage.siteRuleIds || {};
  const compiledRules: CompiledRules = storage.compiledRules || {};
  const ruleUsageData: RuleUsageData = storage.ruleUsageData || {};

  if (siteTimeData[siteKey]) {
    const oldTime = siteTimeData[siteKey].timeSpent;
    siteTimeData[siteKey].timeSpent += 1;
    siteTimeData[siteKey].lastUpdated = currentTickTimestamp;

    const applicableRuleIds = siteRuleIds[siteKey] || [];
    const exceededRules: ExceededRuleInfo[] = [];

    for (const ruleId of applicableRuleIds) {
      const rule = compiledRules[ruleId];
      if (!rule || rule.ruleType === 'session' || rule.timeLimit <= 0) continue;

      const existingUsage = ruleUsageData[ruleId];
      const snoozesUsed = existingUsage?.snoozesUsed || 0;
      const remainingOneMores = Math.max((rule.plusOnes || 0) - snoozesUsed, 0);
      const effectiveLimit = rule.ruleType === 'soft'
        ? rule.timeLimit + (snoozesUsed * (rule.plusOneDuration || 0))
        : rule.timeLimit;
      const totalTimeSpent = rule.siteKeys.reduce((sum, memberSiteKey) => {
        return sum + (siteTimeData[memberSiteKey]?.timeSpent || 0);
      }, 0);
      ruleUsageData[ruleId] = {
        timeSpent: totalTimeSpent,
        lastUpdated: currentTickTimestamp,
        snoozesUsed
      };

      if (totalTimeSpent >= effectiveLimit) {
        exceededRules.push({
          ruleId,
          rule,
          usage: ruleUsageData[ruleId],
          effectiveLimit,
          remainingOneMores
        });
      }
    }

    await chrome.storage.local.set({ siteTimeData, ruleUsageData });

    const tickDuration = Date.now() - tickStartTime;
    console.log(`[Timer] ✓ Incremented ${siteKey}: ${oldTime} → ${siteTimeData[siteKey].timeSpent}s (tick took ${tickDuration}ms)`);

    // Increment Firestore sync counter
    secondsCounter += 1;

    // ============================================================================
    // CHECK TIME LIMIT AND REDIRECT IF EXCEEDED
    // ============================================================================
    const { timeSpent, timeLimit } = siteTimeData[siteKey];
    const siteLimitExceeded = timeLimit > 0 && timeSpent >= timeLimit;
    if (exceededRules.length > 0) {
      const exceededDetails = exceededRules.map((exceeded) => {
        return `${exceeded.ruleId}: ${exceeded.usage.timeSpent}s / ${exceeded.effectiveLimit}s (remaining one-mores: ${exceeded.remainingOneMores})`;
      });
      console.log(`[Timer] ⚠️ Aggregated limit exceeded for ${siteKey}:`, exceededDetails.join(', '));
    } else if (siteLimitExceeded && applicableRuleIds.length === 0) {
      console.log(`[Timer] ⚠️ Site limit exceeded for ${siteKey}: ${timeSpent}s / ${timeLimit}s`);
    }

    const hardExceeded = exceededRules.find((exceeded) => exceeded.rule.ruleType === 'hard');
    const softExceededWithSnooze = exceededRules.find((exceeded) =>
      exceeded.rule.ruleType === 'soft' && exceeded.remainingOneMores > 0
    );
    const softExceededWithoutSnooze = exceededRules.find((exceeded) =>
      exceeded.rule.ruleType === 'soft' && exceeded.remainingOneMores <= 0
    );

    if (hardExceeded || softExceededWithoutSnooze || (siteLimitExceeded && applicableRuleIds.length === 0)) {
      stopCurrentTimer();
      await redirectTabToRandomUrl(currentTimer.tabId);
      return;
    }

    if (softExceededWithSnooze) {
      stopCurrentTimer();
      const didShowPopup = await showSoftLimitPopup(currentTimer.tabId, siteKey, softExceededWithSnooze);
      if (!didShowPopup) {
        await redirectTabToRandomUrl(currentTimer.tabId);
      }
      return;
    }
  } else {
    console.error(`[Timer] No time data for ${siteKey}!`);
  }
}

/**
 * Stops the current timer and clears state.
 * Safe to call even if no timer is running.
 */
function stopCurrentTimer(): void {
  if (!activeTimer) {
    return;
  }

  console.log(`[Timer] Stopping timer - tabId: ${activeTimer.tabId}, site: ${activeTimer.siteKey}`);

  // Clear interval
  if (activeTimer.intervalId) {
    clearInterval(activeTimer.intervalId);
  }

  // Sync remaining seconds to Firestore immediately
  if (secondsCounter > 0) {
    syncToFirestore();  // Don't await - fire and forget
  }

  activeTimer = null;
  lastTickTimestamp = null; // Reset tick timestamp

  // Clear sync interval (no timers running)
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }

  console.log('[Timer] ✓ Timer stopped');
}

/**
 * Starts timer for a specific tab.
 * This is the ONLY function that creates timer intervals.
 * Race-condition safety: Immediately clears any existing interval BEFORE async operations.
 */
async function startTimerForTab(tabId: number, siteKey: string): Promise<void> {
  console.log(`[Timer] Request to start timer - tabId: ${tabId}, site: ${siteKey}`);

  // CRITICAL: IMMEDIATELY clear any existing interval SYNCHRONOUSLY before ANY async operations
  // This prevents race conditions where multiple calls create multiple intervals
  if (activeTimer?.intervalId) {
    console.log(`[Timer] IMMEDIATELY clearing existing interval ID: ${activeTimer.intervalId}`);
    clearInterval(activeTimer.intervalId);
    activeTimer.intervalId = null;
  }

  // Now properly stop and clean up the rest
  if (activeTimer) {
    console.log(`[Timer] Stopping existing timer - tabId: ${activeTimer.tabId}, site: ${activeTimer.siteKey}`);
    stopCurrentTimer();
  }

  // Verify tab still exists and is active
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      console.log(`[Timer] Tab ${tabId} is not active, aborting`);
      return;
    }
  } catch {
    console.log(`[Timer] Tab ${tabId} no longer exists`);
    return;
  }

  // Check if site has a rule
  const storage = await chrome.storage.local.get(['siteRules', 'siteTimeData']);
  const siteRules: SiteRules = storage.siteRules || {};

  if (!siteRules[siteKey]) {
    console.log(`[Timer] Site ${siteKey} has no rule, not starting timer`);
    return;
  }

  // Initialize time data if doesn't exist
  const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
  if (!siteTimeData[siteKey]) {
    siteTimeData[siteKey] = {
      timeSpent: 0,
      timeLimit: siteRules[siteKey].timeLimit,
      lastUpdated: Date.now()
    };
    await chrome.storage.local.set({ siteTimeData });
  }

  // Double-check: One more defensive clear before creating new interval
  // In case another call came in during our async operations
  if (activeTimer?.intervalId) {
    console.log(`[Timer] Defensive clear before creating new interval`);
    clearInterval(activeTimer.intervalId);
  }

  // Initialize last tick timestamp for reset boundary detection
  lastTickTimestamp = Date.now();

  // Create timer state with NEW interval
  activeTimer = {
    tabId,
    siteKey,
    startedAt: Date.now(),
    intervalId: setInterval(() => timerTick(), TIMER_TICK_INTERVAL)
  };

  console.log(`[Timer] ✓ Created new interval ID: ${activeTimer.intervalId} for tab ${tabId}, site ${siteKey}`);

  // Start Firestore sync interval (only ONE for entire extension)
  if (!syncIntervalId) {
    syncIntervalId = setInterval(() => syncToFirestore(), FIRESTORE_SYNC_INTERVAL);
  }

  // Log next reset time for debugging
  try {
    const resetStorage = await chrome.storage.local.get(['dailyResetTime']);
    const resetTime = ALLOW_CUSTOM_RESET_TIME
      ? resetStorage.dailyResetTime || DEFAULT_DAILY_RESET_TIME
      : DEFAULT_DAILY_RESET_TIME;
    const [resetHour, resetMinute] = resetTime.split(':').map(Number);
    const now = new Date();
    const todayReset = new Date();
    todayReset.setHours(resetHour, resetMinute, 0, 0);
    const nextReset = now >= todayReset ? new Date(todayReset.getTime() + 24 * 60 * 60 * 1000) : todayReset;
    const tzAbbr = getTimezoneAbbreviation();
    console.log(`[Timer] Next daily reset: ${formatDateWithTimezone(nextReset)} (${tzAbbr})`);
  } catch (error) {
    console.log('[Timer] Could not calculate next reset time:', error);
  }

  console.log(`[Timer] ✓ Started timer for tab ${tabId}, site ${siteKey}`);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Listen for when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated");
  hydrateCompiledRuleIndexes();
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Handle requests to close a success or cancel tab (tab created after Stripe payment)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background message received:', message);

  if (message.action === 'close-success-tab' || message.action === 'close-cancel-tab') {
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id);
    }
  }

  // ============================================================================
  // TIMER CONTROL MESSAGES
  // ============================================================================

  if (message.action === 'tab-focused') {
    if (sender.tab?.id) {
      startTimerForTab(sender.tab.id, message.siteKey);
    }
    return false;
  }

  if (message.action === 'tab-blurred') {
    if (sender.tab?.id && activeTimer?.tabId === sender.tab.id) {
      stopCurrentTimer();
    }
    return false;
  }

  if (message.action === 'tab-navigated') {
    if (sender.tab?.id) {
      if (activeTimer?.tabId === sender.tab.id) {
        stopCurrentTimer();
      }
      startTimerForTab(sender.tab.id, message.newSiteKey);
    }
    return false;
  }

  if (message.action === 'soft-limit-snooze') {
    (async () => {
      try {
        const ruleId = message.ruleId as string | undefined;
        const siteKey = message.siteKey as string | undefined;
        const tabId = sender.tab?.id;

        if (!ruleId || !siteKey || !tabId) {
          sendResponse({ success: false, error: 'Missing snooze payload' });
          return;
        }

        const storage = await chrome.storage.local.get(['ruleUsageData']);
        const ruleUsageData: RuleUsageData = storage.ruleUsageData || {};
        const now = Date.now();
        const previous = ruleUsageData[ruleId];

        ruleUsageData[ruleId] = {
          timeSpent: previous?.timeSpent || 0,
          lastUpdated: now,
          snoozesUsed: (previous?.snoozesUsed || 0) + 1
        };

        await chrome.storage.local.set({ ruleUsageData });
        console.log(`[Timer] Snooze accepted for ${ruleId}. Snoozes used: ${ruleUsageData[ruleId].snoozesUsed}`);

        await startTimerForTab(tabId, siteKey);
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Timer] Failed to process soft-limit snooze:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message.action === 'soft-limit-leave') {
    (async () => {
      try {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ success: false, error: 'Missing tabId' });
          return;
        }

        if (activeTimer?.tabId === tabId) {
          stopCurrentTimer();
        }
        await redirectTabToRandomUrl(tabId);
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Timer] Failed to process soft-limit leave:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message.action === 'get-current-site') {
    // This is handled by content script responding, but we can also support it from background
    // Not needed for now
    return false;
  }

  // Handle intention saving
  if (message.action === 'saveIntention') {
    const intentionData = {
      intention: message.intention,
      url: message.url,
      timestamp: message.timestamp,
      timeLimit: message.timeLimit
    };

    console.log('Intention saved:', intentionData);

    // Store intention in Chrome storage
    chrome.storage.local.get(['intentions', 'user'], async (result) => {
      const intentions = result.intentions || [];
      intentions.push(intentionData);

      chrome.storage.local.set({ intentions });
      console.log('Intentions stored in local storage:', intentions);

      // Also save to Firestore if user is logged in
      if (result.user?.uid) {
        try {
          const userDocRef = doc(db, 'users', result.user.uid);
          const { arrayUnion } = await import('firebase/firestore');

          await setDoc(userDocRef, {
            intentions: arrayUnion(intentionData)
          }, { merge: true });

          console.log('Intention saved to Firestore');
        } catch (error) {
          console.error('Error saving intention to Firestore:', error);
        }
      }
    });
  }

});

// ============================================================================
// CHROME TABS EVENT LISTENERS
// ============================================================================

// Tab activation (user switches tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log(`[Timer] Tab activated: ${activeInfo.tabId}`);

  try {
    // Get tab details
    const tab = await chrome.tabs.get(activeInfo.tabId);

    if (!tab.url) {
      console.log('[Timer] Tab has no URL yet');
      return;
    }

    // Send message to content script to get site key
    const response = await chrome.tabs.sendMessage(activeInfo.tabId, {
      action: 'get-current-site'
    });

    if (response?.siteKey && response?.hasSiteRule) {
      startTimerForTab(activeInfo.tabId, response.siteKey);
    }
  } catch (error: unknown) {
    // Content script may not be loaded yet - this is expected
    // Timer will start when content script sends 'tab-focused' message
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Receiving end does not exist')) {
      console.log('[Timer] Content script not ready yet (tab still loading)');
    } else {
      console.log('[Timer] Could not process tab activation:', msg);
    }
  }
});

// Tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`[Timer] Tab removed: ${tabId}`);

  // Stop timer if this was the active tab
  if (activeTimer?.tabId === tabId) {
    stopCurrentTimer();
  }
});

// Window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User switched to a different application
    console.log('[Timer] Chrome lost focus');
    stopCurrentTimer();
  } else {
    // User switched back to Chrome
    console.log('[Timer] Chrome gained focus, windowId:', windowId);

    // Query active tab in focused window
    chrome.tabs.query({ active: true, windowId: windowId }, async (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        try {
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'get-current-site'
          });

          if (response?.siteKey && response?.hasSiteRule) {
            startTimerForTab(tabs[0].id, response.siteKey);
          }
        } catch {
          // Content script may not be loaded yet - this is normal
          console.log('[Timer] Content script not ready (window focus)');
        }
      }
    });
  }
});

// Service worker startup - recover timer state
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Timer] Service worker starting up');
  await hydrateCompiledRuleIndexes();

  // Find active tab and restart timer if applicable
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0 && tabs[0].id) {
    try {
      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'get-current-site'
      });

      if (response?.siteKey && response?.hasSiteRule) {
        startTimerForTab(tabs[0].id, response.siteKey);
      }
    } catch {
      // Content script may not be injected yet - this is normal on startup
      console.log('[Timer] Content script not ready (startup)');
    }
  }
});
