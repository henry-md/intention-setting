import "./firebase-config";
import { format } from 'date-fns';
import { doc, getDoc, setDoc } from 'firebase/firestore/lite';
import { ALLOW_CUSTOM_RESET_TIME, DEFAULT_DAILY_RESET_TIME, TUTORIAL_INSTAGRAM_BADGE_STEP_KEY } from '../constants';
import { db } from '../utils/firebase';
import { getApplicableTimeRuleIdsForSite, getMostRestrictiveRuleIdForSite } from '../utils/ruleSelection';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import { getTimeLimitScheduleState } from '../utils/timeLimitSchedule';
import { formatDateWithTimezone, getTimezoneAbbreviation } from '../utils/timezone';
import { getHomeUrlForMessages, getMessagesRedirect, isDirectMessageUrl } from '../site-experiences';
import { normalizeHostname } from '../utils/urlNormalization';
import type { RuleType, TimeLimitSchedule } from '../types/Rule';
import { shouldResetUsageDay } from '../utils/usageDayReset';
import { acknowledgeUsage, maxSiteTotals, type UsageJournal, type UsageJournalEntry } from '../utils/usageJournal';
import { loadUsage, uploadUsage } from '../utils/usageSync';

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
    ruleType: RuleType;
    timeLimit: number;
    ruleId: string;
    schedule?: TimeLimitSchedule;
    plusOnes?: number;
    plusOneDuration?: number;
  };
}

interface SiteRuleIds {
  [siteKey: string]: string[];
}

interface CompiledRules {
  [ruleId: string]: {
    ruleType: RuleType;
    timeLimit: number;
    ruleName?: string;
    schedule?: TimeLimitSchedule;
    plusOnes?: number;
    plusOneDuration?: number;
    siteKeys: string[];
  };
}

interface RuleUsageData {
  [ruleId: string]: {
    timeSpent: number;
    lastUpdated: number;
  };
}

interface TutorialInstagramBadgeStepState {
  status?: string;
  tabId?: number;
}

interface ExceededRuleInfo {
  ruleId: string;
  rule: {
    ruleType: RuleType;
    timeLimit: number;
    plusOnes?: number;
    plusOneDuration?: number;
    siteKeys: string[];
  };
  usage: {
    timeSpent: number;
    lastUpdated: number;
  };
  effectiveLimit: number;
  consumedOneMores: number;
  derivedRemainingSnoozes: number;
  shouldShowPopup: boolean;
  shouldBlock: boolean;
}

let activeTimer: ActiveTimerState | null = null;
let syncIntervalId: NodeJS.Timeout | null = null;

const TIMER_TICK_INTERVAL = 1000;  // 1 second
const FIRESTORE_SYNC_INTERVAL = 5000;  // 5 seconds
const USAGE_RESET_CHECK_INTERVAL_MS = 10_000;
const USAGE_RESET_ALARM_NAME = 'usage-reset-check';
const CURRENT_USAGE_DAY_KEY_STORAGE_KEY = 'currentUsageDayKey';
const DEFAULT_ACTION_TITLE = 'Open Intention Setting';
const DM_HOME_BYPASSES_KEY = 'dmHomeBypasses';
const DM_HOME_TOKENS_KEY = 'dmHomeTokens';
const USAGE_INSTALLATION_ID_KEY = 'usageInstallationId';
const USAGE_CONTRIBUTION_STATE_KEY = 'usageContributionState';
const USAGE_JOURNAL_KEY = 'usageJournal';
const LOCAL_DEV_ACTION_TITLE = `${DEFAULT_ACTION_TITLE} (local dev)`;
const PRODUCTION_ACTION_ICONS: { [index: number]: string } = {
  16: 'icons/32.png',
  32: 'icons/64.png',
  48: 'icons/128.png',
  64: 'icons/128.png',
  128: 'icons/256.png'
};
const LOCAL_DEV_ACTION_ICONS: { [index: number]: string } = {
  16: 'icons/dev-32.png',
  32: 'icons/dev-64.png',
  48: 'icons/dev-128.png',
  64: 'icons/dev-128.png',
  128: 'icons/dev-256.png'
};

let lastUsageResetCheckAt = 0;
let usageHydrationPromise: Promise<void> | null = null;
let usageSyncPromise: Promise<void> | null = null;
let usageStorageQueue: Promise<unknown> = Promise.resolve();
let timerStartGeneration = 0;

function withUsageStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = usageStorageQueue.then(operation);
  usageStorageQueue = result.catch(() => {});
  return result;
}
const socialRedirectsInFlight = new Map<number, string>();
const pendingSocialRootRedirects = new Map<number, { messagesUrl: string; previousUrl?: string }>();
const SOCIAL_ROOT_REDIRECT_GRACE_MS = 400;
const SOCIAL_HOME_TOKEN_TTL_MS = 2_000;

type UsageContributionState = {
  dayKey: string;
  siteTotals: Record<string, number>;
  seeded?: boolean;
};

async function getUsageInstallationId(): Promise<string> {
  const storage = await chrome.storage.local.get(USAGE_INSTALLATION_ID_KEY);
  if (typeof storage[USAGE_INSTALLATION_ID_KEY] === 'string') return storage[USAGE_INSTALLATION_ID_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [USAGE_INSTALLATION_ID_KEY]: id });
  return id;
}

async function hydrateSharedUsageForCurrentDay(): Promise<void> {
  if (usageHydrationPromise) return usageHydrationPromise;
  usageHydrationPromise = (async () => {
    const storage = await chrome.storage.local.get(['user', CURRENT_USAGE_DAY_KEY_STORAGE_KEY, 'usageResetAppliedAt']);
    if (!storage.user?.uid) return;
    const dayKey = storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY];
    const entry = await loadUsage(storage.user.uid, dayKey);
    if (!entry?.siteTotals) return;
    await withUsageStorageLock(async () => {
      const latest = await chrome.storage.local.get(['user', 'siteTimeData', CURRENT_USAGE_DAY_KEY_STORAGE_KEY, 'usageResetAppliedAt']);
      if (latest.user?.uid !== storage.user.uid || latest[CURRENT_USAGE_DAY_KEY_STORAGE_KEY] !== dayKey
        || latest.usageResetAppliedAt !== storage.usageResetAppliedAt) return;
      const siteTimeData: Record<string, SiteTimeData> = latest.siteTimeData || {};
      for (const [siteKey, total] of Object.entries(entry.siteTotals)) {
        siteTimeData[siteKey] = {
          ...(siteTimeData[siteKey] || { timeLimit: 0 }),
          timeSpent: Math.max(siteTimeData[siteKey]?.timeSpent || 0, total),
          lastUpdated: Date.now()
        };
      }
      await chrome.storage.local.set({ siteTimeData });
    });
  })().catch((error) => {
    console.error('[Timer] Shared usage refresh failed; local tracking continues:', error);
  }).finally(() => { usageHydrationPromise = null; });
  return usageHydrationPromise;
}

async function hasDmHomeBypass(tabId: number, url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const storage = await chrome.storage.session.get(DM_HOME_BYPASSES_KEY);
  const bypasses = (storage[DM_HOME_BYPASSES_KEY] || {}) as Record<string, string>;
  const bypassHomeUrl = bypasses[String(tabId)];
  if (!bypassHomeUrl) return false;

  try {
    // Home mode belongs to the social-site tab, not just its literal `/`
    // URL. Instagram opens comments and posts at their own routes before
    // returning to `/`, and those journeys must retain the user's explicit
    // choice to browse Home.
    return new URL(bypassHomeUrl).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

async function consumeDmHomeToken(tabId: number, url: string): Promise<boolean> {
  const storage = await chrome.storage.session.get([DM_HOME_TOKENS_KEY, DM_HOME_BYPASSES_KEY]);
  const tokens = (storage[DM_HOME_TOKENS_KEY] || {}) as Record<string, { origin: string; expiresAt: number }>;
  const token = tokens[String(tabId)];
  if (!token || token.expiresAt < Date.now() || token.origin !== new URL(url).origin) return false;

  delete tokens[String(tabId)];
  const bypasses = (storage[DM_HOME_BYPASSES_KEY] || {}) as Record<string, string>;
  bypasses[String(tabId)] = `${new URL(url).origin}/`;
  await chrome.storage.session.set({ [DM_HOME_TOKENS_KEY]: tokens, [DM_HOME_BYPASSES_KEY]: bypasses });
  return true;
}

async function clearDmHomeBypass(tabId: number): Promise<void> {
  const storage = await chrome.storage.session.get(DM_HOME_BYPASSES_KEY);
  const bypasses = (storage[DM_HOME_BYPASSES_KEY] || {}) as Record<string, string>;
  if (!(String(tabId) in bypasses)) return;
  delete bypasses[String(tabId)];
  await chrome.storage.session.set({ [DM_HOME_BYPASSES_KEY]: bypasses });
}

async function clearDmHomeBypassAfterLeavingSite(tabId: number, url: string): Promise<void> {
  const storage = await chrome.storage.session.get(DM_HOME_BYPASSES_KEY);
  const bypasses = (storage[DM_HOME_BYPASSES_KEY] || {}) as Record<string, string>;
  const bypassHomeUrl = bypasses[String(tabId)];
  if (!bypassHomeUrl) return;

  try {
    if (new URL(bypassHomeUrl).origin === new URL(url).origin) return;
  } catch {
    // A malformed target is outside the known social-site tab scope.
  }

  await clearDmHomeBypass(tabId);
}

async function redirectSocialRootBeforeSiteNavigation(tabId: number, url: string): Promise<void> {
  const messagesRedirect = getMessagesRedirect(url);
  if (!messagesRedirect) return;

  // A Home navigation is an explicit, per-tab opt-out from the DM-first
  // behavior. Clear any older fallback from a previous root visit before the
  // root navigation can commit.
  if (await hasDmHomeBypass(tabId, url) || await consumeDmHomeToken(tabId, url)) {
    pendingSocialRootRedirects.delete(tabId);
    socialRedirectsInFlight.delete(tabId);
    return;
  }

  let previousUrl: string | undefined;
  try {
    previousUrl = (await chrome.tabs.get(tabId)).url;
  } catch {
    // The commit fallback still redirects a root visit when the tab cannot be
    // read during its navigation transition.
  }
  pendingSocialRootRedirects.set(tabId, { messagesUrl: messagesRedirect, previousUrl });

  if (socialRedirectsInFlight.has(tabId)) return;
  socialRedirectsInFlight.set(tabId, messagesRedirect);
  setTimeout(() => {
    void (async () => {
      const pendingRedirect = pendingSocialRootRedirects.get(tabId);
      if (!pendingRedirect) return;
      const tab = await chrome.tabs.get(tabId);
      if (await hasDmHomeBypass(tabId, tab.url)) {
        pendingSocialRootRedirects.delete(tabId);
        return;
      }
      pendingSocialRootRedirects.delete(tabId);
      await chrome.tabs.update(tabId, { url: pendingRedirect.messagesUrl });
    })().catch((error) => {
      console.error('[SiteExperience] Delayed DM redirect failed:', error);
    }).finally(() => {
      socialRedirectsInFlight.delete(tabId);
    });
  }, SOCIAL_ROOT_REDIRECT_GRACE_MS);
}

async function syncActionIconForInstallType(): Promise<void> {
  try {
    const extensionInfo = await chrome.management.getSelf();
    const isLocalDevInstall = extensionInfo.installType === 'development';

    await chrome.action.setIcon({
      path: isLocalDevInstall ? LOCAL_DEV_ACTION_ICONS : PRODUCTION_ACTION_ICONS
    });
    await chrome.action.setTitle({
      title: isLocalDevInstall ? LOCAL_DEV_ACTION_TITLE : DEFAULT_ACTION_TITLE
    });
  } catch (error) {
    console.warn('[ActionIcon] Failed to sync install-type icon:', error);
  }
}

async function syncStoredUserEmailToFirestore(): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(['user']);
    const storedUser = storage.user as { uid?: string; email?: string } | undefined;
    const userId = storedUser?.uid;
    if (!userId) return;

    const userDocRef = doc(db, 'users', userId);
    await setDoc(userDocRef, {
      email: storedUser?.email || ''
    }, { merge: true });
  } catch (error) {
    console.error('[Auth] Failed to sync stored email:', error);
  }
}

async function clearAllUsageFromLocalStorage(appliedAt: number): Promise<void> {
  const now = Date.now();
  const resetSchedule = await getResetSchedule();
  const currentUsageDayKey = getCurrentUsageDayKey(
    now,
    resetSchedule.resetHour,
    resetSchedule.resetMinute
  );

  await chrome.storage.local.set({
    siteTimeData: {},
    ruleUsageData: {},
    dailyUsageHistory: {},
    [USAGE_JOURNAL_KEY]: {},
    [USAGE_CONTRIBUTION_STATE_KEY]: null,
    lastResetTimestamp: now,
    usageResetAppliedAt: appliedAt,
    [CURRENT_USAGE_DAY_KEY_STORAGE_KEY]: currentUsageDayKey
  });
}

async function checkAndApplyRemoteUsageReset(force: boolean = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastUsageResetCheckAt < USAGE_RESET_CHECK_INTERVAL_MS) {
    return;
  }
  lastUsageResetCheckAt = now;

  try {
    const storage = await chrome.storage.local.get(['user', 'usageResetAppliedAt']);
    const userId = storage.user?.uid as string | undefined;
    if (!userId) {
      return;
    }

    const userDocRef = doc(db, 'users', userId);
    const userDocSnap = await getDoc(userDocRef);
    if (!userDocSnap.exists()) {
      return;
    }

    const data = userDocSnap.data() as { usageResetRequestedAt?: number };
    const requestedAt = Number(data.usageResetRequestedAt || 0);
    const appliedAt = Number(storage.usageResetAppliedAt || 0);

    if (!requestedAt || requestedAt <= appliedAt) {
      return;
    }

    await withUsageStorageLock(async () => {
      const latest = await chrome.storage.local.get(['user', 'usageResetAppliedAt']);
      if (latest.user?.uid !== userId || requestedAt <= Number(latest.usageResetAppliedAt || 0)) return;
      stopCurrentTimer();
      await clearAllUsageFromLocalStorage(requestedAt);
      console.log('[UsageReset] Local usage storage cleared from remote request');
    });
  } catch (error) {
    console.error('[UsageReset] Failed to apply remote clear request:', error);
  }
}

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

function getCurrentUsageDayKey(
  timestamp: number,
  resetHour: number,
  resetMinute: number
): string {
  const usageDate = new Date(timestamp);
  const resetBoundary = new Date(timestamp);
  resetBoundary.setHours(resetHour, resetMinute, 0, 0);

  if (usageDate < resetBoundary) {
    usageDate.setDate(usageDate.getDate() - 1);
  }

  return format(usageDate, 'yyyy-MM-dd');
}

function parseResetTime(resetTime: unknown): { resetHour: number; resetMinute: number } {
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
}

async function getResetSchedule(): Promise<{ resetHour: number; resetMinute: number }> {
  if (!ALLOW_CUSTOM_RESET_TIME) {
    return parseResetTime(DEFAULT_DAILY_RESET_TIME);
  }

  const storage = await chrome.storage.local.get(['dailyResetTime']);
  return parseResetTime(storage.dailyResetTime);
}

function getPreviousBoundary(currentBoundary: number): number {
  const previousBoundary = new Date(currentBoundary);
  previousBoundary.setDate(previousBoundary.getDate() - 1);
  return previousBoundary.getTime();
}

function ensureCurrentUsageDayState(source: string, timestamp: number = Date.now()): Promise<void> {
  return withUsageStorageLock(() => ensureCurrentUsageDayStateInternal(source, timestamp));
}

async function ensureCurrentUsageDayStateInternal(source: string, timestamp: number = Date.now()): Promise<void> {
  const resetSchedule = await getResetSchedule();
  const expectedUsageDayKey = getCurrentUsageDayKey(timestamp, resetSchedule.resetHour, resetSchedule.resetMinute);
  const currentBoundary = getMostRecentResetBoundary(timestamp, resetSchedule.resetHour, resetSchedule.resetMinute);
  const storage = await chrome.storage.local.get([
    CURRENT_USAGE_DAY_KEY_STORAGE_KEY, 'user', 'siteTimeData', 'ruleUsageData', 'lastResetTimestamp'
  ]);
  const storedUsageDayKey = storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY];
  const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
  const latestSiteUpdate = Math.max(0, ...Object.values(siteTimeData).map((site) => Number(site.lastUpdated) || 0));
  if (shouldResetUsageDay({
    storedUsageDayKey, expectedUsageDayKey, currentBoundary,
    lastResetTimestamp: storage.lastResetTimestamp, latestSiteUpdate,
  })) {
    console.log(`[DailyReset] Advancing usage day via ${source}`);
    await resetAllSiteTime(storage.user?.uid || null, currentBoundary, getPreviousBoundary(currentBoundary));
  } else if (typeof storedUsageDayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(storedUsageDayKey)) {
    await chrome.storage.local.set({ [CURRENT_USAGE_DAY_KEY_STORAGE_KEY]: expectedUsageDayKey });
  }
}

async function redirectTabToRandomUrl(tabId: number): Promise<boolean> {
  const redirectStorage = await chrome.storage.local.get(['redirectUrls']);
  const rawRedirectUrls = Array.isArray(redirectStorage.redirectUrls)
    ? redirectStorage.redirectUrls
    : [];
  const normalizeRedirectUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (
        parsed.protocol === 'http:' ||
        parsed.protocol === 'https:' ||
        parsed.protocol === 'chrome-extension:'
      ) {
        return parsed.toString();
      }
      return null;
    } catch {
      try {
        // Backward-compatible cleanup: tolerate values saved without a scheme.
        return new URL(`https://${trimmed}`).toString();
      } catch {
        return null;
      }
    }
  };
  const redirectUrls = Array.from(
    new Set(
      rawRedirectUrls
        .map((url) => normalizeRedirectUrl(url))
        .filter((url): url is string => !!url)
    )
  );

  if (redirectUrls.length !== rawRedirectUrls.length) {
    await chrome.storage.local.set({ redirectUrls });
  }

  const fallbackRedirectUrl = 'https://cat-bounce.com/';
  const fallbackMessage = '[Timer] No valid redirect URLs configured - using cat-bounce fallback';

  if (redirectUrls.length === 0) {
    console.log(fallbackMessage);
  }

  const randomStartIndex = redirectUrls.length > 1
    ? Math.floor(Math.random() * redirectUrls.length)
    : 0;
  const rotatedRedirectUrls = redirectUrls.length > 0
    ? [
        ...redirectUrls.slice(randomStartIndex),
        ...redirectUrls.slice(0, randomStartIndex)
      ]
    : [];
  const redirectCandidates = Array.from(new Set([...rotatedRedirectUrls, fallbackRedirectUrl]));

  for (const redirectUrl of redirectCandidates) {
    console.log(`[Timer] Redirecting to: ${redirectUrl}`);
    try {
      await chrome.tabs.update(tabId, { url: redirectUrl });
      console.log(`[Timer] ✓ Redirected tab ${tabId} to ${redirectUrl}`);
      return true;
    } catch (error) {
      console.error(`[Timer] Failed to redirect tab to ${redirectUrl}:`, error);
    }
  }

  console.error('[Timer] Redirect attempts failed for all candidates');
  return false;
}

async function showSoftLimitPopup(tabId: number, siteKey: string, exceededRule: ExceededRuleInfo): Promise<boolean> {
  if (exceededRule.rule.ruleType !== 'soft') return false;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'show-soft-limit-popup',
      siteKey,
      ruleId: exceededRule.ruleId,
      derivedRemainingSnoozes: exceededRule.derivedRemainingSnoozes,
      plusOneDuration: exceededRule.rule.plusOneDuration || 0
    });

    return !!response?.handled;
  } catch (error) {
    console.error('[Timer] Failed to show soft-limit popup in content script:', error);
    return false;
  }
}

function getRuleTimeSpent(
  rule: CompiledRules[string],
  siteTimeData: Record<string, SiteTimeData>
): number {
  return rule.siteKeys.reduce((sum, memberSiteKey) => {
    return sum + (siteTimeData[memberSiteKey]?.timeSpent || 0);
  }, 0);
}

function getBlockingTimeRuleId(
  siteKey: string,
  siteRuleIds: SiteRuleIds,
  compiledRules: CompiledRules,
  now: Date
): string | null {
  const timeRuleIds = getApplicableTimeRuleIdsForSite(siteKey, siteRuleIds, compiledRules);

  for (const ruleId of timeRuleIds) {
    const rule = compiledRules[ruleId];
    if (!rule || rule.ruleType !== 'time') continue;

    const scheduleState = getTimeLimitScheduleState(rule.schedule, now);
    if (!scheduleState.isAllowed) {
      return ruleId;
    }
  }

  return null;
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

async function checkAndApplyScheduledDailyReset(source: string): Promise<void> {
  try {
    await ensureCurrentUsageDayState(source);
    void syncToFirestore();
  } catch (error) {
    console.error('[DailyReset] Scheduled reset check failed:', error);
  }
}

function getJournalEntry(
  storage: {
    siteTimeData?: Record<string, SiteTimeData>;
    usageJournal?: UsageJournal;
    usageContributionState?: UsageContributionState | null;
  }, dayKey: string, periodStart: number
): UsageJournalEntry {
  const existing = (storage[USAGE_JOURNAL_KEY] as UsageJournal | undefined)?.[dayKey];
  if (existing) return existing;
  const previous = storage[USAGE_CONTRIBUTION_STATE_KEY] as UsageContributionState | undefined;
  const siteTotals = previous?.dayKey === dayKey ? maxSiteTotals(previous.siteTotals || {}) : {};
  const baselineSiteTotals = Object.fromEntries(
    Object.entries(storage.siteTimeData || {}).map(([site, data]) => [site, data.timeSpent || 0])
  );
  return { siteTotals, baselineSiteTotals, periodStart, pending: true };
}

// Called only while holding the usage storage lock. Previous days remain in
// the journal until their final absolute contributions have been acknowledged.
async function resetAllSiteTime(
  _userId: string | null,
  periodEndBoundary?: number,
  _periodStartBoundary?: number
): Promise<void> {
  const storage = await chrome.storage.local.get([
    'siteTimeData', 'ruleUsageData', USAGE_JOURNAL_KEY, USAGE_CONTRIBUTION_STATE_KEY, CURRENT_USAGE_DAY_KEY_STORAGE_KEY
  ]);
  const now = Date.now();
  const resetSchedule = await getResetSchedule();
  const dayKey = getCurrentUsageDayKey(now, resetSchedule.resetHour, resetSchedule.resetMinute);
  // Another reset request may have waited behind the one that already applied.
  if (storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY] >= dayKey) return;
  const journal: UsageJournal = storage[USAGE_JOURNAL_KEY] || {};
  const previousDay = storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY]
    || getCurrentUsageDayKey((periodEndBoundary || now) - 1, resetSchedule.resetHour, resetSchedule.resetMinute);
  const previousStart = new Date(`${previousDay}T00:00:00`);
  previousStart.setHours(resetSchedule.resetHour, resetSchedule.resetMinute, 0, 0);
  journal[previousDay] = getJournalEntry(storage, previousDay, previousStart.getTime());
  const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
  const ruleUsageData: RuleUsageData = storage.ruleUsageData || {};
  for (const site of Object.values(siteTimeData)) { site.timeSpent = 0; site.lastUpdated = now; }
  for (const rule of Object.values(ruleUsageData)) { rule.timeSpent = 0; rule.lastUpdated = now; }
  await chrome.storage.local.set({
    siteTimeData, ruleUsageData, lastResetTimestamp: now,
    [CURRENT_USAGE_DAY_KEY_STORAGE_KEY]: dayKey,
    [USAGE_JOURNAL_KEY]: journal,
    [USAGE_CONTRIBUTION_STATE_KEY]: null,
  });
}

// ============================================================================
// CORE TIMER FUNCTIONS
// ============================================================================

/**
 * Syncs accumulated time to Firestore.
 * Called every 5 seconds by syncInterval or immediately on timer stop.
 */
function syncToFirestore(): Promise<void> {
  // A timer tick and a tab change can both request a sync. Serialize those
  // requests so each tick is acknowledged exactly once.
  if (usageSyncPromise) return usageSyncPromise;

  usageSyncPromise = syncToFirestoreInternal().finally(() => {
    usageSyncPromise = null;
  });
  return usageSyncPromise;
}

async function syncToFirestoreInternal(): Promise<void> {
  try {
    await ensureCurrentUsageDayState('sync-to-firestore');
    const batch = await withUsageStorageLock(async () => {
      const storage = await chrome.storage.local.get([
        'user', 'siteTimeData', USAGE_JOURNAL_KEY, USAGE_CONTRIBUTION_STATE_KEY, CURRENT_USAGE_DAY_KEY_STORAGE_KEY, 'usageResetAppliedAt'
      ]);
      if (!storage.user?.uid) return null;
      const dayKey = storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY] as string;
      const schedule = await getResetSchedule();
      const journal: UsageJournal = storage[USAGE_JOURNAL_KEY] || {};
      journal[dayKey] = getJournalEntry(storage, dayKey,
        getMostRecentResetBoundary(Date.now(), schedule.resetHour, schedule.resetMinute));
      await chrome.storage.local.set({ [USAGE_JOURNAL_KEY]: journal });
      return { userId: storage.user.uid as string, journal, resetAppliedAt: storage.usageResetAppliedAt };
    });
    if (!batch) return;
    const installationId = await getUsageInstallationId();
    for (const [dayKey, sent] of Object.entries(batch.journal)) {
      if (!sent.pending) continue;
      const result = await uploadUsage(batch.userId, installationId, dayKey, sent);
      await withUsageStorageLock(async () => {
        const storage = await chrome.storage.local.get([
          'user', 'siteTimeData', USAGE_JOURNAL_KEY, CURRENT_USAGE_DAY_KEY_STORAGE_KEY, 'usageResetAppliedAt'
        ]);
        if (storage.user?.uid !== batch.userId || storage.usageResetAppliedAt !== batch.resetAppliedAt) return;
        const journal: UsageJournal = storage[USAGE_JOURNAL_KEY] || {};
        if (!journal[dayKey]) return;
        const { journalEntry, visibleTotals } = acknowledgeUsage(journal[dayKey], sent, result.contributionTotals, result.entry.siteTotals);
        journal[dayKey] = journalEntry;
        const values: Record<string, unknown> = { [USAGE_JOURNAL_KEY]: journal };
        if (storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY] === dayKey) {
          const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
          for (const [site, seconds] of Object.entries(visibleTotals)) {
            siteTimeData[site] = {
              ...(siteTimeData[site] || { timeLimit: 0 }),
              timeSpent: Math.max(siteTimeData[site]?.timeSpent || 0, seconds),
              lastUpdated: Date.now()
            };
          }
          values.siteTimeData = siteTimeData;
        } else if (!journalEntry.pending) {
          delete journal[dayKey];
        }
        await chrome.storage.local.set(values);
      });
    }
  } catch (error) {
    console.error('[Timer] Usage sync failed; the journal is saved for retry:', error);
  }
}

/**
 * Called every second by the timer interval.
 * This is the ONLY place where time is incremented.
 * Also checks for daily reset boundary crossing on each tick.
 */
function timerTick(): Promise<void> {
  const currentTimer = activeTimer;
  return withUsageStorageLock(() => timerTickInternal(currentTimer));
}

async function timerTickInternal(currentTimer: ActiveTimerState | null): Promise<void> {
  // Capture current timer state at start of tick to avoid race conditions
  if (!currentTimer || activeTimer !== currentTimer || !currentTimer.intervalId) return;

  const tickStartTime = Date.now();
  const currentTickTimestamp = Date.now();
  console.log(`[Timer] Tick for tab ${currentTimer.tabId}, site ${currentTimer.siteKey}, interval ID: ${currentTimer.intervalId}`);

  // Verify tab still exists and is active
  try {
    const tab = await chrome.tabs.get(currentTimer.tabId);

    // Stop timer if tab is no longer active
    if (!tab.active) {
      console.log(`[Timer] Tab ${currentTimer.tabId} no longer active, stopping timer`);
      if (activeTimer === currentTimer) stopCurrentTimer();
      return;
    }
  } catch {
    console.log(`[Timer] Tab ${currentTimer.tabId} no longer exists, stopping timer`);
    if (activeTimer === currentTimer) stopCurrentTimer();
    return;
  }

  // Check if activeTimer changed during async operations (another timer started)
  if (activeTimer?.intervalId !== currentTimer.intervalId) {
    console.log(`[Timer] Timer changed during tick (old: ${currentTimer.intervalId}, new: ${activeTimer?.intervalId}), aborting this tick`);
    return;
  }

  const { siteKey } = currentTimer;

  await ensureCurrentUsageDayStateInternal('timer-tick', currentTickTimestamp);
  if (activeTimer !== currentTimer || !currentTimer.intervalId) return;

  // ============================================================================
  // INCREMENT TIME
  // ============================================================================
  const storage = await chrome.storage.local.get(['siteTimeData', 'siteRuleIds', 'compiledRules', 'ruleUsageData', USAGE_JOURNAL_KEY, USAGE_CONTRIBUTION_STATE_KEY, CURRENT_USAGE_DAY_KEY_STORAGE_KEY]);
  if (activeTimer !== currentTimer || !currentTimer.intervalId) return;
  const siteTimeData: Record<string, SiteTimeData> = storage.siteTimeData || {};
  const siteRuleIds: SiteRuleIds = storage.siteRuleIds || {};
  const compiledRules: CompiledRules = storage.compiledRules || {};
  const ruleUsageData: RuleUsageData = storage.ruleUsageData || {};

  if (siteTimeData[siteKey]) {
    const blockingTimeRuleId = getBlockingTimeRuleId(
      siteKey,
      siteRuleIds,
      compiledRules,
      new Date(currentTickTimestamp)
    );

    if (blockingTimeRuleId) {
      console.log(`[Timer] Time limit window closed for ${siteKey}: ${blockingTimeRuleId}`);
      stopCurrentTimer();
      await redirectTabToRandomUrl(currentTimer.tabId);
      return;
    }

    const oldTime = siteTimeData[siteKey].timeSpent;
    siteTimeData[siteKey].timeSpent += 1;
    siteTimeData[siteKey].lastUpdated = currentTickTimestamp;

    const selectedRuleId = getMostRestrictiveRuleIdForSite(siteKey, siteRuleIds, compiledRules);
    const timeRuleIds = getApplicableTimeRuleIdsForSite(siteKey, siteRuleIds, compiledRules);
    for (const ruleId of timeRuleIds) {
      const rule = compiledRules[ruleId];
      if (!rule) continue;

      ruleUsageData[ruleId] = {
        timeSpent: Math.max(0, Math.floor(getRuleTimeSpent(rule, siteTimeData))),
        lastUpdated: currentTickTimestamp
      };
    }

    const exceededRules: ExceededRuleInfo[] = [];

    for (const ruleId of selectedRuleId ? [selectedRuleId] : []) {
      const rule = compiledRules[ruleId];
      if (!rule || rule.ruleType === 'session' || rule.ruleType === 'time' || rule.timeLimit <= 0) continue;

      const totalTimeSpent = getRuleTimeSpent(rule, siteTimeData);
      const safeTotalTimeSpent = Math.max(0, Math.floor(totalTimeSpent));

      ruleUsageData[ruleId] = {
        timeSpent: safeTotalTimeSpent,
        lastUpdated: currentTickTimestamp
      };

      if (rule.ruleType === 'hard') {
        if (safeTotalTimeSpent >= rule.timeLimit) {
          exceededRules.push({
            ruleId,
            rule,
            usage: ruleUsageData[ruleId],
            effectiveLimit: rule.timeLimit,
            consumedOneMores: 0,
            derivedRemainingSnoozes: 0,
            shouldShowPopup: false,
            shouldBlock: true
          });
        }
        continue;
      }

      const plusOneDuration = rule.plusOneDuration || 0;
      const plusOnes = rule.plusOnes || 0;

      if (plusOneDuration <= 0 || plusOnes <= 0) {
        if (safeTotalTimeSpent >= rule.timeLimit) {
          exceededRules.push({
            ruleId,
            rule,
            usage: ruleUsageData[ruleId],
            effectiveLimit: rule.timeLimit,
            consumedOneMores: 0,
            derivedRemainingSnoozes: 0,
            shouldShowPopup: false,
            shouldBlock: true
          });
        }
        continue;
      }

      const previousTotalTimeSpent = Math.max(safeTotalTimeSpent - 1, 0);
      const rawPreviousConsumedOneMores = previousTotalTimeSpent >= rule.timeLimit
        ? 1 + Math.floor((previousTotalTimeSpent - rule.timeLimit) / plusOneDuration)
        : 0;
      const rawCurrentConsumedOneMores = safeTotalTimeSpent >= rule.timeLimit
        ? 1 + Math.floor((safeTotalTimeSpent - rule.timeLimit) / plusOneDuration)
        : 0;
      const rawUsedExtensions = safeTotalTimeSpent > rule.timeLimit
        ? Math.floor((safeTotalTimeSpent - rule.timeLimit) / plusOneDuration)
        : 0;
      const previousConsumedOneMores = Math.max(0, Math.min(rawPreviousConsumedOneMores, plusOnes));
      const consumedOneMores = Math.max(0, Math.min(rawCurrentConsumedOneMores, plusOnes));
      const usedExtensions = Math.max(0, Math.min(rawUsedExtensions, plusOnes));
      const derivedRemainingSnoozes = Math.max(plusOnes - usedExtensions, 0);
      const effectiveLimit = rule.timeLimit + (consumedOneMores * plusOneDuration);
      const maxSoftLimit = rule.timeLimit + (plusOnes * plusOneDuration);
      const shouldShowPopup = consumedOneMores > previousConsumedOneMores;
      const shouldBlock = safeTotalTimeSpent >= maxSoftLimit;

      if (shouldShowPopup || shouldBlock) {
        exceededRules.push({
          ruleId,
          rule,
          usage: ruleUsageData[ruleId],
          effectiveLimit,
          consumedOneMores,
          derivedRemainingSnoozes,
          shouldShowPopup,
          shouldBlock
        });
      }
    }

    const dayKey = storage[CURRENT_USAGE_DAY_KEY_STORAGE_KEY] as string;
    const schedule = await getResetSchedule();
    if (activeTimer !== currentTimer || !currentTimer.intervalId) return;
    const journal: UsageJournal = storage[USAGE_JOURNAL_KEY] || {};
    // Persist the increment and its absolute upload record in the same write,
    // before any network request.
    const entry = getJournalEntry(storage, dayKey,
      getMostRecentResetBoundary(currentTickTimestamp, schedule.resetHour, schedule.resetMinute));
    entry.siteTotals[siteKey] = (entry.siteTotals[siteKey] || 0) + 1;
    entry.baselineSiteTotals = maxSiteTotals(entry.baselineSiteTotals, { [siteKey]: siteTimeData[siteKey].timeSpent });
    entry.pending = true;
    journal[dayKey] = entry;
    await chrome.storage.local.set({ siteTimeData, ruleUsageData, [USAGE_JOURNAL_KEY]: journal });

    const tickDuration = Date.now() - tickStartTime;
    console.log(`[Timer] ✓ Incremented ${siteKey}: ${oldTime} → ${siteTimeData[siteKey].timeSpent}s (tick took ${tickDuration}ms)`);

    // ============================================================================
    // CHECK TIME LIMIT AND REDIRECT IF EXCEEDED
    // ============================================================================
    const { timeSpent, timeLimit } = siteTimeData[siteKey];
    const siteLimitExceeded = timeLimit > 0 && timeSpent >= timeLimit;
    if (exceededRules.length > 0) {
      const exceededDetails = exceededRules.map((exceeded) => {
        return `${exceeded.ruleId}: ${exceeded.usage.timeSpent}s / ${exceeded.effectiveLimit}s (consumed one-mores: ${exceeded.consumedOneMores}, remaining: ${exceeded.derivedRemainingSnoozes})`;
      });
      console.log(`[Timer] ⚠️ Aggregated limit exceeded for ${siteKey}:`, exceededDetails.join(', '));
    } else if (siteLimitExceeded && !selectedRuleId) {
      console.log(`[Timer] ⚠️ Site limit exceeded for ${siteKey}: ${timeSpent}s / ${timeLimit}s`);
    }

    const hardExceeded = exceededRules.find((exceeded) => exceeded.rule.ruleType === 'hard' && exceeded.shouldBlock);
    const softExceededWithSnooze = exceededRules.find((exceeded) =>
      exceeded.rule.ruleType === 'soft' && exceeded.shouldShowPopup
    );
    const softExceededWithoutSnooze = exceededRules.find((exceeded) =>
      exceeded.rule.ruleType === 'soft' && exceeded.shouldBlock
    );

    if (hardExceeded || softExceededWithoutSnooze || (siteLimitExceeded && !selectedRuleId)) {
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
function stopCurrentTimer(cancelPendingStart = true): void {
  if (cancelPendingStart) timerStartGeneration += 1;
  if (!activeTimer) {
    return;
  }

  console.log(`[Timer] Stopping timer - tabId: ${activeTimer.tabId}, site: ${activeTimer.siteKey}`);

  // Clear interval
  if (activeTimer.intervalId) {
    clearInterval(activeTimer.intervalId);
  }

  // Sync remaining seconds to Firestore immediately
  void syncToFirestore();

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
 * A generation check cancels stale requests after asynchronous work.
 */
async function startTimerForTab(
  tabId: number,
  siteKey: string,
  options: { skipImmediateSoftBoundaryCheck?: boolean; url?: string } = {}
): Promise<void> {
  const startGeneration = ++timerStartGeneration;
  void checkAndApplyRemoteUsageReset();
  console.log(`[Timer] Request to start timer - tabId: ${tabId}, site: ${siteKey}`);

  // Verify tab still exists and is active, and route social homepages before
  // any limit enforcement has a chance to redirect the user elsewhere.
  let currentUrl = options.url;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      console.log(`[Timer] Tab ${tabId} is not active, aborting`);
      return;
    }
    currentUrl ||= tab.url;
  } catch {
    console.log(`[Timer] Tab ${tabId} no longer exists`);
    return;
  }

  const messagesRedirect = currentUrl ? getMessagesRedirect(currentUrl) : null;
  if (messagesRedirect && !(await hasDmHomeBypass(tabId, currentUrl))) {
    if (startGeneration === timerStartGeneration) stopCurrentTimer();
    return;
  }

  const dmSettings = await chrome.storage.local.get(['restrictDmTime']);
  if (startGeneration !== timerStartGeneration) return;
  if (dmSettings.restrictDmTime !== true && isDirectMessageUrl(currentUrl)) {
    stopCurrentTimer();
    return;
  }

  if (activeTimer?.tabId === tabId && activeTimer.siteKey === siteKey && activeTimer.intervalId) return;

  // Retire the old interval before preparing its replacement.
  if (activeTimer?.intervalId) {
    console.log(`[Timer] IMMEDIATELY clearing existing interval ID: ${activeTimer.intervalId}`);
    clearInterval(activeTimer.intervalId);
    activeTimer.intervalId = null;
  }

  // Now properly stop and clean up the rest
  if (activeTimer) {
    console.log(`[Timer] Stopping existing timer - tabId: ${activeTimer.tabId}, site: ${activeTimer.siteKey}`);
    stopCurrentTimer(false);
  }

  await ensureCurrentUsageDayState('start-timer');
  void hydrateSharedUsageForCurrentDay();

  // Check if site has a rule
  const storage = await withUsageStorageLock(async () => {
    const latest = await chrome.storage.local.get([
      'siteRules', 'siteTimeData', 'siteRuleIds', 'compiledRules', 'ruleUsageData'
    ]);
    if (startGeneration !== timerStartGeneration) return latest;
    const rule = latest.siteRules?.[siteKey];
    if (!rule) return latest;
    latest.siteTimeData ||= {};
    latest.siteTimeData[siteKey] = {
      ...(latest.siteTimeData[siteKey] || { timeSpent: 0 }),
      timeLimit: rule.timeLimit, lastUpdated: Date.now()
    };
    await chrome.storage.local.set({ siteTimeData: latest.siteTimeData });
    return latest;
  });
  if (startGeneration !== timerStartGeneration) return;
  const siteRules: SiteRules = storage.siteRules || {};
  const siteRuleIds: SiteRuleIds = storage.siteRuleIds || {};
  const compiledRules: CompiledRules = storage.compiledRules || {};
  const ruleUsageData: RuleUsageData = storage.ruleUsageData || {};

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
  }

  // Evaluate limits immediately when a tab becomes active so interval-boundary
  // soft popups can appear on newly focused tabs without waiting for the next tick.
  const now = Date.now();
  const selectedRuleId = getMostRestrictiveRuleIdForSite(siteKey, siteRuleIds, compiledRules);
  let shouldRedirectImmediately = false;
  let softBoundaryRule: ExceededRuleInfo | null = null;

  const blockingTimeRuleId = getBlockingTimeRuleId(siteKey, siteRuleIds, compiledRules, new Date(now));
  if (blockingTimeRuleId) {
    console.log(`[Timer] Time limit window is closed for ${siteKey}: ${blockingTimeRuleId}`);
    await chrome.storage.local.set({ ruleUsageData });
    await redirectTabToRandomUrl(tabId);
    return;
  }

  for (const ruleId of selectedRuleId ? [selectedRuleId] : []) {
    const rule = compiledRules[ruleId];
    if (!rule || rule.ruleType === 'session' || rule.ruleType === 'time' || rule.timeLimit <= 0) continue;

    const totalTimeSpent = getRuleTimeSpent(rule, siteTimeData);
    const safeTotalTimeSpent = Math.max(0, Math.floor(totalTimeSpent));

    ruleUsageData[ruleId] = {
      timeSpent: safeTotalTimeSpent,
      lastUpdated: now
    };

    if (rule.ruleType === 'hard') {
      if (safeTotalTimeSpent >= rule.timeLimit) {
        shouldRedirectImmediately = true;
        break;
      }
      continue;
    }

    const plusOneDuration = rule.plusOneDuration || 0;
    const plusOnes = rule.plusOnes || 0;

    if (plusOneDuration <= 0 || plusOnes <= 0) {
      if (safeTotalTimeSpent >= rule.timeLimit) {
        shouldRedirectImmediately = true;
        break;
      }
      continue;
    }

    const maxSoftLimit = rule.timeLimit + (plusOnes * plusOneDuration);
    if (safeTotalTimeSpent >= maxSoftLimit) {
      shouldRedirectImmediately = true;
      break;
    }

    if (safeTotalTimeSpent >= rule.timeLimit) {
      const delta = safeTotalTimeSpent - rule.timeLimit;
      if (delta % plusOneDuration === 0 && !options.skipImmediateSoftBoundaryCheck) {
        const rawConsumedOneMores = 1 + Math.floor(delta / plusOneDuration);
        const consumedOneMores = Math.max(0, Math.min(rawConsumedOneMores, plusOnes));
        const rawUsedExtensions = safeTotalTimeSpent > rule.timeLimit
          ? Math.floor((safeTotalTimeSpent - rule.timeLimit) / plusOneDuration)
          : 0;
        const usedExtensions = Math.max(0, Math.min(rawUsedExtensions, plusOnes));
        const derivedRemainingSnoozes = Math.max(plusOnes - usedExtensions, 0);

        const candidate: ExceededRuleInfo = {
          ruleId,
          rule,
          usage: ruleUsageData[ruleId],
          effectiveLimit: rule.timeLimit + (consumedOneMores * plusOneDuration),
          consumedOneMores,
          derivedRemainingSnoozes,
          shouldShowPopup: true,
          shouldBlock: false
        };

        if (
          !softBoundaryRule ||
          candidate.derivedRemainingSnoozes < softBoundaryRule.derivedRemainingSnoozes
        ) {
          softBoundaryRule = candidate;
        }
      }
    }
  }

  // Fallback for direct site limit checks when no compiled rules apply.
  if (!shouldRedirectImmediately && !softBoundaryRule && !selectedRuleId) {
    const directLimit = siteTimeData[siteKey].timeLimit;
    if (directLimit > 0 && siteTimeData[siteKey].timeSpent >= directLimit) {
      shouldRedirectImmediately = true;
    }
  }

  await chrome.storage.local.set({ ruleUsageData });

  if (shouldRedirectImmediately) {
    console.log(`[Timer] Immediate limit enforcement for ${siteKey} on tab focus`);
    await redirectTabToRandomUrl(tabId);
    return;
  }

  if (softBoundaryRule) {
    console.log(
      `[Timer] Immediate soft boundary for ${siteKey}: ${softBoundaryRule.ruleId} (${softBoundaryRule.usage.timeSpent}s)`
    );
    const didShowPopup = await showSoftLimitPopup(tabId, siteKey, softBoundaryRule);
    if (!didShowPopup) {
      await redirectTabToRandomUrl(tabId);
    }
    return;
  }

  if (startGeneration !== timerStartGeneration) return;

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

  void syncToFirestore();

  // Start Firestore sync interval (only ONE for entire extension)
  if (!syncIntervalId) {
    syncIntervalId = setInterval(() => syncToFirestore(), FIRESTORE_SYNC_INTERVAL);
  }

  // Log next reset time for debugging
  try {
    const resetSchedule = await getResetSchedule();
    const now = new Date();
    const todayReset = new Date();
    todayReset.setHours(resetSchedule.resetHour, resetSchedule.resetMinute, 0, 0);
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

void syncActionIconForInstallType();

// Listen for when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated");
  void syncActionIconForInstallType();
  chrome.alarms.create(USAGE_RESET_ALARM_NAME, { periodInMinutes: 1 });
  syncStoredUserEmailToFirestore();
  checkAndApplyRemoteUsageReset(true);
  void checkAndApplyScheduledDailyReset('onInstalled').then(() => {
    void hydrateSharedUsageForCurrentDay();
    return recoverActiveTimer();
  });
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

  if (message.action === 'get-current-tab-id') {
    sendResponse({ success: true, tabId: sender.tab?.id ?? null });
    return false;
  }

  if (message.action === 'close-tutorial-instagram-tab') {
    (async () => {
      try {
        const senderTabId = sender.tab?.id;
        if (!senderTabId) {
          sendResponse({ success: false, error: 'Missing sender tabId' });
          return;
        }

        const storage = await chrome.storage.local.get([TUTORIAL_INSTAGRAM_BADGE_STEP_KEY]);
        const stepState = storage[TUTORIAL_INSTAGRAM_BADGE_STEP_KEY] as TutorialInstagramBadgeStepState | undefined;

        if (stepState?.status !== 'completed' || stepState.tabId !== senderTabId) {
          sendResponse({ success: false, error: 'Sender tab is not the completed tutorial Instagram tab' });
          return;
        }

        if (activeTimer?.tabId === senderTabId) {
          stopCurrentTimer();
        }

        sendResponse({ success: true });
        try {
          await chrome.tabs.remove(senderTabId);
        } catch (removeError) {
          console.error('[Tutorial] Failed to remove tutorial Instagram tab after completion:', removeError);
        }
      } catch (error) {
        console.error('[Tutorial] Failed to close tutorial Instagram tab:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  // ============================================================================
  // TIMER CONTROL MESSAGES
  // ============================================================================

  if (message.action === 'tab-focused') {
    if (sender.tab?.id) {
      startTimerForTab(sender.tab.id, message.siteKey, { url: message.url });
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
      startTimerForTab(sender.tab.id, message.newSiteKey, { url: message.url });
    }
    return false;
  }

  if (message.action === 'open-site-home') {
    (async () => {
      const tabId = sender.tab?.id;
      const homeUrl = sender.tab?.url ? getHomeUrlForMessages(sender.tab.url) : null;
      if (!tabId || !homeUrl) {
        sendResponse({ success: false });
        return;
      }

      const storage = await chrome.storage.session.get(DM_HOME_BYPASSES_KEY);
      const bypasses = (storage[DM_HOME_BYPASSES_KEY] || {}) as Record<string, string>;
      await chrome.storage.session.set({
        [DM_HOME_BYPASSES_KEY]: { ...bypasses, [String(tabId)]: homeUrl }
      });
      // Do not let a fallback scheduled for an earlier root visit re-apply
      // after the user explicitly asks to open Home.
      pendingSocialRootRedirects.delete(tabId);
      socialRedirectsInFlight.delete(tabId);
      await chrome.tabs.update(tabId, { url: homeUrl });
      sendResponse({ success: true });
    })().catch((error) => {
      console.error('[SiteExperience] Failed to open social home:', error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.action === 'entered-social-home-from-dm') {
    (async () => {
      const tabId = sender.tab?.id;
      const homeUrl = typeof message.url === 'string' && getMessagesRedirect(message.url)
        ? `${new URL(message.url).origin}/`
        : null;
      if (!tabId || !homeUrl || !isDirectMessageUrl(message.previousUrl)) {
        sendResponse({ success: false });
        return;
      }

      const storage = await chrome.storage.session.get(DM_HOME_BYPASSES_KEY);
      const bypasses = (storage[DM_HOME_BYPASSES_KEY] || {}) as Record<string, string>;
      await chrome.storage.session.set({
        [DM_HOME_BYPASSES_KEY]: { ...bypasses, [String(tabId)]: homeUrl }
      });
      pendingSocialRootRedirects.delete(tabId);
      sendResponse({ success: true });
    })().catch((error) => {
      console.error('[SiteExperience] Failed to retain native social Home mode:', error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.action === 'arm-social-home-token') {
    (async () => {
      const tabId = sender.tab?.id;
      const currentUrl = sender.tab?.url;
      if (!tabId || !currentUrl || !isDirectMessageUrl(currentUrl)) {
        sendResponse({ success: false });
        return;
      }
      const tokens = (await chrome.storage.session.get(DM_HOME_TOKENS_KEY))[DM_HOME_TOKENS_KEY] || {};
      await chrome.storage.session.set({
        [DM_HOME_TOKENS_KEY]: {
          ...tokens,
          [String(tabId)]: { origin: new URL(currentUrl).origin, expiresAt: Date.now() + SOCIAL_HOME_TOKEN_TTL_MS }
        }
      });
      sendResponse({ success: true });
    })().catch((error) => {
      console.error('[SiteExperience] Failed to arm Home token:', error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.action === 'signIn') {
    syncStoredUserEmailToFirestore();
    checkAndApplyRemoteUsageReset(true);
    checkAndApplyScheduledDailyReset('signIn');
    return false;
  }

  if (message.action === 'sync-user-profile') {
    (async () => {
      try {
        const payload = (message.user || {}) as {
          uid?: string;
          email?: string;
          displayName?: string;
          photoURL?: string;
        };

        if (!payload.uid) {
          sendResponse({ success: false, error: 'Missing user uid' });
          return;
        }

        const userDocRef = doc(db, 'users', payload.uid);
        await setDoc(userDocRef, {
          email: payload.email || '',
          displayName: payload.displayName || '',
          photoURL: payload.photoURL || '',
          profileSyncedAt: Date.now()
        }, { merge: true });

        sendResponse({ success: true });
      } catch (error) {
        console.error('[Auth] Failed to sync user profile:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message.action === 'soft-limit-snooze') {
    (async () => {
      try {
        const siteKey = message.siteKey as string | undefined;
        const tabId = sender.tab?.id;

        if (!siteKey || !tabId) {
          sendResponse({ success: false, error: 'Missing snooze payload' });
          return;
        }

        await startTimerForTab(tabId, siteKey, { skipImmediateSoftBoundaryCheck: true });
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
          const { arrayUnion } = await import('firebase/firestore/lite');

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

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  void redirectSocialRootBeforeSiteNavigation(details.tabId, details.url);
});

// Some sites (notably TikTok) issue a server redirect quickly enough to win
// the first tabs.update race. Keep the root-navigation intent and redirect on
// the resulting top-level commit as a deterministic fallback.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const pendingRedirect = pendingSocialRootRedirects.get(details.tabId);
  if (!pendingRedirect) return;
  if (details.url === pendingRedirect.messagesUrl) {
    pendingSocialRootRedirects.delete(details.tabId);
    return;
  }

  // The delayed redirect above gives in-page Home transitions time to mark
  // their tab as Home mode, while preserving DM-first behavior for fresh
  // root visits and TikTok server redirects.
});

// Tab activation (user switches tabs)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const navigationUrl = changeInfo.url;
  if (!navigationUrl) return;

  void (async () => {
    try {
      const messagesRedirect = getMessagesRedirect(navigationUrl);
      if (messagesRedirect) {
        if (!(await hasDmHomeBypass(tabId, navigationUrl))) {
          await redirectSocialRootBeforeSiteNavigation(tabId, navigationUrl);
          return;
        }
      } else {
        await clearDmHomeBypassAfterLeavingSite(tabId, navigationUrl);
      }

      if (!tab.active) return;
      const siteKey = normalizeHostname(new URL(navigationUrl).hostname);
      await startTimerForTab(tabId, siteKey, { url: navigationUrl });
    } catch {
      // Ignore non-web URLs and malformed navigation events.
    }
  })();
});

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
      startTimerForTab(activeInfo.tabId, response.siteKey, { url: response.url });
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
  void clearDmHomeBypass(tabId);
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
            startTimerForTab(tabs[0].id, response.siteKey, { url: response.url });
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
  await syncActionIconForInstallType();
  chrome.alarms.create(USAGE_RESET_ALARM_NAME, { periodInMinutes: 1 });
  await syncStoredUserEmailToFirestore();
  await checkAndApplyRemoteUsageReset(true);
  await checkAndApplyScheduledDailyReset('onStartup');
  void hydrateSharedUsageForCurrentDay();
  await hydrateCompiledRuleIndexes();

  await recoverActiveTimer();
});

async function recoverActiveTimer(): Promise<void> {
  if (activeTimer) return;
  const focusedWindow = await chrome.windows.getLastFocused();
  if (!focusedWindow.focused) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0 && tabs[0].id) {
    try {
      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'get-current-site'
      }).catch(() => null);

      if (response?.siteKey && response?.hasSiteRule) {
        await startTimerForTab(tabs[0].id, response.siteKey, { url: response.url });
      } else if (!response && tabs[0].url?.startsWith('http')) {
        // Existing tabs may have an invalidated content script after an
        // extension reload. The worker can recover tracking from the tab URL.
        await startTimerForTab(tabs[0].id, normalizeHostname(new URL(tabs[0].url).hostname), { url: tabs[0].url });
      }
    } catch {
      // Content script may not be injected yet - this is normal on startup
      console.log('[Timer] Content script not ready (startup)');
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === USAGE_RESET_ALARM_NAME) {
    checkAndApplyRemoteUsageReset(true);
    checkAndApplyScheduledDailyReset('alarm');
    void syncToFirestore();
    void recoverActiveTimer();
  }
});
