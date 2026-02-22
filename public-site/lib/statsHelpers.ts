import type { Rule, Group, SiteTimeData, RuleTarget } from '@/hooks/useUserData';

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
