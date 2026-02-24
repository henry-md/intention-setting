import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TIMER_BADGE_TEXT_SCALE,
  DEFAULT_TIMER_BADGE_WIDTH_SCALE,
  MAX_TIMER_BADGE_TEXT_SCALE,
  MAX_TIMER_BADGE_WIDTH_SCALE,
  MIN_TIMER_BADGE_TEXT_SCALE,
  MIN_TIMER_BADGE_WIDTH_SCALE,
} from '../constants';
import { formatTime } from '../utils/timeFormat';

interface TimerBadgeProps {
  timeSpent: number; // in seconds
  timeLimit: number; // in seconds
  isNearLimit?: boolean;
  currentSiteKey?: string;
  relevantLimit?: {
    ruleId: string;
    ruleName?: string;
    ruleType?: 'hard' | 'soft' | 'session';
    plusOnes?: number;
    plusOneDuration?: number;
    timeSpent: number;
    timeLimit: number;
    siteBreakdown: Array<{
      siteKey: string;
      timeSpent: number;
    }>;
  };
}

const clampScale = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_TIMER_BADGE_TEXT_SCALE;
  return Math.min(MAX_TIMER_BADGE_TEXT_SCALE, Math.max(MIN_TIMER_BADGE_TEXT_SCALE, value));
};

const clampWidthScale = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_TIMER_BADGE_WIDTH_SCALE;
  return Math.min(MAX_TIMER_BADGE_WIDTH_SCALE, Math.max(MIN_TIMER_BADGE_WIDTH_SCALE, value));
};

const TimerBadge: React.FC<TimerBadgeProps> = ({
  timeSpent,
  timeLimit,
  isNearLimit = false,
  currentSiteKey,
  relevantLimit,
}) => {
  const [displayMode, setDisplayMode] = useState<'complex' | 'simple' | 'compact'>('simple');
  const [widthScale, setWidthScale] = useState(DEFAULT_TIMER_BADGE_WIDTH_SCALE);
  const [textScale, setTextScale] = useState(DEFAULT_TIMER_BADGE_TEXT_SCALE);
  const [isBreakdownExpanded, setIsBreakdownExpanded] = useState(false);
  const [isNearLimitFlashOn, setIsNearLimitFlashOn] = useState(false);

  const displayedTimeSpent = relevantLimit?.timeSpent ?? timeSpent;
  const displayedTimeLimit = relevantLimit?.timeLimit ?? timeLimit;
  const percentage = displayedTimeLimit > 0 ? (displayedTimeSpent / displayedTimeLimit) * 100 : 0;
  const isOverLimit = displayedTimeSpent >= displayedTimeLimit;
  const hasBreakdown = !!relevantLimit && relevantLimit.siteBreakdown.length > 0;

  const formatRuleLabel = (label: string): string =>
    label
      .replace(/\s+(hard|soft|session)\s+limit$/i, '')
      .replace(/\s+limit$/i, '')
      .trim();

  const relevantRuleLabel = relevantLimit ? formatRuleLabel(relevantLimit.ruleName || relevantLimit.ruleId) : undefined;

  const formatLimitMinutes = (seconds: number): string => {
    if (seconds % 60 === 0) {
      return String(seconds / 60);
    }
    const minutes = seconds / 60;
    return minutes.toFixed(1).replace(/\.0$/, '');
  };

  const limitDisplay = (() => {
    const base = formatLimitMinutes(displayedTimeLimit);
    if (relevantLimit?.ruleType === 'soft') {
      const plusOnes = relevantLimit.plusOnes || 0;
      const plusOneDuration = relevantLimit.plusOneDuration || 0;
      const extraSeconds = plusOnes * plusOneDuration;
      if (extraSeconds > 0) {
        return `Limit: ${base} + ${formatLimitMinutes(extraSeconds)}`;
      }
    }
    return `Limit: ${base}`;
  })();

  const dims = useMemo(() => {
    const safeWidthScale = clampWidthScale(widthScale);
    const safeTextScale = clampScale(textScale);
    const labelSize = 11 * safeTextScale;
    const timeSize = 16 * safeTextScale;
    return {
      widthScale: safeWidthScale,
      textScale: safeTextScale,
      width: 160 * safeWidthScale,
      paddingX: 12 * safeWidthScale,
      paddingY: 10 * safeWidthScale,
      borderRadius: 12 * safeWidthScale,
      borderWidth: Math.max(1, Math.round(2 * safeWidthScale)),
      labelSize,
      timeSize,
      metaSize: 11 * safeTextScale,
      detailsSize: 10 * safeTextScale,
      rowPaddingY: 2 * safeTextScale,
      rowPaddingX: 4 * safeWidthScale,
      gapSmall: 6 * safeTextScale,
      gapXSmall: 4 * safeTextScale,
      barHeight: Math.max(3, Math.round(4 * safeTextScale)),
      barRadius: Math.max(2, Math.round(2 * safeWidthScale)),
    };
  }, [widthScale, textScale]);

  const toggleBreakdown = () => {
    if (!hasBreakdown) return;
    setIsBreakdownExpanded((prev) => !prev);
  };

  const handleBadgeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasBreakdown) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleBreakdown();
  };

  const renderSiteBreakdown = () => {
    if (!isBreakdownExpanded || !relevantLimit) return null;

    return (
      <div
        style={{
          marginTop: `${dims.gapSmall}px`,
          marginBottom: `${dims.gapSmall}px`,
          paddingTop: `${dims.gapSmall}px`,
          borderTop: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: `${dims.gapXSmall}px`,
          fontSize: `${dims.detailsSize}px`,
          opacity: 0.9,
        }}
      >
        {relevantLimit.siteBreakdown.map((site) => (
          <div
            key={site.siteKey}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: `${dims.gapSmall}px`,
              backgroundColor: site.siteKey === currentSiteKey ? 'rgba(255,255,255,0.08)' : 'transparent',
              borderRadius: `${Math.max(3, 4 * dims.widthScale)}px`,
              padding: `${dims.rowPaddingY}px ${dims.rowPaddingX}px`,
            }}
          >
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: `${Math.round(dims.width * 0.62)}px`,
              }}
            >
              {site.siteKey}
            </span>
            <span>{formatTime(site.timeSpent)}</span>
          </div>
        ))}
      </div>
    );
  };

  useEffect(() => {
    chrome.storage.local.get(
      ['timerDisplayMode', 'simpleTimerDisplay', 'timerBadgeWidthScale', 'timerBadgeTextScale', 'timerBadgeScale'],
      (result) => {
        if (result.timerDisplayMode) {
          setDisplayMode(result.timerDisplayMode);
        } else if (result.simpleTimerDisplay !== undefined) {
          setDisplayMode(result.simpleTimerDisplay ? 'simple' : 'complex');
        }

        if (typeof result.timerBadgeWidthScale === 'number') {
          setWidthScale(clampWidthScale(result.timerBadgeWidthScale));
        } else if (typeof result.timerBadgeScale === 'number') {
          // Backward compatibility with old combined slider.
          setWidthScale(clampWidthScale(result.timerBadgeScale));
        }

        if (typeof result.timerBadgeTextScale === 'number') {
          setTextScale(clampScale(result.timerBadgeTextScale));
        } else if (typeof result.timerBadgeScale === 'number') {
          // Backward compatibility with old combined slider.
          setTextScale(clampScale(result.timerBadgeScale));
        }
      }
    );

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.timerDisplayMode) {
        setDisplayMode(changes.timerDisplayMode.newValue || 'complex');
      }
      if (changes.timerBadgeWidthScale) {
        setWidthScale(clampWidthScale(Number(changes.timerBadgeWidthScale.newValue)));
      }
      if (changes.timerBadgeTextScale) {
        setTextScale(clampScale(Number(changes.timerBadgeTextScale.newValue)));
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (!isNearLimit) {
      setIsNearLimitFlashOn(false);
      return;
    }

    setIsNearLimitFlashOn(false);
    const intervalId = window.setInterval(() => {
      setIsNearLimitFlashOn((prev) => !prev);
    }, 280);

    return () => window.clearInterval(intervalId);
  }, [isNearLimit]);

  const showRuleName = displayMode !== 'complex';
  const showLimitLine = displayMode === 'compact';
  const backgroundColor = isNearLimit
    ? (isNearLimitFlashOn ? '#47272d' : '#3a1f24')
    : isOverLimit
      ? '#3b171d'
      : '#18181b';
  const borderColor = isNearLimit
    ? (isNearLimitFlashOn ? '#a05b66' : '#8b4b55')
    : isOverLimit
      ? '#b56a76'
      : '#52525b';

  return (
    <div
      style={{
        backgroundColor,
        color: 'white',
        width: `${dims.width}px`,
        padding: `${dims.paddingY}px ${dims.paddingX}px`,
        borderRadius: `${dims.borderRadius}px`,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 600,
        border: `${dims.borderWidth}px solid ${borderColor}`,
        transition: 'all 0.3s ease',
        cursor: hasBreakdown ? 'pointer' : 'default',
      }}
      onClick={toggleBreakdown}
      onKeyDown={handleBadgeKeyDown}
      role={hasBreakdown ? 'button' : undefined}
      tabIndex={hasBreakdown ? 0 : undefined}
    >
      {showRuleName && relevantRuleLabel && (
        <div
          style={{
            marginBottom: `${Math.max(2, dims.gapXSmall)}px`,
            fontSize: `${dims.labelSize}px`,
            textAlign: 'center',
            opacity: 0.9,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {relevantRuleLabel}
        </div>
      )}

      <div
        style={{
          fontSize: `${dims.timeSize}px`,
          lineHeight: 1,
          textAlign: 'center',
          marginBottom: `${dims.gapSmall}px`,
        }}
      >
        {formatTime(displayedTimeSpent)}
      </div>

      {renderSiteBreakdown()}

      {displayedTimeLimit > 0 && (
        <>
          <div
            style={{
              width: '100%',
              height: `${dims.barHeight}px`,
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: `${dims.barRadius}px`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(percentage, 100)}%`,
                height: '100%',
                backgroundColor: isOverLimit ? '#fca5a5' : '#71717a',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          {showLimitLine && (
            <div
              style={{
                marginTop: `${dims.gapXSmall}px`,
                fontSize: `${dims.metaSize}px`,
                opacity: 0.6,
                textAlign: 'center',
              }}
            >
              {limitDisplay}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TimerBadge;
