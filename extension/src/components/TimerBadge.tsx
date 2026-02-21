import React from 'react';

interface TimerBadgeProps {
  timeSpent: number; // in seconds
  timeLimit: number; // in seconds
}

const TimerBadge: React.FC<TimerBadgeProps> = ({ timeSpent, timeLimit }) => {
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const percentage = timeLimit > 0 ? (timeSpent / timeLimit) * 100 : 0;
  const isOverLimit = timeSpent >= timeLimit;

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
            Limit: {formatTime(timeLimit)}
          </div>
        </>
      )}
    </div>
  );
};

export default TimerBadge;
