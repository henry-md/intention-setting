interface UsageDayResetInput {
  storedUsageDayKey: unknown;
  expectedUsageDayKey: string;
  currentBoundary: number;
  lastResetTimestamp: unknown;
  latestSiteUpdate: unknown;
}

export function shouldResetUsageDay({
  storedUsageDayKey,
  expectedUsageDayKey,
  currentBoundary,
  lastResetTimestamp,
  latestSiteUpdate,
}: UsageDayResetInput): boolean {
  // A recorded usage day takes precedence over an older reset timestamp.
  // Moving the clock backwards must not clear the current day's counters.
  if (typeof storedUsageDayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(storedUsageDayKey)) {
    return expectedUsageDayKey > storedUsageDayKey;
  }

  const timestamps = [lastResetTimestamp, latestSiteUpdate]
    .map(Number)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const latestTimestamp = Math.max(0, ...timestamps);
  return latestTimestamp > 0 && latestTimestamp < currentBoundary;
}
