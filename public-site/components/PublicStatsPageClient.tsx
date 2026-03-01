'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { usePublicUserData } from '@/hooks/useShareSettings';
import TotalUsageTimelineChart from '@/components/TotalUsageTimelineChart';
import { buildTotalTrackedUsageTimeline } from '@/lib/statsHelpers';
import type { UserData } from '@/hooks/useUserData';
import { parseDailyUsageHistory } from '@/lib/dailyUsageHistory';
import { useAuth } from '@/contexts/AuthContext';
import { REQUIRE_SIGN_IN_TO_SPY } from '@/lib/constants';
import Link from 'next/link';

interface PublicStatsPageClientProps {
  shareId: string;
}

export default function PublicStatsPageClient({ shareId }: PublicStatsPageClientProps) {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const { userId, loading: userIdLoading, error: userIdError } = usePublicUserData(shareId);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const shouldRequireSignInToView = REQUIRE_SIGN_IN_TO_SPY;

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
      setSignInError(null);
    } catch (err) {
      console.error('Sign in failed:', err);
      setSignInError('Google sign in failed. Please try again.');
    }
  };

  useEffect(() => {
    if (shouldRequireSignInToView && (authLoading || !user)) {
      return;
    }

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
            dailyUsageHistory: parseDailyUsageHistory(data.dailyUsageHistory),
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
  }, [authLoading, shouldRequireSignInToView, user, userId, userIdLoading]);

  if (shouldRequireSignInToView && authLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-lg text-zinc-600 dark:text-zinc-400">Checking sign-in status...</div>
        </div>
      </div>
    );
  }

  if (shouldRequireSignInToView && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="mb-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Sign In Required
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              You must sign in with Google to view shared public statistics.
            </p>
            <button
              type="button"
              onClick={handleSignIn}
              className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Sign In with Google
            </button>
            {signInError && (
              <p className="mt-3 text-sm text-red-700 dark:text-red-300">
                {signInError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading || userIdLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
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
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
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
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
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

  const usageTimeline = buildTotalTrackedUsageTimeline(userData.dailyUsageHistory);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-end justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold leading-none text-zinc-900 dark:text-zinc-50">
            Intention Setter
          </Link>
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium leading-none text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            Public Stats
          </span>
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

        {userData.lastDailyResetTimestamp && (
          <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            Last daily reset: {new Date(userData.lastDailyResetTimestamp).toLocaleString()}
          </div>
        )}
      </main>

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
