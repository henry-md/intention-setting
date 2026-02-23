import React, { useState } from 'react';

interface DebugPanelProps {
  debugInfo: {
    currentUrl: string;
    normalizedHostname: string;
    instanceId: string;
    isActiveTimer: boolean;
    isTabVisible: boolean;
    isStaleTab: boolean;
    applicableLimits: Array<{
      ruleId: string;
      ruleName?: string;
      ruleType: 'hard' | 'soft' | 'session';
      timeLimit: number;
      timeSpent: number;
      siteBreakdown: Array<{
        siteKey: string;
        timeSpent: number;
      }>;
    }>;
  };
}

const DebugPanel: React.FC<DebugPanelProps> = ({ debugInfo }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        backgroundColor: '#1a1a1a',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        fontWeight: 600,
        minWidth: '120px',
        border: '2px solid #404040',
        transition: 'all 0.3s ease',
      }}
    >
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          fontSize: '11px',
          opacity: 0.7,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
        }}
      >
        <span>Debug Info</span>
        <span style={{ fontSize: '10px' }}>{isExpanded ? '▼' : '▶'}</span>
      </div>

      {isExpanded && (
        <div
          style={{
            marginTop: '8px',
            fontSize: '10px',
            fontFamily: 'monospace',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            padding: '8px',
            borderRadius: '4px',
            maxWidth: '300px',
            wordBreak: 'break-all',
          }}
        >
          <div style={{ marginBottom: '6px' }}>
            <div style={{ opacity: 0.6, marginBottom: '2px' }}>Current URL:</div>
            <div>{debugInfo.currentUrl}</div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ opacity: 0.6, marginBottom: '2px' }}>Normalized Hostname:</div>
            <div>{debugInfo.normalizedHostname}</div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ opacity: 0.6, marginBottom: '2px' }}>Instance ID:</div>
            <div>{debugInfo.instanceId}</div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ opacity: 0.6, marginBottom: '2px' }}>Is Active Timer:</div>
            <div style={{ color: debugInfo.isActiveTimer ? '#4ade80' : '#f87171' }}>
              {debugInfo.isActiveTimer ? 'Yes' : 'No'}
            </div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ opacity: 0.6, marginBottom: '2px' }}>Is Tab Visible:</div>
            <div style={{ color: debugInfo.isTabVisible ? '#4ade80' : '#f87171' }}>
              {debugInfo.isTabVisible ? 'Yes' : 'No'}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.6, marginBottom: '2px' }}>Is Stale Tab:</div>
            <div style={{ color: debugInfo.isStaleTab ? '#f87171' : '#4ade80' }}>
              {debugInfo.isStaleTab ? 'Yes (will reload)' : 'No'}
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <div style={{ opacity: 0.6, marginBottom: '4px' }}>Applicable Limits:</div>
            {debugInfo.applicableLimits.length === 0 ? (
              <div style={{ opacity: 0.7 }}>None</div>
            ) : (
              debugInfo.applicableLimits.map((limit) => (
                <div key={limit.ruleId} style={{ marginBottom: '6px' }}>
                  <div>{limit.ruleName || limit.ruleId}</div>
                  <div>
                    Total: {formatTime(limit.timeSpent)} / {formatTime(limit.timeLimit)}
                  </div>
                  <details style={{ marginTop: '4px' }}>
                    <summary style={{ cursor: 'pointer', opacity: 0.8 }}>
                      Sites in this limit ({limit.siteBreakdown.length})
                    </summary>
                    <div style={{ marginTop: '4px', paddingLeft: '8px' }}>
                      {limit.siteBreakdown.map((site) => (
                        <div key={site.siteKey} style={{ marginBottom: '3px' }}>
                          <div>{site.siteKey}</div>
                          <div style={{ opacity: 0.8 }}>Time: {formatTime(site.timeSpent)}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugPanel;
