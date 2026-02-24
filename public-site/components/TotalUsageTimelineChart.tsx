import { useMemo, useState } from 'react';
import type { UsageTimelinePoint } from '@/lib/statsHelpers';
import { formatTime } from '@/lib/statsHelpers';

interface TotalUsageTimelineChartProps {
  points: UsageTimelinePoint[];
}

type RangeFilter = 'week' | 'month' | 'year' | 'all';

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 260;
const PADDING = { top: 18, right: 16, bottom: 42, left: 68 };

const formatYAxisTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${safeSeconds}s`;
};

const formatDateTick = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
};

const formatTooltipDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function TotalUsageTimelineChart({ points }: TotalUsageTimelineChartProps) {
  const [range, setRange] = useState<RangeFilter>('all');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [referenceNow] = useState<number>(() => Date.now());

  const historicalSummary = useMemo(() => {
    if (points.length <= 7) return null;

    const dailyTotals = points.map((point) => Math.max(0, Math.floor(point.totalTimeSpent)));
    if (dailyTotals.length === 0) return null;

    const mean = dailyTotals.reduce((sum, value) => sum + value, 0) / dailyTotals.length;
    const variance =
      dailyTotals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / dailyTotals.length;
    const standardDeviation = Math.sqrt(variance);

    const sorted = [...dailyTotals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    const weekdayTotals: number[] = [];
    const weekendTotals: number[] = [];

    points.forEach((point) => {
      const day = new Date(point.timestamp).getDay();
      const total = Math.max(0, Math.floor(point.totalTimeSpent));
      if (day === 0 || day === 6) {
        weekendTotals.push(total);
      } else {
        weekdayTotals.push(total);
      }
    });

    const weekdayAverage =
      weekdayTotals.length > 0
        ? Math.round(weekdayTotals.reduce((sum, value) => sum + value, 0) / weekdayTotals.length)
        : null;
    const weekendAverage =
      weekendTotals.length > 0
        ? Math.round(weekendTotals.reduce((sum, value) => sum + value, 0) / weekendTotals.length)
        : null;

    return {
      average: Math.round(mean),
      standardDeviation: Math.round(standardDeviation),
      median: Math.round(median),
      weekdayAverage,
      weekendAverage,
    };
  }, [points]);

  const filteredPoints = useMemo(() => {
    if (points.length === 0) return [];
    if (range === 'all') return points;

    const cutoff = referenceNow - RANGE_MS[range];
    return points.filter((point) => point.timestamp >= cutoff);
  }, [points, range, referenceNow]);

  const chart = useMemo(() => {
    if (filteredPoints.length === 0) return null;

    const minX = filteredPoints[0].timestamp;
    const maxX = filteredPoints[filteredPoints.length - 1].timestamp;
    const maxY = Math.max(1, ...filteredPoints.map((point) => point.totalTimeSpent));
    const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

    const scaleX = (value: number): number => {
      if (maxX === minX) return PADDING.left + innerWidth / 2;
      return PADDING.left + ((value - minX) / (maxX - minX)) * innerWidth;
    };

    const scaleY = (value: number): number => {
      return PADDING.top + innerHeight - (value / maxY) * innerHeight;
    };

    const plotted = filteredPoints.map((point) => ({
      point,
      x: scaleX(point.timestamp),
      y: scaleY(point.totalTimeSpent),
    }));

    const linePath = plotted
      .map((entry, index) => `${index === 0 ? 'M' : 'L'} ${entry.x} ${entry.y}`)
      .join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const value = Math.round(maxY * ratio);
      return {
        value,
        y: scaleY(value),
      };
    });

    const xTickCount = Math.min(5, Math.max(2, plotted.length));
    const xTicks = Array.from({ length: xTickCount }, (_, index) => {
      const ratio = xTickCount === 1 ? 0 : index / (xTickCount - 1);
      const timestamp = minX + (maxX - minX) * ratio;
      return {
        timestamp,
        x: scaleX(timestamp),
      };
    });

    return {
      plotted,
      linePath,
      yTicks,
      xTicks,
      total: filteredPoints[filteredPoints.length - 1].totalTimeSpent,
    };
  }, [filteredPoints]);

  const hoveredPoint = hoveredIndex == null || !chart ? null : chart.plotted[hoveredIndex];

  return (
    <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Usage Over Time</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Total tracked time across all sites that belong to at least one rule
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Past</span>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as RangeFilter)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {historicalSummary && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Avg Daily Time
            </div>
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {formatTime(historicalSummary.average)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Std Dev (Daily)
            </div>
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {formatTime(historicalSummary.standardDeviation)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Median Daily Time
            </div>
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {formatTime(historicalSummary.median)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Weekday vs Weekend Avg
            </div>
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {historicalSummary.weekdayAverage == null
                ? 'N/A'
                : formatTime(historicalSummary.weekdayAverage)}{' '}
              /{' '}
              {historicalSummary.weekendAverage == null
                ? 'N/A'
                : formatTime(historicalSummary.weekendAverage)}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Weekday / Weekend
            </div>
          </div>
        </div>
      )}

      {chart ? (
        <>
          <div className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Current total: {formatTime(chart.total)}
          </div>
          <div className="relative">
            {hoveredPoint && (
              <div
                className="pointer-events-none absolute z-10 rounded-md border border-zinc-200 bg-white/95 px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
                style={{
                  left: `${(hoveredPoint.x / CHART_WIDTH) * 100}%`,
                  top: `${(hoveredPoint.y / CHART_HEIGHT) * 100}%`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                <div className="font-medium text-zinc-900 dark:text-zinc-50">
                  {formatTooltipDate(hoveredPoint.point.timestamp)}
                </div>
                <div className="text-zinc-600 dark:text-zinc-300">
                  {formatTime(hoveredPoint.point.totalTimeSpent)}
                </div>
              </div>
            )}
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-60 w-full">
              <line
                x1={PADDING.left}
                x2={PADDING.left}
                y1={PADDING.top}
                y2={CHART_HEIGHT - PADDING.bottom}
                stroke="currentColor"
                className="text-zinc-300 dark:text-zinc-700"
                strokeWidth="1"
              />
              <line
                x1={PADDING.left}
                x2={CHART_WIDTH - PADDING.right}
                y1={CHART_HEIGHT - PADDING.bottom}
                y2={CHART_HEIGHT - PADDING.bottom}
                stroke="currentColor"
                className="text-zinc-300 dark:text-zinc-700"
                strokeWidth="1"
              />

              {chart.yTicks.map((tick) => (
                <g key={tick.y}>
                  <line
                    x1={PADDING.left}
                    x2={CHART_WIDTH - PADDING.right}
                    y1={tick.y}
                    y2={tick.y}
                    stroke="currentColor"
                    className="text-zinc-200/80 dark:text-zinc-700/60"
                    strokeWidth="1"
                  />
                  <text
                    x={PADDING.left - 8}
                    y={tick.y}
                    textAnchor="end"
                    dominantBaseline="central"
                    className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
                  >
                    {formatYAxisTime(tick.value)}
                  </text>
                </g>
              ))}

              {chart.xTicks.map((tick) => (
                <g key={tick.x}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={CHART_HEIGHT - PADDING.bottom}
                    y2={CHART_HEIGHT - PADDING.bottom + 4}
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-zinc-700"
                    strokeWidth="1"
                  />
                  <text
                    x={tick.x}
                    y={CHART_HEIGHT - PADDING.bottom + 16}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
                  >
                    {formatDateTick(tick.timestamp)}
                  </text>
                </g>
              ))}

              <path
                d={chart.linePath}
                fill="none"
                stroke="currentColor"
                className="text-indigo-500 dark:text-indigo-400"
                strokeWidth="1.3"
              />

              {chart.plotted.map((entry, index) => (
                <circle
                  key={`dot-${index}`}
                  cx={entry.x}
                  cy={entry.y}
                  r={hoveredIndex === index ? 3.6 : 3}
                  fill="currentColor"
                  className="text-indigo-500 dark:text-indigo-400"
                />
              ))}

              {hoveredPoint && (
                <g pointerEvents="none">
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.y}
                    r="4"
                    fill="currentColor"
                    className="text-indigo-400/30 dark:text-indigo-300/30"
                  />
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.y}
                    r="4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    className="text-indigo-300 dark:text-indigo-200"
                  >
                    <animate
                      attributeName="r"
                      values="4;8;4"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.45;0.1;0.45"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              )}

              {chart.plotted.map((entry, index) => (
                <circle
                  key={`hit-${index}`}
                  cx={entry.x}
                  cy={entry.y}
                  r="12"
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              ))}

              <text
                x={(PADDING.left + (CHART_WIDTH - PADDING.right)) / 2}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
              >
                Date
              </text>
              <text
                x={14}
                y={(PADDING.top + (CHART_HEIGHT - PADDING.bottom)) / 2}
                transform={`rotate(-90 14 ${(PADDING.top + (CHART_HEIGHT - PADDING.bottom)) / 2})`}
                textAnchor="middle"
                className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
              >
                Time
              </text>
            </svg>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          No timeline data in this range.
        </p>
      )}
    </section>
  );
}
