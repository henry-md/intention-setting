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
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['week', 'Past week'],
            ['month', 'Past month'],
            ['year', 'Past year'],
            ['all', 'All time'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                range === value
                  ? 'border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
                  key={index}
                  cx={entry.x}
                  cy={entry.y}
                  r="3"
                  fill="currentColor"
                  className="cursor-pointer text-indigo-500 dark:text-indigo-400"
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
