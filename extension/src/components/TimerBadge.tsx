import React, { useState, useEffect } from 'react';
import { formatTime } from '../utils/timeFormat';

interface TimerBadgeProps {
  timeSpent: number; // in seconds
  timeLimit: number; // in seconds
  currentSiteKey?: string;
  relevantLimit?: {
    ruleId: string;
    ruleName?: string;
    timeSpent: number;
    timeLimit: number;
    siteBreakdown: Array<{
      siteKey: string;
      timeSpent: number;
    }>;
  };
}

const TimerBadge: React.FC<TimerBadgeProps> = ({ timeSpent, timeLimit, currentSiteKey, relevantLimit }) => {
  const [displayMode, setDisplayMode] = useState<'complex' | 'simple' | 'compact'>('simple');
  const [isBreakdownExpanded, setIsBreakdownExpanded] = useState(false);

  const displayedTimeSpent = relevantLimit?.timeSpent ?? timeSpent;
  const displayedTimeLimit = relevantLimit?.timeLimit ?? timeLimit;
  const percentage = displayedTimeLimit > 0 ? (displayedTimeSpent / displayedTimeLimit) * 100 : 0;
  const isOverLimit = displayedTimeSpent >= displayedTimeLimit;
  const formatRuleLabel = (label: string): string =>
    label
      .replace(/\s+(hard|soft|session)\s+limit$/i, '')
      .replace(/\s+limit$/i, '')
      .trim();

  const relevantRuleLabel = relevantLimit
    ? formatRuleLabel(relevantLimit.ruleName || relevantLimit.ruleId)
    : undefined;
  const hasBreakdown = !!relevantLimit && relevantLimit.siteBreakdown.length > 0;

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
          marginTop: '6px',
          marginBottom: '6px',
          paddingTop: '6px',
          borderTop: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '10px',
          opacity: 0.9,
        }}
      >
        {relevantLimit.siteBreakdown.map((site) => (
          <div
            key={site.siteKey}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '8px',
              backgroundColor: site.siteKey === currentSiteKey ? 'rgba(255,255,255,0.08)' : 'transparent',
              borderRadius: '4px',
              padding: '2px 4px',
            }}
          >
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '120px',
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

  // Load display mode setting
  useEffect(() => {
    chrome.storage.local.get(['timerDisplayMode', 'simpleTimerDisplay'], (result) => {
      if (result.timerDisplayMode) {
        setDisplayMode(result.timerDisplayMode);
      } else if (result.simpleTimerDisplay !== undefined) {
        // Backwards compatibility
        setDisplayMode(result.simpleTimerDisplay ? 'simple' : 'complex');
      }
    });

    // Listen for changes to the setting
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.timerDisplayMode) {
        setDisplayMode(changes.timerDisplayMode.newValue || 'complex');
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Simple mode: just time and progress bar
  if (displayMode === 'simple') {
    return (
      <div
        style={{
          backgroundColor: isOverLimit ? '#dc2626' : '#1a1a1a',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '16px',
          fontWeight: 600,
          minWidth: '80px',
          border: isOverLimit ? '2px solid #ef4444' : '2px solid #404040',
          transition: 'all 0.3s ease',
          cursor: hasBreakdown ? 'pointer' : 'default',
        }}
        onClick={toggleBreakdown}
        onKeyDown={handleBadgeKeyDown}
        role={hasBreakdown ? 'button' : undefined}
        tabIndex={hasBreakdown ? 0 : undefined}
      >
        {relevantRuleLabel && (
          <div
            style={{
              marginBottom: '6px',
              fontSize: '11px',
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
        <div style={{ fontSize: '16px', lineHeight: 1, textAlign: 'center', marginBottom: '6px' }}>
          {formatTime(displayedTimeSpent)}
        </div>
        {renderSiteBreakdown()}
        {displayedTimeLimit > 0 && (
          <div
            style={{
              width: '100%',
              height: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(percentage, 100)}%`,
                height: '100%',
                backgroundColor: isOverLimit ? '#fca5a5' : '#646cff',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Compact mode: "current / total" with progress bar
  if (displayMode === 'compact') {
    return (
      <div
        style={{
          backgroundColor: isOverLimit ? '#dc2626' : '#1a1a1a',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '14px',
          fontWeight: 600,
          minWidth: '100px',
          border: isOverLimit ? '2px solid #ef4444' : '2px solid #404040',
          transition: 'all 0.3s ease',
          cursor: hasBreakdown ? 'pointer' : 'default',
        }}
        onClick={toggleBreakdown}
        onKeyDown={handleBadgeKeyDown}
        role={hasBreakdown ? 'button' : undefined}
        tabIndex={hasBreakdown ? 0 : undefined}
      >
        {relevantRuleLabel && (
          <div
            style={{
              marginBottom: '6px',
              fontSize: '11px',
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
        <div style={{ fontSize: '14px', lineHeight: 1, textAlign: 'center', marginBottom: '6px' }}>
          {formatTime(displayedTimeSpent)} / {formatTime(displayedTimeLimit)}
        </div>
        {renderSiteBreakdown()}
        {displayedTimeLimit > 0 && (
          <div
            style={{
              width: '100%',
              height: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(percentage, 100)}%`,
                height: '100%',
                backgroundColor: isOverLimit ? '#fca5a5' : '#646cff',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Complex mode: labels, time, and progress bar
  return (
    <div
      style={{
        backgroundColor: isOverLimit ? '#dc2626' : '#1a1a1a',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        fontWeight: 600,
        minWidth: '120px',
        border: isOverLimit ? '2px solid #ef4444' : '2px solid #404040',
        transition: 'all 0.3s ease',
        cursor: hasBreakdown ? 'pointer' : 'default',
      }}
      onClick={toggleBreakdown}
      onKeyDown={handleBadgeKeyDown}
      role={hasBreakdown ? 'button' : undefined}
      tabIndex={hasBreakdown ? 0 : undefined}
    >
      {relevantRuleLabel && (
        <div
          style={{
            marginBottom: '8px',
            fontSize: '11px',
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
      <div style={{ marginBottom: '4px', fontSize: '12px', opacity: 0.7 }}>
        {relevantRuleLabel ? 'Total Time' : 'Time Spent'}
      </div>
      <div style={{ fontSize: '18px', lineHeight: 1, textAlign: 'center', marginBottom: '8px' }}>
        {formatTime(displayedTimeSpent)}
      </div>
      {renderSiteBreakdown()}
      {displayedTimeLimit > 0 && (
        <>
          <div
            style={{
              width: '100%',
              height: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '2px',
              overflow: 'hidden',
              marginBottom: '4px',
            }}
          >
            <div
              style={{
                width: `${Math.min(percentage, 100)}%`,
                height: '100%',
                backgroundColor: isOverLimit ? '#fca5a5' : '#646cff',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ fontSize: '11px', opacity: 0.6 }}>
            Limit: {formatTime(displayedTimeLimit)}
          </div>
        </>
      )}
    </div>
  );
};

export default TimerBadge;
