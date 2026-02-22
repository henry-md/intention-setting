'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import {
  buildSiteStats,
  calculateOverallStats,
  formatTime,
  getProgressColor,
} from '@/lib/statsHelpers';
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
            <div className="flex items-center gap-6">
              <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                Intention Setter
              </Link>
              <nav className="flex gap-4">
                <Link
                  href="/dashboard"
                  className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Dashboard
                </Link>
                <Link
                  href="/stats"
                  className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
                >
                  Statistics
                </Link>
              </nav>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              Sign Out
            </button>
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

          {/* Overall Stats Cards */}
          <div className="mb-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Sites Tracked
              </div>
              <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                {overallStats.totalSitesTracked}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total Time Spent
              </div>
              <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                {formatTime(overallStats.totalTimeSpent)}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Average Progress
              </div>
              <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                {overallStats.averageProgress}%
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Sites Over Limit
              </div>
              <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                {overallStats.sitesOverLimit}
              </div>
            </div>
          </div>

          {/* Sites List */}
          {sortedStats.length > 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Site Breakdown
                </h2>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {sortedStats.map((stat, index) => (
                  <div key={`${stat.siteKey}-${index}`} className="px-6 py-4">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">
                          {stat.displayName}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                            {stat.rule.type}
                          </span>
                          {stat.rule.name && <span>{stat.rule.name}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {formatTime(stat.timeSpent)} / {formatTime(stat.timeLimit)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {stat.remaining > 0
                            ? `${formatTime(stat.remaining)} remaining`
                            : 'Limit reached'}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className={`h-full transition-all ${stat.color}`}
                        style={{ width: `${stat.percentage}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`font-medium ${
                          stat.percentage >= 90
                            ? 'text-red-600 dark:text-red-400'
                            : stat.percentage >= 75
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {stat.status}
                      </span>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {stat.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-zinc-600 dark:text-zinc-400">
                No rules configured yet. Set up rules in your Chrome extension to start tracking
                your usage.
              </p>
            </div>
          )}

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
