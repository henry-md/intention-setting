import type { OverallStats } from '@/lib/statsHelpers';
import { formatTime } from '@/lib/statsHelpers';

interface StatsOverviewProps {
  stats: OverallStats;
}

export default function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Sites Tracked
        </div>
        <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          {stats.totalSitesTracked}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Total Time Spent
        </div>
        <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          {formatTime(stats.totalTimeSpent)}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Average Progress
        </div>
        <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          {stats.averageProgress}%
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Sites Over Limit
        </div>
        <div className="text-3xl font-bold text-red-600 dark:text-red-400">
          {stats.sitesOverLimit}
        </div>
      </div>
    </div>
  );
}
