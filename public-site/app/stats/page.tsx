'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import StatsOverview from '@/components/StatsOverview';
import SiteBreakdown from '@/components/SiteBreakdown';
import SharingToggle from '@/components/SharingToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import { buildSiteStats, calculateOverallStats } from '@/lib/statsHelpers';
import Link from 'next/link';

export default function StatsPage() {
  const { user, signOut } = useAuth();
  const { userData, loading, error } = useUserData();

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
          <div className="text-lg text-zinc-600 dark:text-zinc-400">
            Loading your statistics...
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (error) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
          <div className="rounded-lg bg-red-50 p-6 text-red-800 dark:bg-red-900/20 dark:text-red-400">
            Error loading statistics: {error.message}
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (!userData) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
          <div className="text-lg text-zinc-600 dark:text-zinc-400">No data available</div>
        </div>
      </ProtectedRoute>
    );
  }

  const siteStats = buildSiteStats(userData.rules, userData.groups, userData.timeTracking);
  const overallStats = calculateOverallStats(siteStats);

  // Sort sites by percentage (highest first)
  const sortedStats = [...siteStats].sort((a, b) => b.percentage - a.percentage);

  return (
    <ProtectedRoute>
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
                {user?.email === 'henrymdeutsch@gmail.com' && (
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
                onClick={signOut}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                Sign Out
              </button>
              {user?.photoURL && (
                <img
                  src={user.photoURL}
                  alt="Profile"
                  title={user.email || undefined}
                  className="h-8 w-8 rounded-full border border-zinc-300 dark:border-zinc-700"
                />
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
              Track your time across all sites and see how close you are to your limits
            </p>
          </div>

          {/* Sharing Toggle */}
          <div className="mb-8">
            <SharingToggle />
          </div>

          {/* Overall Stats Cards */}
          <div className="mb-8">
            <StatsOverview stats={overallStats} />
          </div>

          {/* Sites List */}
          <SiteBreakdown stats={sortedStats} />

          {/* Last Reset Info */}
          {userData.lastDailyResetTimestamp && (
            <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
              Last daily reset:{' '}
              {new Date(userData.lastDailyResetTimestamp).toLocaleString()}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
