import React from 'react';

interface SoftLimitPopupProps {
  derivedRemainingSnoozes: number;
  plusOneDuration: number;
  onSnooze: () => void;
  onLeave: () => void;
}

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
};

const SoftLimitPopup: React.FC<SoftLimitPopupProps> = ({
  derivedRemainingSnoozes,
  plusOneDuration,
  onSnooze,
  onLeave
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000000,
        backgroundColor: 'rgba(0, 0, 0, 0.68)',
        backdropFilter: 'blur(6px)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#18181b',
          border: '1px solid #3f3f46',
          borderRadius: '14px',
          width: 'min(520px, 92vw)',
          padding: '28px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)',
          color: 'rgba(255, 255, 255, 0.92)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '28px',
            lineHeight: 1.2,
            fontWeight: 700
          }}
        >
          Time&apos;s up
        </h2>
        <p
          style={{
            marginTop: '10px',
            marginBottom: '16px',
            color: 'rgba(255, 255, 255, 0.74)',
            fontSize: '15px',
            lineHeight: 1.45
          }}
        >
          You hit your soft limit for this category.
        </p>

        <div
          style={{
            backgroundColor: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: '10px',
            padding: '12px 14px',
            marginBottom: '18px',
            fontSize: '14px'
          }}
        >
          <div>One-mores left: <strong>{derivedRemainingSnoozes}</strong></div>
          <div style={{ marginTop: '4px', opacity: 0.8 }}>
            Each snooze adds {formatDuration(plusOneDuration)}.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onLeave}
            style={{
              padding: '11px 14px',
              borderRadius: '9px',
              border: '1px solid #52525b',
              background: 'transparent',
              color: 'rgba(255,255,255,0.92)',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Leave Site
          </button>
          <button
            onClick={onSnooze}
            disabled={derivedRemainingSnoozes <= 0}
            style={{
              padding: '11px 14px',
              borderRadius: '9px',
              border: derivedRemainingSnoozes > 0 ? '1px solid rgba(16, 185, 129, 0.55)' : '1px solid #52525b',
              background: derivedRemainingSnoozes > 0 ? 'rgba(16, 185, 129, 0.10)' : '#27272a',
              color: derivedRemainingSnoozes > 0 ? '#a7f3d0' : '#d4d4d8',
              fontWeight: 700,
              cursor: derivedRemainingSnoozes > 0 ? 'pointer' : 'not-allowed',
              opacity: derivedRemainingSnoozes > 0 ? 1 : 0.7
            }}
          >
            Snooze ({derivedRemainingSnoozes})
          </button>
        </div>
      </div>
    </div>
  );
};

export default SoftLimitPopup;
