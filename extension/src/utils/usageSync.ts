import { firebaseConfig } from './firebase';
import { getFirebaseIdToken } from './firebaseIdToken';
import type { UsageJournalEntry } from './usageJournal';

async function requestUsage(userId: string, route: string, payload: object) {
  const token = await getFirebaseIdToken(userId);
  const response = await fetch(
    `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/${route}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Usage request failed (${response.status})`);
  return data;
}

export async function loadUsage(userId: string, dayKey: string): Promise<{ siteTotals: Record<string, number> } | null> {
  const data = await requestUsage(userId, 'getUsage', { dayKey });
  if (data.entry === null) return null;
  if (!data.entry?.siteTotals) throw new Error('Invalid usage read response');
  return data.entry;
}

export async function uploadUsage(
  userId: string,
  installationId: string,
  dayKey: string,
  entry: UsageJournalEntry
): Promise<{ entry: { siteTotals: Record<string, number> }; contributionTotals: Record<string, number> }> {
  const data = await requestUsage(userId, 'syncUsage', { installationId, dayKey, ...entry });
  if (!data?.entry?.siteTotals || !data?.contributionTotals) throw new Error('Invalid usage sync response');
  return data;
}
