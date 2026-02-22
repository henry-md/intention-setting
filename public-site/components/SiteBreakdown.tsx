import type { SiteStats } from '@/lib/statsHelpers';
import { formatTime } from '@/lib/statsHelpers';

interface SiteBreakdownProps {
  stats: SiteStats[];
}

export default function SiteBreakdown({ stats }: SiteBreakdownProps) {
  if (stats.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">
          No rules configured yet. Set up rules in your Chrome extension to start tracking your
          usage.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Site Breakdown</h2>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {stats.map((stat, index) => (
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
              <span className="text-zinc-600 dark:text-zinc-400">{stat.percentage}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
