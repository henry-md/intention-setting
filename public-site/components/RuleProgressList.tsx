import { useMemo, useState } from 'react';
import type { RuleProgressStats } from '@/lib/statsHelpers';

interface RuleProgressListProps {
  rules: RuleProgressStats[];
}

function formatClock(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function RuleProgressList({ rules }: RuleProgressListProps) {
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      if (b.percentage !== a.percentage) return b.percentage - a.percentage;
      return b.timeSpent - a.timeSpent;
    });
  }, [rules]);

  const toggleRule = (ruleId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">
          No active rules configured yet. Add rules in your extension to track progress here.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-end justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Rule Progress</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Total usage across all sites in each rule
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {sortedRules.map((rule) => {
          const cappedPercentage = Math.min(Math.max(rule.percentage, 0), 100);
          const isOverLimit = rule.timeSpent > rule.timeLimit && rule.timeLimit > 0;
          const isExpanded = expandedRuleIds.has(rule.ruleId);
          const progressColor = isOverLimit ? 'bg-amber-400' : 'bg-indigo-500';

          return (
            <div
              key={rule.ruleId}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/40"
            >
              <button
                type="button"
                onClick={() => toggleRule(rule.ruleId)}
                className="w-full px-4 py-4 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-12">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {rule.ruleName}
                    </div>
                    <div className="mt-2 text-4xl font-bold leading-none tracking-tight text-zinc-900 dark:text-zinc-50">
                      {formatClock(rule.timeSpent)}
                    </div>
                  </div>

                  <div className="w-full md:min-w-0 md:flex-1">
                    <div className="mb-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{formatClock(rule.timeSpent)} / {formatClock(rule.timeLimit)}</span>
                      <span>
                        {rule.percentage}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className={`h-full transition-all ${progressColor}`}
                        style={{ width: `${cappedPercentage}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{rule.siteBreakdown.length} site{rule.siteBreakdown.length === 1 ? '' : 's'}</span>
                      <span>{isExpanded ? 'Hide details' : 'Show details'}</span>
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-2 grid grid-cols-[1fr_auto] gap-3 border-b border-zinc-200 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <span>Site</span>
                    <span>Time Spent</span>
                  </div>
                  <div className="space-y-1">
                    {rule.siteBreakdown.map((site, index) => (
                      <div
                        key={`${rule.ruleId}-${site.siteKey}`}
                        className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-2 text-sm ${
                          index % 2 === 0
                            ? 'bg-zinc-100 dark:bg-zinc-800/70'
                            : 'bg-zinc-50 dark:bg-zinc-900/60'
                        }`}
                      >
                        <span className="truncate text-zinc-800 dark:text-zinc-200">{site.siteKey}</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {formatClock(site.timeSpent)}
                        </span>
                      </div>
                    ))}
                    {rule.siteBreakdown.length === 0 && (
                      <div className="rounded-md bg-zinc-100 px-2 py-2 text-sm text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
                        No tracked sites in this rule yet.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
