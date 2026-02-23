'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { usePublicUserData } from '@/hooks/useShareSettings';
import { useParams } from 'next/navigation';
import RuleProgressList from '@/components/RuleProgressList';
import TotalUsageTimelineChart from '@/components/TotalUsageTimelineChart';
import { buildRuleProgressStats, buildTotalTrackedUsageTimeline } from '@/lib/statsHelpers';
import type { UserData } from '@/hooks/useUserData';
import Link from 'next/link';

export default function PublicStatsPage() {
  const params = useParams();
  const shareId = params.shareId as string;
  const { userId, loading: userIdLoading, error: userIdError } = usePublicUserData(shareId);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(userIdLoading);
      return;
    }

    const fetchUserData = async () => {
      try {
        const userDocRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({
            rules: data.rules || [],
            groups: data.groups || [],
            timeTracking: data.timeTracking || {},
            dailyUsageHistory: data.dailyUsageHistory || {},
            lastDailyResetTimestamp: data.lastDailyResetTimestamp,
          });
        } else {
          setError(new Error('User data not found'));
        }
      } catch (err) {
        console.error('Error fetching user data:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [userId, userIdLoading]);

  if (loading || userIdLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-lg text-zinc-600 dark:text-zinc-400">Loading statistics...</div>
        </div>
      </div>
    );
  }

  if (error || userIdError) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-lg bg-red-50 p-6 text-center dark:bg-red-900/20">
            <h2 className="mb-2 text-lg font-semibold text-red-900 dark:text-red-100">
              Unable to Load Statistics
            </h2>
            <p className="text-sm text-red-700 dark:text-red-300">
              {error?.message || userIdError?.message || 'This share link may be invalid or disabled.'}
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-lg text-zinc-600 dark:text-zinc-400">No data available</div>
        </div>
      </div>
    );
  }

  const ruleStats = buildRuleProgressStats(userData.rules, userData.groups, userData.timeTracking);
  const usageTimeline = buildTotalTrackedUsageTimeline(
    userData.rules,
    userData.groups,
    userData.timeTracking,
    userData.dailyUsageHistory
  );

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-end gap-4">
            <Link href="/" className="text-xl font-bold leading-none text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
              Public Stats
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Public Usage Statistics
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Viewing a shared statistics dashboard
          </p>
        </div>

        {/* Info Banner */}
        <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
          <div className="flex items-start gap-3">
            <svg
              className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
                You&apos;re viewing someone&apos;s shared statistics
              </div>
              <div className="mt-1 text-xs text-blue-800 dark:text-blue-200">
                This user has chosen to publicly share their usage data. Want to track your own?{' '}
                <Link href="/login" className="font-medium underline">
                  Sign up here
                </Link>
              </div>
            </div>
          </div>
        </div>

        <TotalUsageTimelineChart points={usageTimeline} />

        {/* Rule Progress List */}
        <RuleProgressList rules={ruleStats} />

        {/* Last Reset Info */}
        {userData.lastDailyResetTimestamp && (
          <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            Last daily reset: {new Date(userData.lastDailyResetTimestamp).toLocaleString()}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer>
        <div className="mx-auto max-w-7xl px-6 pb-4 pt-3 text-center text-sm">
          <div className="mx-auto mb-3 h-px w-full max-w-xs bg-gradient-to-r from-transparent via-zinc-300/70 to-transparent dark:via-zinc-700/70" />
          <Link href="/privacy" className="text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
