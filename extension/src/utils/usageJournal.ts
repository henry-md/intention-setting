export interface UsageJournalEntry {
  siteTotals: Record<string, number>;
  baselineSiteTotals: Record<string, number>;
  periodStart: number;
  pending: boolean;
}

export type UsageJournal = Record<string, UsageJournalEntry>;

export const maxSiteTotals = (...groups: Record<string, number>[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const group of groups) {
    for (const [site, seconds] of Object.entries(group)) {
      if (Number.isSafeInteger(seconds) && seconds > 0) {
        result[site] = Math.max(result[site] || 0, seconds);
      }
    }
  }
  return result;
};

export function acknowledgeUsage(
  current: UsageJournalEntry,
  sent: UsageJournalEntry,
  serverContribution: Record<string, number>,
  serverTotals: Record<string, number>
): { journalEntry: UsageJournalEntry; visibleTotals: Record<string, number> } {
  const siteTotals = maxSiteTotals(current.siteTotals, serverContribution);
  const visibleTotals = { ...serverTotals };
  let pending = false;
  for (const [site, seconds] of Object.entries(current.siteTotals)) {
    const unsent = Math.max(0, seconds - (sent.siteTotals[site] || 0));
    siteTotals[site] = Math.max(seconds, (serverContribution[site] || 0) + unsent);
    visibleTotals[site] = (serverTotals[site] || 0) + unsent;
    pending ||= unsent > 0;
  }
  for (const [site, seconds] of Object.entries(current.baselineSiteTotals)) {
    pending ||= seconds > (visibleTotals[site] || 0);
  }
  return {
    journalEntry: {
      ...current,
      siteTotals,
      baselineSiteTotals: maxSiteTotals(current.baselineSiteTotals, visibleTotals),
      pending,
    },
    visibleTotals,
  };
}
