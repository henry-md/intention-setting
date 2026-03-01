# Time Tracking System - Architecture & Design

## Overview

This document describes the conceptual design of the time-tracking system for the Intention Setting Chrome extension. The system tracks how much time users spend on specific websites and syncs this data to Firestore.

## Table of Contents

1. [Core Requirements](#core-requirements)
2. [Architectural Pattern: Single Authority](#architectural-pattern-single-authority)
3. [System Components](#system-components)
4. [Event Flow](#event-flow)
5. [Race Condition Prevention](#race-condition-prevention)
6. [Storage Architecture](#storage-architecture)
7. [Design Decisions](#design-decisions)
8. [Edge Cases](#edge-cases)

---

## Core Requirements

### Functional Requirements
1. **Track time accurately**: Count seconds spent on tracked websites
2. **Single timer**: Only one site should be tracked at any moment
3. **Tab awareness**: Track the currently focused tab, not all visible tabs
4. **Persist data**: Store time locally and sync to Firestore periodically
5. **Resume capability**: Continue tracking after extension reload or browser restart

### Non-Functional Requirements
1. **No race conditions**: Multiple tabs should never cause double-counting
2. **Exact accuracy**: Every second counts exactly once
3. **Resilient**: Survive service worker restarts
4. **Simple**: Easy to understand and maintain

---

## Architectural Pattern: Single Authority

### The Problem with Distributed Timers

**Initial approach (failed)**: Each content script managed its own timer with a distributed lock in `chrome.storage.local`:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Tab A      │         │  Tab B      │         │  Tab C      │
│  (YouTube)  │         │  (Reddit)   │         │  (Twitter)  │
├─────────────┤         ├─────────────┤         ├─────────────┤
│ setInterval │         │ setInterval │         │ setInterval │
│ Check lock  │◄───────►│ Check lock  │◄───────►│ Check lock  │
│ Increment   │         │ Increment   │         │ Increment   │
└─────────────┘         └─────────────┘         └─────────────┘
       ▲                       ▲                       ▲
       │                       │                       │
       └───────────────────────┴───────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  chrome.storage     │
                    │  activeTimer: {...} │
                    │  (Shared Lock)      │
                    └─────────────────────┘
```

**Race conditions occurred**:
1. **Lock propagation delay**: `activeTimer` writes are async, creating windows where multiple tabs think they're active
2. **Check-then-act**: Lock checked INSIDE timer interval, after it's already running
3. **Multiple intervals**: Rapid tab switches created multiple intervals before locks propagated
4. **Storage read-modify-write**: Non-atomic increment operations

**Observed symptoms**:
- `"Not active timer. Current: undefined"` errors
- Timer stops working after tab switches
- Time increments by 3 seconds per second (multiple intervals)

### The Solution: Single Authority Pattern

**New approach**: Background service worker is the single source of truth:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Tab A      │         │  Tab B      │         │  Tab C      │
│  (YouTube)  │         │  (Reddit)   │         │  (Twitter)  │
├─────────────┤         ├─────────────┤         ├─────────────┤
│ Send events │         │ Send events │         │ Send events │
│   focused   │────┐    │   focused   │────┐    │   focused   │────┐
│   blurred   │    │    │   blurred   │    │    │   blurred   │    │
└─────────────┘    │    └─────────────┘    │    └─────────────┘    │
                   │                       │                       │
                   │                       │                       │
                   │    ┌──────────────────▼───────────────────────▼─┐
                   │    │                                             │
                   └───►│       Background Service Worker            │
                        │       (Single Authority)                   │
                        │                                             │
                        │  ┌────────────────────────────────────┐   │
                        │  │ activeTimer: {                     │   │
                        │  │   tabId: 123,                      │   │
                        │  │   siteKey: "youtube.com",          │   │
                        │  │   intervalId: setInterval(...)     │   │
                        │  │ }                                  │   │
                        │  └────────────────────────────────────┘   │
                        │                                             │
                        │  ONE timer interval, managed here          │
                        └─────────────────────────────────────────────┘
```

**Key principle**: Only the background service worker can create or clear timer intervals. Content scripts are passive observers that report events.

---

## System Components

### 1. Background Service Worker (`background.ts`)

**Responsibilities**:
- Maintains single timer state in memory
- Decides which tab to track based on events
- Creates and destroys timer intervals
- Increments time counters every second
- Syncs to Firestore every 5 seconds

**State**:
```typescript
interface ActiveTimerState {
  tabId: number;              // Which tab is being tracked
  siteKey: string;            // Normalized hostname (e.g., "youtube.com")
  startedAt: number;          // Timestamp when timer started
  intervalId: NodeJS.Timeout; // The ONE interval that increments time
}

let activeTimer: ActiveTimerState | null = null;
let syncIntervalId: NodeJS.Timeout | null = null;
let secondsCounter: number = 0;
```

**Core functions**:
- `startTimerForTab(tabId, siteKey)`: Start tracking a specific tab
- `stopCurrentTimer()`: Stop the current timer
- `timerTick()`: Increment time every second
- `syncToFirestore()`: Sync to Firebase every 5 seconds

### 2. Content Scripts (`content.ts`)

**Responsibilities**:
- Detect tab visibility changes
- Report events to background worker
- Display UI (timer badge, debug panel)
- Listen for storage changes to update UI

**What they DON'T do**:
- ❌ Create timer intervals
- ❌ Increment time counters
- ❌ Manage timer state
- ❌ Check locks or coordination

**Event reporting**:
```typescript
// Tab becomes visible
chrome.runtime.sendMessage({
  action: 'tab-focused',
  siteKey: 'youtube.com',
  url: window.location.href
});

// Tab becomes hidden
chrome.runtime.sendMessage({
  action: 'tab-blurred',
  siteKey: 'youtube.com'
});

// Navigation to different domain
chrome.runtime.sendMessage({
  action: 'tab-navigated',
  previousSiteKey: 'youtube.com',
  newSiteKey: 'reddit.com',
  url: window.location.href
});
```

### 3. Chrome APIs (Event Triggers)

**Chrome provides tab lifecycle events**:
- `chrome.tabs.onActivated`: User switches tabs
- `chrome.tabs.onRemoved`: Tab closes
- `chrome.windows.onFocusChanged`: Window focus changes
- `chrome.runtime.onStartup`: Service worker starts

These events trigger the background worker to start/stop timers.

### 4. Storage Layer

**Chrome Storage (Local)**:
```typescript
{
  siteTimeData: {
    "youtube.com": {
      timeSpent: 245,      // Total seconds spent
      timeLimit: 3600,     // Configured limit
      lastUpdated: 1708234567890
    }
  },
  siteLimits: {
    "youtube.com": {
      limitType: "hard",
      timeLimit: 3600,
      limitId: "limit:abc123"
    }
  }
}
```

**Firestore (Remote)**:
- Synced every 5 seconds
- User document at `users/{userId}`
- Time usage data stored in `dailyUsageHistory.{YYYY-MM-DD}`

---

## Event Flow

### Scenario 1: User Switches from YouTube to Reddit

```
┌──────────┐                                           ┌───────────────┐
│ Browser  │                                           │  Background   │
│          │                                           │   Worker      │
└────┬─────┘                                           └───────┬───────┘
     │                                                         │
     │ 1. User clicks Reddit tab                              │
     ├────────────────────────────────────────────────────────►
     │    chrome.tabs.onActivated(tabId: 456)                 │
     │                                                         │
     │                                                   2. Send message
     │                                                   to Reddit tab
     │◄────────────────────────────────────────────────────────┤
     │    chrome.tabs.sendMessage(456, 'get-current-site')    │
     │                                                         │
┌────┴─────┐                                                  │
│ Reddit   │                                                  │
│ Tab      │                                                  │
└────┬─────┘                                                  │
     │                                                         │
     │ 3. Respond with site info                              │
     ├────────────────────────────────────────────────────────►
     │    { siteKey: 'reddit.com', hasSiteLimit: true }       │
     │                                                         │
     │                                                   4. startTimerForTab(456, 'reddit.com')
     │                                                         │
     │                                                   a. Clear YouTube interval
     │                                                   b. activeTimer.intervalId = null
     │                                                   c. Verify Reddit tab active
     │                                                   d. Create new interval
     │                                                   e. activeTimer = { tabId: 456, ... }
     │                                                         │
     │                                                   5. setInterval(() => timerTick(), 1000)
     │                                                         │
     │                                                   Every 1 second:
     │                                                   - Verify tab still active
     │                                                   - Increment reddit.com time
     │                                                   - Update chrome.storage
     │                                                         │
     │                                                   Every 5 seconds:
     │                                                   - Sync to Firestore
     │                                                         │
```

### Scenario 2: Rapid Tab Switching (YouTube → Reddit → YouTube)

```
Time  Event                           Background Worker Action
────  ──────────────────────────────  ────────────────────────────────────
T0    User clicks Reddit tab
T1                                    startTimerForTab(Reddit)
T2                                    → clearInterval(YouTube) IMMEDIATELY
T3                                    → await chrome.tabs.get(Reddit) [YIELDS]
T4    User clicks YouTube tab (fast!)
T5                                    startTimerForTab(YouTube)
T6                                    → clearInterval(Reddit) IMMEDIATELY
T7                                    → await chrome.tabs.get(YouTube) [YIELDS]
T8                                    ← Reddit async resumes
T9                                    → Defensive check: interval already cleared
T10                                   → Create Reddit interval
T11                                   ← YouTube async resumes
T12                                   → clearInterval(Reddit) IMMEDIATELY
T13                                   → Create YouTube interval
T14   [1 second passes]
T15                                   ✅ YouTube interval ticks
T16                                   ✅ Increment youtube.com (only once!)
```

**Key insight**: Intervals are cleared SYNCHRONOUSLY before any async operations, preventing race conditions.

---

## Race Condition Prevention

### Problem: Multiple Intervals Created

**Without synchronous clearing**:
```typescript
async function startTimerForTab(tabId, siteKey) {
  if (activeTimer) {
    stopCurrentTimer();  // Sets activeTimer = null
  }

  await chrome.tabs.get(tabId);  // YIELDS CONTROL ⚠️

  // Another call could have started here! ⚠️

  activeTimer = {
    intervalId: setInterval(...)  // Creates second interval 💥
  };
}
```

**With synchronous clearing**:
```typescript
async function startTimerForTab(tabId, siteKey) {
  // IMMEDIATELY clear interval BEFORE async operations
  if (activeTimer?.intervalId) {
    clearInterval(activeTimer.intervalId);  // ✅ Synchronous!
    activeTimer.intervalId = null;
  }

  // Full cleanup
  if (activeTimer) {
    stopCurrentTimer();
  }

  await chrome.tabs.get(tabId);  // Safe to yield

  // Defensive check before creating new interval
  if (activeTimer?.intervalId) {
    clearInterval(activeTimer.intervalId);
  }

  activeTimer = {
    intervalId: setInterval(...)  // ✅ Only one interval exists
  };
}
```

### Problem: Old Intervals Still Ticking

**Without interval ID verification**:
```typescript
async function timerTick() {
  // ... async operations ...

  siteTimeData[siteKey].timeSpent += 1;  // ⚠️ Old intervals can still increment!
}
```

**With interval ID verification**:
```typescript
async function timerTick() {
  const currentTimer = activeTimer;  // Capture state at start

  // ... async operations ...

  // Check if timer changed during async operations
  if (activeTimer?.intervalId !== currentTimer.intervalId) {
    console.log('Timer changed, aborting this tick');
    return;  // ✅ Old interval aborts
  }

  siteTimeData[siteKey].timeSpent += 1;  // ✅ Only current interval increments
}
```

### Defense-in-Depth Strategy

1. **Synchronous clearing**: Clear intervals immediately before async operations
2. **Defensive re-check**: Clear again right before creating new interval
3. **Interval ID tracking**: Verify interval ID hasn't changed during async operations
4. **Tab verification**: Check tab still exists and is active before incrementing
5. **Logging**: Extensive logging to detect any race conditions

---

## Storage Architecture

### Local Storage (Chrome Storage API)

**Purpose**: Fast, local cache for immediate access

**Data**:
- `siteTimeData`: Current time spent per site (updated every second)
- `siteLimits`: User's configured limits per site (updated via LLM panel)
- `user`: Authenticated user info

**Update frequency**: Every 1 second (time increments)

**Characteristics**:
- Fast read/write
- Survives browser restart
- Isolated per Chrome profile
- Limited to ~10MB

### Remote Storage (Firestore)

**Purpose**: Persistent, cross-device storage

**Data**:
- `users/{userId}/dailyUsageHistory.{YYYY-MM-DD}`: Daily aggregate with per-site totals

**Update frequency**: Every 5 seconds (batched)

**Characteristics**:
- Survives extension uninstall
- Accessible from other devices (future)
- Requires network connection
- Slower than local storage

### Sync Strategy

```
Local Storage (Chrome)         Firestore (Remote)
─────────────────────           ──────────────────

Every 1 second:                 Every 5 seconds:
  - Increment timeSpent           - Read local siteTimeData
  - Update lastUpdated            - Send to Firestore via background message
  - Trigger UI updates            - Handle offline gracefully

On extension load:              On user login:
  - Read from local storage       - Pull from Firestore
  - Initialize UI                 - Sync to local storage

On timer stop:                  On extension unload:
  - Sync remaining seconds        - Final sync to Firestore
    to Firestore immediately
```

**Sync flow**:
1. Background worker increments `siteTimeData` in local storage every second
2. `secondsCounter` tracks seconds since last Firestore sync
3. Every 5 seconds, if `secondsCounter >= 5`, background sends message to itself
4. Message handler writes current `siteTimeData` to Firestore
5. `secondsCounter` resets to 0

**Conflict resolution**: Last-write-wins (since only one device active at a time)

---

## Design Decisions

### Why Background Service Worker?

**Alternatives considered**:
1. **Content script timers**: ❌ Vulnerable to race conditions
2. **Polling every second**: ❌ Less efficient, harder to coordinate
3. **Hybrid (content scripts + polling)**: ❌ Complexity without benefits

**Background service worker chosen because**:
- ✅ Single source of truth (no coordination needed)
- ✅ Lives independently of tabs
- ✅ Access to Chrome APIs (tabs, windows)
- ✅ Can maintain global state
- ✅ Survives tab closure

### Why Immediate Synchronous Clearing?

**Problem**: JavaScript's `async`/`await` yields control between awaits

**Solution**: Clear intervals BEFORE any async operations

```typescript
// ❌ BAD: Yields before clearing
async function start() {
  if (activeTimer) {
    stopCurrentTimer();  // Sets null but doesn't clear interval yet
  }
  await something();  // ⚠️ Another call can start here!
  createInterval();   // 💥 Two intervals now!
}

// ✅ GOOD: Clear immediately
async function start() {
  if (activeTimer?.intervalId) {
    clearInterval(activeTimer.intervalId);  // ✅ Cleared NOW
  }
  await something();  // Safe
  createInterval();   // ✅ Only one interval
}
```

### Why Track Tab ID Instead of Site Key?

**Scenario**: User has two YouTube tabs open

- **If tracking by site**: Which tab should be tracked?
- **If tracking by tab**: Clear answer - the focused tab

**Decision**: Track `tabId` in `activeTimer`, use it to verify tab state every second

**Benefits**:
- Unambiguous: only one tab can be focused at a time
- Handles multiple tabs of same site correctly
- Chrome APIs work with tab IDs (`chrome.tabs.get()`)

### Why 1-Second Granularity?

**Alternatives**:
- Sub-second (100ms): ❌ Overkill for time tracking, more overhead
- Multi-second (5s): ❌ Less accurate, poor user experience

**1 second chosen because**:
- ✅ Accurate enough for time tracking
- ✅ Matches user expectations (seconds tick by)
- ✅ Minimal overhead (one storage write per second)
- ✅ Standard granularity for timers

### Why Batch Firestore Syncs (5 seconds)?

**Firestore has quotas**:
- Writes per second: 1,000 (free tier)
- Writes per day: 20,000 (free tier)

**Syncing every second**:
- 60 seconds/minute × 60 minutes/hour = 3,600 writes/hour
- 3,600 × 24 = 86,400 writes/day ❌ Exceeds quota

**Syncing every 5 seconds**:
- 12 writes/minute × 60 = 720 writes/hour
- 720 × 24 = 17,280 writes/day ✅ Within quota

**Trade-off**: Max 5 seconds of data loss if browser crashes (acceptable)

---

## Edge Cases

### 1. Service Worker Restarts

**Problem**: Chrome can terminate service workers after ~30 seconds of inactivity

**Solution**: `chrome.runtime.onStartup` listener recovers state

```typescript
chrome.runtime.onStartup.addListener(async () => {
  // Query which tab is currently active
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  // Ask that tab what site it's on
  const response = await chrome.tabs.sendMessage(tabs[0].id, {
    action: 'get-current-site'
  });

  // Restart timer if site has a limit
  if (response.hasSiteLimit) {
    startTimerForTab(tabs[0].id, response.siteKey);
  }
});
```

**Result**: Timer resumes seamlessly after service worker restart

### 2. Tab Closes While Timer Active

**Problem**: Interval keeps running for non-existent tab

**Solution**:
- `chrome.tabs.onRemoved` listener stops timer immediately
- `timerTick()` verifies tab still exists every second

```typescript
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTimer?.tabId === tabId) {
    stopCurrentTimer();
  }
});
```

### 3. SPA Navigation (Same Domain)

**Problem**: YouTube feed → video page (same domain, should continue timing)

**Solution**: Content script detects URL changes via `MutationObserver`

```typescript
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    const newSiteKey = normalizeHostname(new URL(url).hostname);

    // Only notify if domain actually changed
    if (previousSiteKey !== newSiteKey) {
      chrome.runtime.sendMessage({
        action: 'tab-navigated',
        previousSiteKey,
        newSiteKey
      });
    }
  }
}).observe(document, { subtree: true, childList: true });
```

**Result**: Timer continues for same-domain navigation, restarts for cross-domain

### 4. User Switches to Different Application

**Problem**: Chrome loses focus but tab is still "active" according to Chrome APIs

**Solution**: `chrome.windows.onFocusChanged` listener

```typescript
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User switched away from Chrome entirely
    stopCurrentTimer();
  } else {
    // User switched back to Chrome
    // Query active tab and restart timer
  }
});
```

### 5. Multiple Tabs of Same Site

**Scenario**: User has two YouTube tabs open, switches between them

**Expected behavior**: Track whichever tab is focused

**Implementation**: `activeTimer.tabId` distinguishes between tabs

```
Tab A (youtube.com, tabId: 123) - focused  → Timer runs for tab 123
Tab B (youtube.com, tabId: 456) - unfocused → No timer

User switches to Tab B → Timer stops for 123, starts for 456
```

### 6. Content Script Hasn't Loaded Yet

**Problem**: Background tries to send message to tab before content script loads

**Solution**: Graceful error handling

```typescript
try {
  const response = await chrome.tabs.sendMessage(tabId, {
    action: 'get-current-site'
  });
} catch (error) {
  console.log('Could not reach content script (may still be loading)');
  // Content script will send 'tab-focused' message when it loads
}
```

**Result**: Timer starts when content script finishes loading

---

## Summary

### Key Principles

1. **Single Authority**: Background service worker is the only source of truth
2. **Synchronous Safety**: Clear intervals immediately before async operations
3. **Defensive Programming**: Multiple layers of protection against race conditions
4. **Event-Driven**: Content scripts report events, background decides actions
5. **Simple State**: One timer, one interval, one counter

### Benefits

- ✅ **No race conditions**: Only one interval can exist
- ✅ **Exact accuracy**: Every second counts exactly once
- ✅ **Resilient**: Survives service worker restarts, tab closes, navigation
- ✅ **Simple**: Clear separation of concerns (reporting vs. tracking)
- ✅ **Maintainable**: Centralized timer logic, easy to debug

### Files

- **Background worker**: `/extension/src/scripts/background.ts`
- **Content script**: `/extension/src/scripts/content.ts`
- **URL normalization**: `/extension/src/utils/urlNormalization.ts`
- **Components**: `/extension/src/components/TimerBadge.tsx`, `DebugPanel.tsx`

---

**Last Updated**: February 2026
**Architecture Version**: 2.0 (Single Authority Pattern)
