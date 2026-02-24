import { type TouchEvent, useEffect, useMemo, useRef, useState } from 'react';
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

const MOBILE_BREAKPOINT_MAX_WIDTH = 639;
const DESKTOP_CHART_WIDTH = 1000;
const DESKTOP_CHART_HEIGHT = 260;
const DESKTOP_PADDING = { top: 18, right: 16, bottom: 42, left: 68 };
const MOBILE_CHART_WIDTH = 760;
const MOBILE_CHART_HEIGHT = 240;
const MOBILE_PADDING = { top: 12, right: 10, bottom: 34, left: 30 };

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

const formatUsageDay = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function TotalUsageTimelineChart({ points }: TotalUsageTimelineChartProps) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_MAX_WIDTH}px)`).matches;
  });
  const [range, setRange] = useState<RangeFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_MAX_WIDTH}px)`).matches
      ? 'month'
      : 'all';
  });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);
  const [referenceNow] = useState<number>(() => Date.now());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_MAX_WIDTH}px)`);
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    const container = chartScrollRef.current;
    if (!container) return;

    const updateFades = () => {
      const { scrollLeft, clientWidth, scrollWidth } = container;
      const maxScrollLeft = Math.max(scrollWidth - clientWidth, 0);
      setShowLeftFade(scrollLeft > 2);
      setShowRightFade(scrollLeft < maxScrollLeft - 2);
    };

    updateFades();
    container.addEventListener('scroll', updateFades, { passive: true });
    window.addEventListener('resize', updateFades);

    return () => {
      container.removeEventListener('scroll', updateFades);
      window.removeEventListener('resize', updateFades);
    };
  }, [isMobile, points.length, range]);

  const chartWidth = isMobile ? MOBILE_CHART_WIDTH : DESKTOP_CHART_WIDTH;
  const chartHeight = isMobile ? MOBILE_CHART_HEIGHT : DESKTOP_CHART_HEIGHT;
  const padding = isMobile ? MOBILE_PADDING : DESKTOP_PADDING;

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
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    const scaleX = (value: number): number => {
      if (maxX === minX) return padding.left + innerWidth / 2;
      return padding.left + ((value - minX) / (maxX - minX)) * innerWidth;
    };

    const scaleY = (value: number): number => {
      return padding.top + innerHeight - (value / maxY) * innerHeight;
    };

    const plotted = filteredPoints.map((point) => ({
      point,
      x: scaleX(point.timestamp),
      y: scaleY(point.totalTimeSpent),
    }));

    const linePath = plotted
      .map((entry, index) => `${index === 0 ? 'M' : 'L'} ${entry.x} ${entry.y}`)
      .join(' ');

    const yTickRatios = isMobile ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const yTicks = yTickRatios.map((ratio) => {
      const value = Math.round(maxY * ratio);
      return {
        value,
        y: scaleY(value),
      };
    });

    const maxXTicks = isMobile ? 3 : 5;
    const xTickCount = Math.min(maxXTicks, Math.max(2, plotted.length));
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
  }, [chartHeight, chartWidth, filteredPoints, isMobile, padding.bottom, padding.left, padding.right, padding.top]);

  const hoveredPoint = hoveredIndex == null || !chart ? null : chart.plotted[hoveredIndex];
  const selectedPoint = useMemo(() => {
    if (!chart || chart.plotted.length === 0) return null;
    if (selectedTimestamp != null) {
      const selected = chart.plotted.find((entry) => entry.point.timestamp === selectedTimestamp);
      if (selected) return selected.point;
    }
    return chart.plotted[chart.plotted.length - 1].point;
  }, [chart, selectedTimestamp]);
  const selectedDaySiteTotals = useMemo(() => {
    if (!selectedPoint) return [];
    return Object.entries(selectedPoint.siteTotals || {})
      .map(([siteKey, timeSpent]) => ({
        siteKey,
        timeSpent: Math.max(0, Math.floor(Number(timeSpent) || 0)),
      }))
      .filter((site) => site.timeSpent > 0)
      .sort((a, b) => b.timeSpent - a.timeSpent);
  }, [selectedPoint]);

  const updateNearestPointFromClientX = (clientX: number, persistSelection: boolean) => {
    if (!chart || !svgRef.current || chart.plotted.length === 0) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    if (svgRect.width <= 0) return;

    const relativeX = ((clientX - svgRect.left) / svgRect.width) * chartWidth;
    let nearestIndex = 0;
    let smallestDistance = Number.POSITIVE_INFINITY;

    chart.plotted.forEach((entry, index) => {
      const distance = Math.abs(entry.x - relativeX);
      if (distance < smallestDistance) {
        smallestDistance = distance;
        nearestIndex = index;
      }
    });

    const nearestPoint = chart.plotted[nearestIndex];
    if (!nearestPoint) return;

    setHoveredIndex(nearestIndex);
    if (persistSelection) {
      setSelectedTimestamp(nearestPoint.point.timestamp);
    }
  };

  const handleChartTouchStart = (event: TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    updateNearestPointFromClientX(touch.clientX, true);
  };

  const handleChartTouchMove = (event: TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    updateNearestPointFromClientX(touch.clientX, true);
  };

  const handleChartTouchEnd = () => {
    setHoveredIndex(null);
  };

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

      {historicalSummary &&
        (isMobile ? (
          <div className="mb-4 space-y-2">
            <div className="grid grid-cols-1 gap-2">
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
                  Median Daily Time
                </div>
                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {formatTime(historicalSummary.median)}
                </div>
              </div>
            </div>
            <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/40">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                More Stats
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Std Dev (Daily)
                  </div>
                  <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatTime(historicalSummary.standardDeviation)}
                  </div>
                </div>
                <div>
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
            </details>
          </div>
        ) : (
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
        ))}

      {chart ? (
        <>
          <div className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Current total: {formatTime(chart.total)}
          </div>
          <div className="relative">
            {!isMobile && hoveredPoint && (
              <div
                className="pointer-events-none absolute z-10 rounded-md border border-zinc-200 bg-white/95 px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
                style={{
                  left: `${(hoveredPoint.x / chartWidth) * 100}%`,
                  top: `${(hoveredPoint.y / chartHeight) * 100}%`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                <div className="font-medium text-zinc-900 dark:text-zinc-50">
                  {formatUsageDay(hoveredPoint.point.timestamp)}
                </div>
                <div className="text-zinc-600 dark:text-zinc-300">
                  {formatTime(hoveredPoint.point.totalTimeSpent)}
                </div>
              </div>
            )}
            <div className={isMobile ? 'relative' : ''}>
              {isMobile && showLeftFade && (
                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-zinc-900 to-transparent" />
              )}
              {isMobile && showRightFade && (
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-zinc-900 via-zinc-900/75 to-transparent" />
              )}
              <div
                ref={chartScrollRef}
                className={isMobile ? 'overflow-x-auto pb-1' : ''}
              >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className={isMobile ? 'h-56 min-w-[760px]' : 'h-60 w-full'}
                style={isMobile ? { width: `${MOBILE_CHART_WIDTH}px` } : undefined}
                onTouchStart={handleChartTouchStart}
                onTouchMove={handleChartTouchMove}
                onTouchEnd={handleChartTouchEnd}
              >
              <line
                x1={padding.left}
                x2={padding.left}
                y1={padding.top}
                y2={chartHeight - padding.bottom}
                stroke="currentColor"
                className="text-zinc-300 dark:text-zinc-700"
                strokeWidth="1"
              />
              <line
                x1={padding.left}
                x2={chartWidth - padding.right}
                y1={chartHeight - padding.bottom}
                y2={chartHeight - padding.bottom}
                stroke="currentColor"
                className="text-zinc-300 dark:text-zinc-700"
                strokeWidth="1"
              />

              {chart.yTicks.map((tick) => (
                <g key={tick.y}>
                  <line
                    x1={padding.left}
                    x2={chartWidth - padding.right}
                    y1={tick.y}
                    y2={tick.y}
                    stroke="currentColor"
                    className="text-zinc-200/80 dark:text-zinc-700/60"
                    strokeWidth="1"
                  />
                  <text
                    x={padding.left - 8}
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
                    y1={chartHeight - padding.bottom}
                    y2={chartHeight - padding.bottom + 4}
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-zinc-700"
                    strokeWidth="1"
                  />
                  <text
                    x={tick.x}
                    y={chartHeight - padding.bottom + 16}
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
                  className={
                    selectedPoint?.timestamp === entry.point.timestamp
                      ? 'text-indigo-600 dark:text-indigo-300'
                      : 'text-indigo-500 dark:text-indigo-400'
                  }
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
                  onClick={() => setSelectedTimestamp(entry.point.timestamp)}
                />
              ))}

              {!isMobile && (
                <text
                  x={(padding.left + (chartWidth - padding.right)) / 2}
                  y={chartHeight - 6}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
                >
                  Date
                </text>
              )}
              {!isMobile && (
                <text
                  x={14}
                  y={(padding.top + (chartHeight - padding.bottom)) / 2}
                  transform={`rotate(-90 14 ${(padding.top + (chartHeight - padding.bottom)) / 2})`}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
                >
                  Time
                </text>
              )}
            </svg>
              </div>
            </div>
          </div>

          {selectedPoint && (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2 sm:gap-3 border-b border-zinc-200 pb-2 dark:border-zinc-800">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    URLs for {new Date(selectedPoint.timestamp).toLocaleDateString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Ranked by most time used
                  </div>
                </div>
                <div className="rounded-md border border-violet-300/80 bg-violet-100/80 px-2.5 py-1 sm:px-3 sm:py-1.5 dark:border-violet-500/50 dark:bg-violet-900/30">
                  <div className="text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    Total Time
                  </div>
                  <div className="text-sm font-bold text-violet-800 dark:text-violet-200">
                    {formatTime(selectedPoint.totalTimeSpent)}
                  </div>
                </div>
              </div>

              {selectedDaySiteTotals.length > 0 ? (
                <div className="space-y-1">
                  {selectedDaySiteTotals.map((site, index) => (
                    <div
                      key={`${selectedPoint.dayKey}-${site.siteKey}`}
                      className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:gap-3 rounded-md px-2 py-1.5 sm:py-2 text-sm ${
                        index % 2 === 0
                          ? 'bg-zinc-100 dark:bg-zinc-800/70'
                          : 'bg-zinc-50 dark:bg-zinc-900/60'
                      }`}
                    >
                      <span className="w-5 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="truncate text-zinc-800 dark:text-zinc-200">{site.siteKey}</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {formatTime(site.timeSpent)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md bg-zinc-100 px-2 py-2 text-sm text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
                  No URL breakdown was captured for this day.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          No timeline data in this range.
        </p>
      )}
    </section>
  );
}
