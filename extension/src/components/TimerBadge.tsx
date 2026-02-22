import React, { useState, useEffect } from 'react';
import { formatTime } from '../utils/timeFormat';

interface TimerBadgeProps {
  timeSpent: number; // in seconds
  timeLimit: number; // in seconds
}

const TimerBadge: React.FC<TimerBadgeProps> = ({ timeSpent, timeLimit }) => {
  const [displayMode, setDisplayMode] = useState<'complex' | 'simple' | 'compact'>('complex');
  const percentage = timeLimit > 0 ? (timeSpent / timeLimit) * 100 : 0;
  const isOverLimit = timeSpent >= timeLimit;

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
        }}
      >
        <div style={{ fontSize: '16px', marginBottom: '6px', textAlign: 'center' }}>
          {formatTime(timeSpent)}
        </div>
        {timeLimit > 0 && (
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
        }}
      >
        <div style={{ fontSize: '14px', marginBottom: '6px', textAlign: 'center' }}>
          {formatTime(timeSpent)} / {formatTime(timeLimit)}
        </div>
        {timeLimit > 0 && (
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
      }}
    >
      <div style={{ marginBottom: '4px', fontSize: '12px', opacity: 0.7 }}>
        Time Spent
      </div>
      <div style={{ fontSize: '18px', marginBottom: '8px' }}>
        {formatTime(timeSpent)}
      </div>
      {timeLimit > 0 && (
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
            Total: {formatTime(timeLimit)}
          </div>
        </>
      )}
    </div>
  );
};

export default TimerBadge;
