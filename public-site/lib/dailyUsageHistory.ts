export interface DailyUsageHistoryEntry {
  totalTimeSpent: number;
  trackedSiteCount?: number;
  siteTotals?: Record<string, number>;
  periodStart: number;
  periodEnd: number;
  capturedAt: number;
}

export type DailyUsageHistory = Record<string, DailyUsageHistoryEntry>;

function normalizeSiteTotals(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};

  const normalized: Record<string, number> = {};
  for (const [siteKey, value] of Object.entries(raw as Record<string, unknown>)) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    if (seconds > 0) {
      normalized[siteKey] = seconds;
    }
  }

  return normalized;
}

function normalizeHistoryEntry(raw: unknown): DailyUsageHistoryEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const entry = raw as Record<string, unknown>;
  const totalTimeSpent = Math.max(0, Math.floor(Number(entry.totalTimeSpent) || 0));
  const periodStart = Number(entry.periodStart);
  const periodEnd = Number(entry.periodEnd);
  const capturedAt = Number(entry.capturedAt);

  if (![periodStart, periodEnd, capturedAt].every((value) => Number.isFinite(value))) {
    return null;
  }

  const trackedSiteCountRaw = Number(entry.trackedSiteCount);
  const trackedSiteCount = Number.isFinite(trackedSiteCountRaw)
    ? Math.max(0, Math.floor(trackedSiteCountRaw))
    : undefined;

  return {
    totalTimeSpent,
    trackedSiteCount,
    siteTotals: normalizeSiteTotals(entry.siteTotals),
    periodStart,
    periodEnd,
    capturedAt
  };
}

export function parseLegacyDailyUsageHistory(raw: unknown): DailyUsageHistory {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const parsed: DailyUsageHistory = {};
  for (const [dayKey, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedEntry = normalizeHistoryEntry(value);
    if (normalizedEntry) {
      parsed[dayKey] = normalizedEntry;
    }
  }

  return parsed;
}
