import type {
  DailyUsageHistoryEntry,
  Group,
  Rule,
  RuleTarget,
  SiteTimeData,
} from '@/hooks/useUserData';
import { DEFAULT_DAILY_RESET_TIME } from '@/lib/constants';

/**
 * Get the normalized hostname from a URL
 */
export function getNormalizedHostname(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^www\./, '');
  }
}

/**
 * Recursively expand group items to get all URLs
 */
function expandGroupItems(groupId: string, groups: Group[], visited = new Set<string>()): string[] {
  if (visited.has(groupId)) {
    return []; // Prevent infinite recursion
  }
  visited.add(groupId);

  const group = groups.find(g => g.id === groupId);
  if (!group) return [];

  const urls: string[] = [];

  for (const item of group.items) {
    if (item.startsWith('group:')) {
      const nestedGroupId = item.substring(6);
      urls.push(...expandGroupItems(nestedGroupId, groups, visited));
    } else {
      urls.push(item);
    }
  }

  return urls;
}

/**
 * Expand rule targets to get all URLs
 */
export function expandTargetsToUrls(targets: RuleTarget[], groups: Group[]): string[] {
  const urls: string[] = [];

  for (const target of targets) {
    if (target.type === 'url') {
      urls.push(target.id);
    } else if (target.type === 'group') {
      urls.push(...expandGroupItems(target.id, groups));
    }
  }

  return urls;
}

/**
 * Format seconds to a readable string
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Calculate percentage of time used
 */
export function calculateProgress(timeSpent: number, timeLimit: number): number {
  if (timeLimit === 0) return 0;
  return Math.min(Math.round((timeSpent / timeLimit) * 100), 100);
}

/**
 * Get color class based on progress percentage
 */
export function getProgressColor(percentage: number): string {
  if (percentage >= 90) return 'bg-red-500';
  if (percentage >= 75) return 'bg-orange-500';
  if (percentage >= 50) return 'bg-yellow-500';
  return 'bg-green-500';
}

/**
 * Get status text based on rule type and progress
 */
export function getStatusText(
  ruleType: 'hard' | 'soft' | 'session',
  timeSpent: number,
  timeLimit: number
): string {
  const percentage = calculateProgress(timeSpent, timeLimit);

  if (timeSpent >= timeLimit) {
    return 'Limit Reached';
  }

  if (percentage >= 90) {
    return 'Almost Done';
  }

  if (percentage >= 50) {
    return 'Halfway';
  }

  return 'On Track';
}

export interface SiteStats {
  siteKey: string;
  displayName: string;
  rule: Rule;
  timeSpent: number;
  timeLimit: number;
  percentage: number;
  remaining: number;
  status: string;
  color: string;
}

export interface RuleProgressSiteBreakdownItem {
  siteKey: string;
  timeSpent: number;
}

export interface RuleProgressStats {
  ruleId: string;
  ruleName: string;
  ruleType: 'hard' | 'soft' | 'session';
  timeSpent: number;
  timeLimit: number;
  percentage: number;
  siteBreakdown: RuleProgressSiteBreakdownItem[];
}

export interface UsageTimelinePoint {
  dayKey: string;
  timestamp: number;
  totalTimeSpent: number;
  siteTotals: Record<string, number>;
}

/**
 * Build comprehensive site statistics from user data
 */
export function buildSiteStats(
  rules: Rule[],
  groups: Group[],
  timeTracking: Record<string, SiteTimeData>
): SiteStats[] {
  const stats: SiteStats[] = [];

  for (const rule of rules) {
    const urls = expandTargetsToUrls(rule.targets, groups);

    for (const url of urls) {
      const siteKey = getNormalizedHostname(url);
      const tracking = timeTracking[siteKey];

      const timeSpent = tracking?.timeSpent || 0;
      const timeLimit = rule.timeLimit * 60; // Convert minutes to seconds
      const percentage = calculateProgress(timeSpent, timeLimit);
      const remaining = Math.max(timeLimit - timeSpent, 0);

      stats.push({
        siteKey,
        displayName: url,
        rule,
        timeSpent,
        timeLimit,
        percentage,
        remaining,
        status: getStatusText(rule.type, timeSpent, timeLimit),
        color: getProgressColor(percentage),
      });
    }
  }

  return stats;
}

/**
 * Build rule-level progress with aggregate time across all sites in each rule.
 */
export function buildRuleProgressStats(
  rules: Rule[],
  groups: Group[],
  timeTracking: Record<string, SiteTimeData>
): RuleProgressStats[] {
  return rules
    .filter((rule) => rule.timeLimit > 0)
    .map((rule) => {
      const urls = expandTargetsToUrls(rule.targets, groups);
      const uniqueSiteKeys = Array.from(new Set(urls.map((url) => getNormalizedHostname(url))));
      const siteBreakdown = uniqueSiteKeys
        .map((siteKey) => ({
          siteKey,
          timeSpent: timeTracking[siteKey]?.timeSpent || 0,
        }))
        .filter((site) => site.timeSpent > 0)
        .sort((a, b) => b.timeSpent - a.timeSpent);

      const timeSpent = siteBreakdown.reduce((sum, site) => sum + site.timeSpent, 0);
      const baseLimitSeconds = Math.max(0, Math.round(rule.timeLimit * 60));
      const softExtraSeconds =
        rule.type === 'soft'
          ? Math.max(0, rule.plusOnes || 0) * Math.max(0, rule.plusOneDuration || 0)
          : 0;
      const timeLimit = baseLimitSeconds + softExtraSeconds;
      const percentage = calculateProgress(timeSpent, timeLimit);

      return {
        ruleId: rule.id,
        ruleName: rule.name || 'Unnamed Rule',
        ruleType: rule.type,
        timeSpent,
        timeLimit,
        percentage,
        siteBreakdown,
      };
    })
    .sort((a, b) => {
      if (b.percentage !== a.percentage) return b.percentage - a.percentage;
      return b.timeSpent - a.timeSpent;
    });
}

/**
 * Build timeline points using tracked sites that belong to at least one rule.
 * Each point represents one day's total tracked seconds and optional per-site totals.
 */
export function buildTotalTrackedUsageTimeline(
  rules: Rule[],
  groups: Group[],
  timeTracking: Record<string, SiteTimeData>,
  dailyUsageHistory: Record<string, DailyUsageHistoryEntry> = {},
  lastDailyResetTimestamp?: number
): UsageTimelinePoint[] {
  const getLocalDayKey = (timestamp: number): string => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getDayBounds = (dayKey: string): { start: number; end: number } | null => {
    const parts = dayKey.split('-').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
      return null;
    }

    const [year, month, day] = parts;
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime() - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }

    return { start, end };
  };

  const now = Date.now();
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
  const resetSchedule = parseResetTime(DEFAULT_DAILY_RESET_TIME);
  const getUsageDayKeyForTimestamp = (timestamp: number): string => {
    const usageDate = new Date(timestamp);
    const resetBoundary = new Date(timestamp);
    resetBoundary.setHours(resetSchedule.resetHour, resetSchedule.resetMinute, 0, 0);
    if (usageDate < resetBoundary) {
      usageDate.setDate(usageDate.getDate() - 1);
    }
    return getLocalDayKey(usageDate.getTime());
  };

  const boundaryDerivedTodayKey = getUsageDayKeyForTimestamp(now);
  const resetDerivedDayKey =
    Number.isFinite(Number(lastDailyResetTimestamp)) &&
    Number(lastDailyResetTimestamp) > 0 &&
    Number(lastDailyResetTimestamp) <= now
      ? getLocalDayKey(Number(lastDailyResetTimestamp))
      : null;
  const todayKey =
    resetDerivedDayKey && resetDerivedDayKey > boundaryDerivedTodayKey
      ? resetDerivedDayKey
      : boundaryDerivedTodayKey;

  const getChartTimestampForDay = (dayKey: string): number | null => {
    const bounds = getDayBounds(dayKey);
    if (!bounds) return null;
    // Timeline points are daily buckets (not time-of-day events), so anchor at local day start.
    return bounds.start;
  };

  const trackedSiteKeys = new Set<string>();
  for (const rule of rules) {
    const urls = expandTargetsToUrls(rule.targets, groups);
    for (const url of urls) {
      trackedSiteKeys.add(getNormalizedHostname(url));
    }
  }
  if (trackedSiteKeys.size === 0) {
    Object.keys(timeTracking).forEach((siteKey) => trackedSiteKeys.add(siteKey));
  }

  const sanitizeSiteTotals = (raw: unknown): Record<string, number> => {
    if (!raw || typeof raw !== 'object') return {};
    const normalized: Record<string, number> = {};
    for (const [siteKey, value] of Object.entries(raw as Record<string, unknown>)) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      if (seconds > 0) normalized[siteKey] = seconds;
    }
    return normalized;
  };

  const historyPoints: UsageTimelinePoint[] = Object.entries(dailyUsageHistory)
    .map(([dayKey, entry]) => {
      // Never render future calendar days, even if bad/old test data exists.
      if (dayKey > todayKey) return null;

      const rawTotal = Number(entry?.totalTimeSpent ?? 0);
      const safeTimestamp = getChartTimestampForDay(dayKey);
      if (safeTimestamp == null || !Number.isFinite(rawTotal)) {
        return null;
      }
      const siteTotals = sanitizeSiteTotals(entry?.siteTotals);
      return {
        dayKey,
        timestamp: safeTimestamp,
        totalTimeSpent: Math.max(0, Math.floor(rawTotal)),
        siteTotals,
      };
    })
    .filter((point): point is UsageTimelinePoint => point !== null)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  const currentSiteTotals: Record<string, number> = {};
  let currentTotal = 0;
  trackedSiteKeys.forEach((siteKey) => {
    const tracking = timeTracking[siteKey];
    if (!tracking) return;
    const currentSeconds = Math.max(0, Math.floor(Number(tracking.timeSpent) || 0));
    if (currentSeconds > 0) {
      currentSiteTotals[siteKey] = currentSeconds;
      currentTotal += currentSeconds;
    }
  });

  const todayTimestamp = getChartTimestampForDay(todayKey) ?? now;
  const todayOnlyPoint: UsageTimelinePoint[] = [
    {
      dayKey: todayKey,
      timestamp: todayTimestamp,
      totalTimeSpent: Math.floor(currentTotal),
      siteTotals: currentSiteTotals,
    },
  ];

  const byDateKey = new Map<string, UsageTimelinePoint>();
  [...historyPoints, ...todayOnlyPoint].forEach((point) => {
    const key = point.dayKey;
    const existing = byDateKey.get(key);
    if (!existing || point.timestamp >= existing.timestamp) {
      byDateKey.set(key, point);
    }
  });

  return Array.from(byDateKey.values()).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/**
 * Calculate overall statistics
 */
export interface OverallStats {
  totalSitesTracked: number;
  totalTimeSpent: number;
  totalTimeLimit: number;
  sitesOverLimit: number;
  sitesNearLimit: number;
  averageProgress: number;
}

export function calculateOverallStats(siteStats: SiteStats[]): OverallStats {
  const totalTimeSpent = siteStats.reduce((sum, stat) => sum + stat.timeSpent, 0);
  const totalTimeLimit = siteStats.reduce((sum, stat) => sum + stat.timeLimit, 0);
  const sitesOverLimit = siteStats.filter(stat => stat.percentage >= 100).length;
  const sitesNearLimit = siteStats.filter(stat => stat.percentage >= 75 && stat.percentage < 100).length;
  const averageProgress = siteStats.length > 0
    ? Math.round(siteStats.reduce((sum, stat) => sum + stat.percentage, 0) / siteStats.length)
    : 0;

  return {
    totalSitesTracked: siteStats.length,
    totalTimeSpent,
    totalTimeLimit,
    sitesOverLimit,
    sitesNearLimit,
    averageProgress,
  };
}
