import React, { useState, useEffect, useRef } from 'react';

interface IntentionPopupProps {
  onContinue: (timeLimit: number, intention: string) => void;
  onCancel: () => void;
}

const IntentionPopup: React.FC<IntentionPopupProps> = ({ onContinue, onCancel }) => {
  const [timeLimit, setTimeLimit] = useState(30); // minutes
  const [intention, setIntention] = useState('');
  const timeLimitRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus time limit input
    timeLimitRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const timeLimitInSeconds = timeLimit * 60;
    onContinue(timeLimitInSeconds, intention.trim());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <style>
        {`
          input[type="number"]::-webkit-inner-spin-button,
          input[type="number"]::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
        `}
      </style>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 999999,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
      <div
        style={{
          backgroundColor: '#18181b',
          border: '1px solid #3f3f46',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          color: 'rgba(255, 255, 255, 0.87)',
        }}
      >
        <h2
          style={{
            margin: '0 0 16px 0',
            fontSize: '24px',
            fontWeight: 600,
          }}
        >
          How long do you want to spend here?
        </h2>
        <p
          style={{
            margin: '0 0 24px 0',
            color: 'rgba(255, 255, 255, 0.6)',
            fontSize: '14px',
          }}
        >
          Set a time limit to stay mindful of your browsing.
        </p>

        {/* Time limit input */}
        <div style={{ marginBottom: '24px' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.7)',
            }}
          >
            Time limit (minutes)
          </label>
          <input
            ref={timeLimitRef}
            type="number"
            min="1"
            max="999"
            value={timeLimit}
            onChange={(e) => setTimeLimit(parseInt(e.target.value) || 0)}
            onKeyPress={handleKeyPress}
            onWheel={(e) => e.currentTarget.blur()}
            style={{
              width: timeLimit > 99 ? `${String(timeLimit).length * 28}px` : '100px',
              minWidth: '100px',
              maxWidth: '200px',
              padding: '12px 16px',
              fontSize: '32px',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              backgroundColor: '#27272a',
              color: 'rgba(255, 255, 255, 0.87)',
              boxSizing: 'border-box',
              outline: 'none',
              fontWeight: 400,
              MozAppearance: 'textfield',
              WebkitAppearance: 'none',
              appearance: 'none',
            }}
          />
        </div>

        {/* Intention section */}
        <div style={{ marginBottom: '24px' }}>
          <h3
            style={{
              margin: '0 0 8px 0',
              fontSize: '16px',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.87)',
            }}
          >
            What's your intention?
          </h3>
          <input
            type="text"
            value={intention}
            onChange={(e) => setIntention(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="I want to..."
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '16px',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              backgroundColor: '#27272a',
              color: 'rgba(255, 255, 255, 0.87)',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 500,
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              backgroundColor: 'transparent',
              color: 'rgba(255, 255, 255, 0.87)',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#71717a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#3f3f46';
            }}
          >
            Go Back
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 500,
              border: '1px solid #52525b',
              borderRadius: '8px',
              backgroundColor: '#27272a',
              color: 'white',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#3f3f46';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#27272a';
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

export default IntentionPopup;
