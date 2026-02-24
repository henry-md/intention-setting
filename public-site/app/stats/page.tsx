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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
      setIsMobileMenuOpen(false);
    } catch (error) {
      console.error('Sign in failed:', error);
    }
  };

  const handleSignOut = () => {
    signOut();
    setIsMobileMenuOpen(false);
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
          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <Link href="/stats" className="text-3xl font-bold leading-none text-zinc-900 dark:text-zinc-50 sm:text-xl">
                  Intention Setter
                </Link>
                <nav className="hidden items-end gap-4 sm:flex">
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
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                aria-label="Toggle mobile menu"
                aria-expanded={isMobileMenuOpen}
                className="inline-flex h-11 w-11 items-center justify-center text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 sm:hidden"
              >
                {isMobileMenuOpen ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M3 12h18" />
                    <path d="M3 18h18" />
                  </svg>
                )}
              </button>
              <div className="hidden items-center justify-end gap-3 sm:flex">
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
                      onClick={handleSignOut}
                      className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 sm:px-4"
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
                    className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 sm:px-4"
                  >
                    Sign In
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 sm:hidden">
            <button
              type="button"
              aria-label="Close mobile menu backdrop"
              className="absolute inset-0 w-full bg-zinc-950/45 backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <aside className="absolute right-0 top-0 h-full w-[68%] min-w-[260px] max-w-[380px] border-l border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95">
              <div className="flex items-center justify-end border-b border-zinc-200 px-5 py-5 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-label="Close mobile menu"
                  className="inline-flex h-10 w-10 items-center justify-center text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <nav className="space-y-1 p-5">
                <Link
                  href="/stats"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-2 py-3 text-lg font-medium text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 20V10" />
                    <path d="M12 20V4" />
                    <path d="M18 20v-7" />
                  </svg>
                  Statistics
                </Link>
                {isGodUser && !isGodTabHidden && (
                  <Link
                    href="/god"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-2 py-3 text-lg font-medium text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3 4 9l8 4 8-4-8-6Z" />
                      <path d="m4 15 8 4 8-4" />
                    </svg>
                    God
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleThemeToggle}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-lg font-medium text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3a7.5 7.5 0 1 0 9 9A9 9 0 1 1 12 3z" />
                  </svg>
                  {themeMode === 'dark' ? 'Dark Mode' : 'Light Mode'}
                </button>
                <button
                  type="button"
                  onClick={user ? handleSignOut : handleSignIn}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-lg font-medium text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  {user ? 'Sign Out' : 'Sign In'}
                </button>
                {user && (
                  <div className="mt-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <div className="flex items-center gap-3 px-2 py-2">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt="Profile"
                          title={user.email || undefined}
                          className="h-11 w-11 rounded-full border border-zinc-300 dark:border-zinc-700"
                        />
                      ) : (
                        <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-zinc-200 text-base font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100">
                          {(user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Profile</p>
                        {user.email && (
                          <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </nav>
            </aside>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-8">
            <h1 className="mb-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
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
