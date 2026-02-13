// Content script for intention setting
import React from 'react';
import { createRoot } from 'react-dom/client';
import IntentionPopup from '../components/IntentionPopup';
import TimerBadge from '../components/TimerBadge';
import { normalizeHostname } from '../utils/urlNormalization';

console.log('Intention Setting content script loaded');

// Timer state
let timerInterval: NodeJS.Timeout | null = null;
let syncInterval: NodeJS.Timeout | null = null;
let currentSiteKey: string | null = null;
let timerBadgeRoot: any = null;
let secondsCounter = 0; // Track seconds since last sync

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

// Pause time tracking if tab is not active
const pauseTimeTracking = async () => {
  // Sync to Firestore before pausing
  if (currentSiteKey && secondsCounter > 0) {
    const result = await chrome.storage.local.get(['siteTimeData']);
    const data = result.siteTimeData || {};

    if (data[currentSiteKey]) {
      await syncToFirestore(
        currentSiteKey,
        data[currentSiteKey].timeSpent,
        data[currentSiteKey].timeLimit
      );
      secondsCounter = 0;
    }
  }

  // Clear intervals
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};

// Resume time tracking
const resumeTimeTracking = async () => {
  if (!currentSiteKey) return;

  // Only resume if tab is visible
  if (document.hidden) return;

  const result = await chrome.storage.local.get(['siteTimeData']);
  const siteTimeData = result.siteTimeData || {};
  const siteData = siteTimeData[currentSiteKey];

  if (siteData) {
    // Restart the intervals
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    timerInterval = setInterval(async () => {
      // Only increment if tab is visible
      if (document.hidden) return;

      const result = await chrome.storage.local.get(['siteTimeData']);
      const data = result.siteTimeData || {};

      if (data[currentSiteKey!]) {
        data[currentSiteKey!].timeSpent += 1;
        data[currentSiteKey!].lastUpdated = Date.now();
        await chrome.storage.local.set({ siteTimeData: data });

        // Update badge display
        updateTimerBadge(data[currentSiteKey!].timeSpent, data[currentSiteKey!].timeLimit);

        // Increment counter for Firestore sync
        secondsCounter += 1;
      }
    }, 1000); // Every second

    // Set up Firestore sync every 5 seconds
    if (syncInterval) {
      clearInterval(syncInterval);
    }

    syncInterval = setInterval(async () => {
      if (secondsCounter >= 5 && currentSiteKey) {
        const result = await chrome.storage.local.get(['siteTimeData']);
        const data = result.siteTimeData || {};

        if (data[currentSiteKey]) {
          await syncToFirestore(
            currentSiteKey,
            data[currentSiteKey].timeSpent,
            data[currentSiteKey].timeLimit
          );
          secondsCounter = 0; // Reset counter after sync
        }
      }
    }, 5000); // Check every 5 seconds
  }
};

// Start tracking time for current site
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
  showTimerBadge(siteTimeData[currentSiteKey].timeSpent, timeLimit);

  // Only start timer if tab is visible
  if (!document.hidden) {
    await resumeTimeTracking();
  }
};

// Show timer badge
const showTimerBadge = (timeSpent: number, timeLimit: number) => {
  // Check if badge already exists
  if (document.getElementById('timer-badge-container')) {
    return;
  }

  // Create container for timer badge
  const container = document.createElement('div');
  container.id = 'timer-badge-container';

  // Create shadow DOM
  const shadowRoot = container.attachShadow({ mode: 'open' });
  const shadowContainer = document.createElement('div');
  shadowRoot.appendChild(shadowContainer);

  // Append to body
  document.body.appendChild(container);

  // Render timer badge
  timerBadgeRoot = createRoot(shadowContainer);
  timerBadgeRoot.render(
    React.createElement(TimerBadge, {
      timeSpent: timeSpent,
      timeLimit: timeLimit
    })
  );
};

// Update timer badge display
const updateTimerBadge = (timeSpent: number, timeLimit: number) => {
  if (timerBadgeRoot) {
    timerBadgeRoot.render(
      React.createElement(TimerBadge, {
        timeSpent: timeSpent,
        timeLimit: timeLimit
      })
    );
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

// Listen for storage changes to update URLs in real-time
chrome.storage.onChanged.addListener((changes) => {
  if (changes.siteLimits) {
    // Site limits updated, could trigger re-check if needed
  }
});

// Listen for visibility changes to pause/resume timer
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    // Tab is now hidden - pause timer
    console.log('Tab hidden, pausing timer');
    await pauseTimeTracking();
  } else {
    // Tab is now visible - resume timer
    console.log('Tab visible, resuming timer');
    await resumeTimeTracking();
  }
});

// Initialize on page load
const initialize = async () => {
  await checkAndShowIntentionPopup();
  await checkAndShowTimer();
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
    // Stop previous timers
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    secondsCounter = 0;
    initialize();
  }
}).observe(document, { subtree: true, childList: true });
