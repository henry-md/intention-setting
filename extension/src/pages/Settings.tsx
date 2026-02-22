import React, { useState, useEffect } from 'react';
import type { User } from '../types/User';
import Spinner from '../components/Spinner';
import { getTimezoneInfo } from '../utils/timezone';

interface SettingsProps {
  user: User | null;
}

/**
 * Settings tab - manages extension configuration like daily reset time.
 * Child of Popup.tsx, renders inside the Settings tab.
 */
const Settings: React.FC<SettingsProps> = ({ user }) => {
  const [resetTime, setResetTime] = useState<string>('03:00');
  const [timezone, setTimezone] = useState<string>('');
  const [timezoneAbbr, setTimezoneAbbr] = useState<string>('');
  const [timerDisplayMode, setTimerDisplayMode] = useState<'complex' | 'simple' | 'compact'>('complex');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Detect user's timezone
  useEffect(() => {
    const tzInfo = getTimezoneInfo();
    setTimezone(tzInfo.name);
    setTimezoneAbbr(tzInfo.abbreviation);
  }, []);

  // Load current settings from storage
  useEffect(() => {
    chrome.storage.local.get(['dailyResetTime', 'dailyResetTimezone', 'timerDisplayMode', 'simpleTimerDisplay'], (result) => {
      if (result.dailyResetTime) {
        setResetTime(result.dailyResetTime);
      }
      // If timezone was stored, use it; otherwise use detected timezone
      if (result.dailyResetTimezone) {
        setTimezone(result.dailyResetTimezone);
      }
      // Load timer display mode with backwards compatibility
      if (result.timerDisplayMode) {
        setTimerDisplayMode(result.timerDisplayMode);
      } else if (result.simpleTimerDisplay !== undefined) {
        // Migrate old boolean setting to new mode setting
        const mode = result.simpleTimerDisplay ? 'simple' : 'complex';
        setTimerDisplayMode(mode);
        chrome.storage.local.set({ timerDisplayMode: mode });
      }
      setLoading(false);
    });
  }, []);

  // Save settings to storage
  const handleSave = async () => {
    setSaving(true);
    try {
      await chrome.storage.local.set({
        dailyResetTime: resetTime,
        dailyResetTimezone: timezone,
        timerDisplayMode: timerDisplayMode
      });

      // Note: Reset will be automatically detected on the next timer tick
      // No need to manually trigger a check

      // Show success (could add a toast notification here)
      setTimeout(() => setSaving(false), 500);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col space-y-4 p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Settings</h3>
      </div>

      {/* Daily Reset Time Setting */}
      <div className="flex flex-col space-y-4 bg-gray-800 border border-gray-600 rounded-lg p-4">
        <div>
          <h4 className="text-sm font-medium text-gray-200 mb-2">Daily Reset Time</h4>
          <p className="text-xs text-gray-400 mb-4">
            Set the time when your daily time tracking should reset. All time limits are "per day"
            and will reset at this time.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div>
            <label htmlFor="reset-time" className="text-sm text-gray-300 mb-1 block">
              Reset at:
            </label>
            <input
              id="reset-time"
              type="time"
              value={resetTime}
              onChange={(e) => setResetTime(e.target.value)}
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          {timezoneAbbr && (
            <div className="text-gray-300 font-medium mt-6">
              {timezoneAbbr}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="purple-button mt-6"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div className="text-xs text-gray-500">
          Example: Setting "03:00" means your daily limits reset at 3:00 AM each day.
        </div>
      </div>

      {/* Timer Display Setting */}
      <div className="flex flex-col space-y-4 bg-gray-800 border border-gray-600 rounded-lg p-4">
        <div>
          <h4 className="text-sm font-medium text-gray-200 mb-3">Timer Display Mode</h4>
          <p className="text-xs text-gray-400 mb-4">
            Choose how time information is displayed in the timer badge.
          </p>
        </div>

        <div className="flex flex-col space-y-1">
          {/* Complex option */}
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-700 transition-colors">
            <input
              type="radio"
              name="timerMode"
              value="complex"
              checked={timerDisplayMode === 'complex'}
              onChange={async (e) => {
                const newMode = e.target.value as 'complex' | 'simple' | 'compact';
                setTimerDisplayMode(newMode);
                await chrome.storage.local.set({ timerDisplayMode: newMode });
              }}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm text-gray-200 font-medium">Complex Timer</div>
              <div className="text-xs text-gray-400">Shows labels, time, progress bar, and total time</div>
            </div>
          </label>

          {/* Simple option */}
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-700 transition-colors">
            <input
              type="radio"
              name="timerMode"
              value="simple"
              checked={timerDisplayMode === 'simple'}
              onChange={async (e) => {
                const newMode = e.target.value as 'complex' | 'simple' | 'compact';
                setTimerDisplayMode(newMode);
                await chrome.storage.local.set({ timerDisplayMode: newMode });
              }}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm text-gray-200 font-medium">Simple Timer</div>
              <div className="text-xs text-gray-400">Shows time and progress bar only</div>
            </div>
          </label>

          {/* Compact option */}
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-700 transition-colors">
            <input
              type="radio"
              name="timerMode"
              value="compact"
              checked={timerDisplayMode === 'compact'}
              onChange={async (e) => {
                const newMode = e.target.value as 'complex' | 'simple' | 'compact';
                setTimerDisplayMode(newMode);
                await chrome.storage.local.set({ timerDisplayMode: newMode });
              }}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm text-gray-200 font-medium">Compact Timer</div>
              <div className="text-xs text-gray-400">Shows "current / total" format with progress bar</div>
            </div>
          </label>
        </div>
      </div>

      {/* Additional info */}
      {user && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
          <p className="text-gray-300 text-sm">
            Your time tracking data is synced to your account and will persist across devices.
          </p>
        </div>
      )}
    </div>
  );
};

export default Settings;
