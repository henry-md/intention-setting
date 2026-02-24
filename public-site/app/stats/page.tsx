'use client';

import { useEffect, useState } from 'react';
import SharingToggle from '@/components/SharingToggle';
import TotalUsageTimelineChart from '@/components/TotalUsageTimelineChart';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import { buildTotalTrackedUsageTimeline } from '@/lib/statsHelpers';
import Link from 'next/link';

type ThemeMode = 'light' | 'dark';
const THEME_STORAGE_KEY = 'intention-site-theme';

export default function StatsPage() {
  const { user, loading: authLoading, signOut, signInWithGoogle } = useAuth();
  const { userData, hasUserDocument, loading, error } = useUserData();
  const [showPendingReviewModal, setShowPendingReviewModal] = useState(false);
  const [isGodTabHidden, setIsGodTabHidden] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
  }, [themeMode]);

  const isGodUser =
    user?.email === 'henrymdeutsch@gmail.com';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isTypingTarget) return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code !== 'KeyH') return;
      if (!isGodUser) return;

      setIsGodTabHidden((prev) => !prev);
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [isGodUser]);

  const handleThemeToggle = () => {
    const nextTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
    }
  };

  const isStatsLoading = !!user && loading;
  const usageTimeline = userData
    ? buildTotalTrackedUsageTimeline(
        userData.rules,
        userData.groups,
        userData.timeTracking,
        userData.dailyUsageHistory,
        userData.lastDailyResetTimestamp
      )
    : [];

  return (
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
        {/* Header */}
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-end gap-6">
              <Link href="/stats" className="text-xl font-bold leading-none text-zinc-900 dark:text-zinc-50">
                Intention Setter
              </Link>
              <nav className="flex items-end gap-4">
                <Link
                  href="/stats"
                  className="text-sm font-medium leading-none text-zinc-900 dark:text-zinc-50"
                >
                  Statistics
                </Link>
                {isGodUser && !isGodTabHidden && (
                  <Link
                    href="/god"
                    className="text-sm font-medium leading-none text-zinc-900 dark:text-zinc-50"
                  >
                    God
                  </Link>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleThemeToggle}
                aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {themeMode === 'dark' ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2" />
                    <path d="M12 20v2" />
                    <path d="m4.93 4.93 1.41 1.41" />
                    <path d="m17.66 17.66 1.41 1.41" />
                    <path d="M2 12h2" />
                    <path d="M20 12h2" />
                    <path d="m6.34 17.66-1.41 1.41" />
                    <path d="m19.07 4.93-1.41 1.41" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3a7.5 7.5 0 1 0 9 9A9 9 0 1 1 12 3z" />
                  </svg>
                )}
              </button>
              {user ? (
                <>
                  <button
                    onClick={signOut}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  >
                    Sign Out
                  </button>
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt="Profile"
                      title={user.email || undefined}
                      className="h-8 w-8 rounded-full border border-zinc-300 dark:border-zinc-700"
                    />
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              Usage Statistics
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Click any day on the timeline to see ranked URL usage for that day
            </p>
          </div>

          {!user && !authLoading ? (
            <div className="flex min-h-[55vh] items-center justify-center">
              <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Sign In Required
                </h2>
                <p className="text-zinc-600 dark:text-zinc-400">
                  You need to sign in to see stats about yourself.
                </p>
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Sign In with Google
                </button>
              </div>
            </div>
          ) : isStatsLoading || authLoading ? (
            <div className="flex min-h-[55vh] items-center justify-center">
              <div className="text-lg text-zinc-600 dark:text-zinc-400">
                Loading your statistics...
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[55vh] items-center justify-center">
              <div className="rounded-lg bg-red-50 p-6 text-red-800 dark:bg-red-900/20 dark:text-red-400">
                Error loading statistics: {error.message}
              </div>
            </div>
          ) : hasUserDocument === false ? (
            <div className="flex min-h-[55vh] items-center justify-center">
              <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                  No Synced Data Yet
                </h2>
                <p className="mb-6 text-zinc-600 dark:text-zinc-400">
                  Download the Chrome extension that sets limits and syncs data to this page{' '}
                  <AlertDialog open={showPendingReviewModal} onOpenChange={setShowPendingReviewModal}>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="text-blue-600 underline transition-colors hover:text-blue-500 dark:text-blue-400"
                      >
                        here
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Hod up..
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          The Chrome extension is currently pending review.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction>
                          OK
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>.
                </p>
              </div>
            </div>
          ) : !userData ? (
            <div className="flex min-h-[55vh] items-center justify-center">
              <div className="text-lg text-zinc-600 dark:text-zinc-400">No data available</div>
            </div>
          ) : (
            <>
              {/* Sharing Toggle */}
              <div className="mb-8">
                <SharingToggle />
              </div>

              <TotalUsageTimelineChart points={usageTimeline} />

              {/* Last Reset Info */}
              {userData.lastDailyResetTimestamp && (
                <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
                  Last daily reset:{' '}
                  {new Date(userData.lastDailyResetTimestamp).toLocaleString()}
                </div>
              )}
            </>
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
