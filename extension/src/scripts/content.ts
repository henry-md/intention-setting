// Content script for intention setting
import React from 'react';
import { createRoot } from 'react-dom/client';
import IntentionPopup from '../components/IntentionPopup';
import TimerBadge from '../components/TimerBadge';
import DebugPanel from '../components/DebugPanel';
import { normalizeHostname } from '../utils/urlNormalization';

console.log('Intention Setting content script loaded');
console.log('[Timer] Initial state - document.hidden:', document.hidden, 'visibilityState:', document.visibilityState);

// Content script state (timer management moved to background service worker)
let currentSiteKey: string | null = null;
let containerRoot: any = null; // Root for the flex container holding both components
const DEBUG_UI = import.meta.env.VITE_DEBUG_UI === 'true';

// Check if current URL matches user's saved URLs
const checkAndShowIntentionPopup = async () => {
  try {
    // Get current URL's normalized domain
    const currentUrl = new URL(window.location.href);
    const currentDomain = normalizeHostname(currentUrl.hostname);

    // Get user data from chrome storage
    const result = await chrome.storage.local.get(['user']);
    if (!result.user?.uid) {
      console.log('No user found, skipping intention check');
      return;
    }

    // Get site limits from chrome storage
    const limitsResult = await chrome.storage.local.get(['siteLimits']);
    const siteLimits: Record<string, any> = limitsResult.siteLimits || {};

    // Check if current domain has a limit
    const limitData = siteLimits[currentDomain];

    if (limitData) {
      // Check if we've already visited this site today (after 4am)
      const result = await chrome.storage.local.get(['siteTimeData']);
      const siteTimeData = result.siteTimeData || {};
      const siteData = siteTimeData[currentDomain];

      const hasVisitedToday = siteData && siteData.lastUpdated && !isNewDay(siteData.lastUpdated);

      if (hasVisitedToday) {
        // Same day revisit - for hard/soft limits, just show the timer badge
        // For session limits, skip everything (already prompted today)
        console.log('Already visited today');
        if (limitData.limitType !== 'session') {
          console.log('Starting timer for same-day revisit:', limitData);
          await startTimeTracking(limitData.timeLimit);
        }
        return;
      }

      // New day or first visit
      // Only show intention popup for session limits
      if (limitData.limitType === 'session') {
        pauseAllVideos();
        showIntentionPopup();
      } else {
        // For hard/soft limits, start timer immediately with the configured time limit
        console.log('Starting timer for hard/soft limit (first visit today):', limitData);
        await startTimeTracking(limitData.timeLimit);
      }
    }
  } catch (error) {
    console.error('Error checking intention:', error);
  }
};

// Pause all video elements on the page
const pauseAllVideos = () => {
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    video.pause();
  });
};

// Resume all video elements on the page
const resumeAllVideos = () => {
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    video.play().catch(() => {
      // Ignore autoplay errors
    });
  });
};

// Get the current site key (normalized hostname)
const getCurrentSiteKey = (): string => {
  const hostname = new URL(window.location.href).hostname;
  return normalizeHostname(hostname);
};

// Get the start of the current "day" (4am today or 4am yesterday if before 4am)
const getDayStart = (): number => {
  const now = new Date();
  const currentHour = now.getHours();

  // Create a date for 4am today
  const dayStart = new Date(now);
  dayStart.setHours(4, 0, 0, 0);

  // If it's currently before 4am, use 4am yesterday as the day start
  if (currentHour < 4) {
    dayStart.setDate(dayStart.getDate() - 1);
  }

  return dayStart.getTime();
};

// Check if lastUpdated was in the current day (after 4am)
const isNewDay = (lastUpdated: number): boolean => {
  const dayStart = getDayStart();
  return lastUpdated < dayStart;
};

// Sync time data to Firestore
const syncToFirestore = async (siteKey: string, timeSpent: number, timeLimit: number) => {
  try {
    // Get user from storage
    const result = await chrome.storage.local.get(['user']);
    if (!result.user?.uid) {
      return;
    }

    // Send message to background script to update Firestore
    await chrome.runtime.sendMessage({
      action: 'updateTimeTracking',
      userId: result.user.uid,
      siteKey: siteKey,
      timeData: {
        timeSpent: timeSpent,
        timeLimit: timeLimit,
        lastUpdated: Date.now()
      }
    });
  } catch (error) {
    console.error('Error syncing to Firestore:', error);
  }
};

// Start tracking time for current site (simplified - notifies background worker)
const startTimeTracking = async (timeLimit: number) => {
  currentSiteKey = getCurrentSiteKey();

  // Get existing time data
  const result = await chrome.storage.local.get(['siteTimeData']);
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

  await chrome.storage.local.set({ siteTimeData });

  // Show timer badge
  await showTimerBadge(siteTimeData[currentSiteKey].timeSpent, timeLimit);

  // Notify background worker if tab is visible
  if (!document.hidden) {
    await chrome.runtime.sendMessage({
      action: 'tab-focused',
      siteKey: currentSiteKey,
      url: window.location.href
    });
  }
};

// Get debug info for the debug panel
const getDebugInfo = async () => {
  const isVisible = !document.hidden && document.visibilityState === 'visible';
  return {
    currentUrl: window.location.href,
    normalizedHostname: currentSiteKey || getCurrentSiteKey(),
    instanceId: 'N/A (managed by background)',
    isActiveTimer: false, // Timer managed by background worker now
    isTabVisible: isVisible
  };
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
    const storage = await chrome.storage.local.get(['timerPosition']);
    let savedPosition = storage.timerPosition;

    // Reset position if it's from old code version (no version field) or invalid
    const POSITION_VERSION = 2; // Increment when position calculation changes

    if (!savedPosition || savedPosition.version !== POSITION_VERSION) {
      console.log('[Timer] Using fresh default position (v2)');
      savedPosition = { top: 0, right: 0, version: POSITION_VERSION };
      await chrome.storage.local.set({ timerPosition: savedPosition });
    }

    // Additional validation (reset if out of reasonable bounds)
    const maxTop = window.innerHeight - 100;
    const maxRight = window.innerWidth - 100;

    if (savedPosition.top < 0 || savedPosition.top > maxTop ||
        savedPosition.right < 0 || savedPosition.right > maxRight) {
      console.log('[Timer] Resetting out-of-bounds position');
      savedPosition = { top: 0, right: 0, version: POSITION_VERSION };
      await chrome.storage.local.set({ timerPosition: savedPosition });
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

    // Create drag handle
    const dragHandle = document.createElement('div');
    dragHandle.style.cssText = `
      width: 32px;
      height: 5px;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 3px;
      margin: 0 auto 8px auto;
      cursor: grab;
      transition: background 0.2s ease;
    `;
    dragHandle.title = 'Drag to reposition';

    // Add hover effect
    dragHandle.addEventListener('mouseenter', () => {
      dragHandle.style.background = 'rgba(255, 255, 255, 0.6)';
    });
    dragHandle.addEventListener('mouseleave', () => {
      dragHandle.style.background = 'rgba(255, 255, 255, 0.4)';
    });

    // Create content container for React components
    const shadowContainer = document.createElement('div');
    shadowContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    // Make it draggable
    let isDragging = false;
    let currentX: number;
    let currentY: number;
    let initialX: number;
    let initialY: number;

    const onMouseDown = (e: MouseEvent) => {
      // Get initial mouse position
      initialX = e.clientX;
      initialY = e.clientY;

      // Get current position
      const rect = wrapper.getBoundingClientRect();
      currentX = rect.left;
      currentY = rect.top;

      isDragging = true;
      wrapper.style.cursor = 'grabbing';
      dragHandle.style.background = 'rgba(255, 255, 255, 0.8)';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      e.preventDefault();

      // Calculate new position
      const deltaX = e.clientX - initialX;
      const deltaY = e.clientY - initialY;

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
      dragHandle.style.background = 'rgba(255, 255, 255, 0.4)';

      // Save position to storage
      const rect = wrapper.getBoundingClientRect();
      const windowWidth = window.innerWidth;

      // Calculate right offset (distance from right edge)
      const rightOffset = windowWidth - rect.right;

      await chrome.storage.local.set({
        timerPosition: {
          top: rect.top,
          right: rightOffset
        }
      });

      console.log('[Timer] Position saved:', { top: rect.top, right: rightOffset });
    };

    wrapper.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Build DOM structure: wrapper > [dragHandle, shadowContainer]
    wrapper.appendChild(dragHandle);
    wrapper.appendChild(shadowContainer);
    shadowRoot.appendChild(wrapper);
    document.body.appendChild(container);

    // Create React root
    containerRoot = createRoot(shadowContainer);
  }

  // Get debug info
  const debugInfo = await getDebugInfo();

  // Render both components
  const components = [];

  // Add timer badge if we have time data
  if (timeSpent !== undefined && timeLimit !== undefined) {
    components.push(
      React.createElement(TimerBadge, {
        key: 'timer',
        timeSpent: timeSpent,
        timeLimit: timeLimit
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
    await renderContainer();
  }
};

// Check if we should show timer badge (site is in list)
const checkAndShowTimer = async () => {
  try {
    const currentDomain = getCurrentSiteKey();
    const limitsResult = await chrome.storage.local.get(['siteLimits']);
    const siteLimits: Record<string, any> = limitsResult.siteLimits || {};

    const limitData = siteLimits[currentDomain];

    if (limitData) {
      const result = await chrome.storage.local.get(['siteTimeData']);
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
      try {
        await chrome.runtime.sendMessage({
          action: 'saveIntention',
          intention: intention,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          timeLimit: timeLimit
        });
      } catch (error) {
        console.error('Error saving intention:', error);
      }
    }

    // Remove popup and resume videos
    root.unmount();
    container.remove();
    resumeAllVideos();

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

// Listen for storage changes to update badge in real-time
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.siteLimits) {
    // Site limits updated, could trigger re-check if needed
  }

  // If siteTimeData changes and we're not the active tab, update our display
  if (changes.siteTimeData && currentSiteKey && !document.hidden) {
    const newData = changes.siteTimeData.newValue || {};
    const siteData = newData[currentSiteKey];
    if (siteData && containerRoot) {
      await updateTimerBadge(siteData.timeSpent, siteData.timeLimit);
    } else if (DEBUG_UI && containerRoot) {
      // Update debug panel even if no timer data
      await showDebugPanel();
    }
  }
});

// Listen for messages from background worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content] Message received:', message);

  if (message.action === 'get-current-site') {
    chrome.storage.local.get(['siteLimits'], (storage) => {
      const siteLimits = storage.siteLimits || {};
      const hasSiteLimit = !!siteLimits[currentSiteKey || ''];

      sendResponse({
        siteKey: currentSiteKey,
        url: window.location.href,
        hasSiteLimit: hasSiteLimit
      });
    });
    return true; // Will respond asynchronously
  }
});

// Listen for visibility changes - notify background worker
const handleVisibilityChange = async () => {
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
    await chrome.runtime.sendMessage({
      action: 'tab-blurred',
      siteKey: currentSiteKey
    });
  } else {
    // Tab is now visible - notify background to start timer
    console.log('[Timer] 🔼 Tab visible - notifying background');
    await chrome.runtime.sendMessage({
      action: 'tab-focused',
      siteKey: currentSiteKey,
      url: window.location.href
    });
  }

  // Update UI to reflect changes
  if (containerRoot) {
    const result = await chrome.storage.local.get(['siteTimeData']);
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
  const currentVisibilityState = document.hidden;

  // If state changed but event didn't fire, manually trigger
  if (currentVisibilityState !== lastVisibilityState) {
    console.log('[Timer] 🔄 POLLING DETECTED VISIBILITY CHANGE (event did not fire!)');
    console.log('[Timer] Was hidden:', lastVisibilityState, '→ Now hidden:', currentVisibilityState);
    lastVisibilityState = currentVisibilityState;
    handleVisibilityChange();
  }
}, 500);

// Initialize on page load
const initialize = async () => {
  await checkAndShowIntentionPopup();
  await checkAndShowTimer();
  // Show debug panel if DEBUG_UI is enabled (even if no timer)
  await showDebugPanel();
};

// Run check when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Also run on navigation (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;

    const previousSiteKey = currentSiteKey;
    const newSiteKey = getCurrentSiteKey();

    console.log('[Timer] URL changed:', lastUrl, '→', url);
    console.log('[Timer] Site key:', previousSiteKey, '→', newSiteKey);

    // If site changed (different domain), notify background
    if (previousSiteKey && previousSiteKey !== newSiteKey) {
      chrome.runtime.sendMessage({
        action: 'tab-navigated',
        previousSiteKey: previousSiteKey,
        newSiteKey: newSiteKey,
        url: url
      });
    }

    // Re-initialize UI
    initialize();
  }
}).observe(document, { subtree: true, childList: true });
