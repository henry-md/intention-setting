import "./firebase-config";
import { format } from 'date-fns';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';

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

let activeTimer: ActiveTimerState | null = null;
let syncIntervalId: NodeJS.Timeout | null = null;
let secondsCounter = 0;

const TIMER_TICK_INTERVAL = 1000;  // 1 second
const FIRESTORE_SYNC_INTERVAL = 5000;  // 5 seconds

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

    // Send to Firestore using existing updateTimeTracking handler
    // Fire-and-forget - don't await since we don't need the response
    chrome.runtime.sendMessage({
      action: 'updateTimeTracking',
      userId: user.uid,
      siteKey: siteKey,
      timeData: siteTimeData[siteKey]
    }).catch(error => {
      // Service worker might be restarting - this is expected occasionally
      console.log('[Timer] Firestore sync message failed (will retry):', error.message);
    });

    secondsCounter = 0;
    console.log('[Timer] ✓ Firestore sync initiated');
  } catch (error) {
    console.error('[Timer] Firestore sync failed (will retry):', error);
    // Don't reset counter - will retry on next interval
  }
}

/**
 * Called every second by the timer interval.
 * This is the ONLY place where time is incremented.
 */
async function timerTick(): Promise<void> {
  // Capture current timer state at start of tick to avoid race conditions
  const currentTimer = activeTimer;

  if (!currentTimer) {
    console.error('[Timer] timerTick called but no active timer!');
    return;
  }

  const tickStartTime = Date.now();
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

  // Increment time in storage
  const storage = await chrome.storage.local.get(['siteTimeData']);
  const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};

  if (siteTimeData[siteKey]) {
    const oldTime = siteTimeData[siteKey].timeSpent;
    siteTimeData[siteKey].timeSpent += 1;
    siteTimeData[siteKey].lastUpdated = Date.now();

    await chrome.storage.local.set({ siteTimeData });

    const tickDuration = Date.now() - tickStartTime;
    console.log(`[Timer] ✓ Incremented ${siteKey}: ${oldTime} → ${siteTimeData[siteKey].timeSpent}s (tick took ${tickDuration}ms)`);

    // Increment Firestore sync counter
    secondsCounter += 1;
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

  console.log(`[Timer] ✓ Started timer for tab ${tabId}, site ${siteKey}`);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Listen for when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated");
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Handle requests to close a success or cancel tab (tab created after Stripe payment)
chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
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

  // Handle time tracking updates to Firestore
  if (message.action === 'updateTimeTracking') {
    const { userId, siteKey, timeData } = message;

    console.log('Updating time tracking:', { userId, siteKey, timeData });

    // Update Firestore
    const userDocRef = doc(db, 'users', userId);

    setDoc(userDocRef, {
      timeTracking: {
        [siteKey]: timeData
      }
    }, { merge: true })
      .then(() => {
        console.log('Time tracking updated in Firestore');
      })
      .catch((error) => {
        console.error('Error updating time tracking:', error);
      });

    return false; // No async response needed
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
