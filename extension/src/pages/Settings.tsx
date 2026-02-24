import React, { useState, useEffect } from 'react';
import type { User } from '../types/User';
import Spinner from '../components/Spinner';
import { getTimezoneInfo } from '../utils/timezone';
import { formatUrlForDisplay, getFaviconUrl, FAVICON_FALLBACK } from '../utils/urlDisplay';
import {
  ALLOW_CUSTOM_RESET_TIME,
  DEFAULT_DAILY_RESET_TIME,
  DEFAULT_TIMER_BADGE_TEXT_SCALE,
  DEFAULT_TIMER_BADGE_WIDTH_SCALE,
  DEFAULT_UPCOMING_LIMIT_REMINDER_SECONDS,
  MAX_TIMER_BADGE_TEXT_SCALE,
  MAX_TIMER_BADGE_WIDTH_SCALE,
  MAX_UPCOMING_LIMIT_REMINDER_SECONDS,
  MIN_TIMER_BADGE_TEXT_SCALE,
  MIN_TIMER_BADGE_WIDTH_SCALE,
  MIN_UPCOMING_LIMIT_REMINDER_SECONDS,
} from '../constants';

interface SettingsProps {
  user: User | null;
}

/**
 * Settings tab - manages extension configuration like daily reset time.
 * Child of Popup.tsx, renders inside the Settings tab.
 */
const Settings: React.FC<SettingsProps> = ({ user }) => {
  const [resetTime, setResetTime] = useState<string>(DEFAULT_DAILY_RESET_TIME);
  const [timezone, setTimezone] = useState<string>('');
  const [timezoneAbbr, setTimezoneAbbr] = useState<string>('');
  const [timerDisplayMode, setTimerDisplayMode] = useState<'complex' | 'simple' | 'compact'>('simple');
  const [timerBadgeWidthScale, setTimerBadgeWidthScale] = useState<number>(DEFAULT_TIMER_BADGE_WIDTH_SCALE);
  const [timerBadgeTextScale, setTimerBadgeTextScale] = useState<number>(DEFAULT_TIMER_BADGE_TEXT_SCALE);
  const [upcomingLimitReminderSeconds, setUpcomingLimitReminderSeconds] = useState<number>(DEFAULT_UPCOMING_LIMIT_REMINDER_SECONDS);
  const [redirectUrls, setRedirectUrls] = useState<string[]>([]);
  const [newRedirectUrl, setNewRedirectUrl] = useState<string>('');
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
    const keys = ALLOW_CUSTOM_RESET_TIME
      ? ['dailyResetTime', 'dailyResetTimezone', 'timerDisplayMode', 'simpleTimerDisplay', 'timerBadgeWidthScale', 'timerBadgeTextScale', 'timerBadgeScale', 'upcomingLimitReminderSeconds', 'redirectUrls']
      : ['timerDisplayMode', 'simpleTimerDisplay', 'timerBadgeWidthScale', 'timerBadgeTextScale', 'timerBadgeScale', 'upcomingLimitReminderSeconds', 'redirectUrls'];

    chrome.storage.local.get(keys, (result) => {
      if (ALLOW_CUSTOM_RESET_TIME && result.dailyResetTime) {
        setResetTime(result.dailyResetTime);
      }
      // If timezone was stored, use it; otherwise use detected timezone
      if (ALLOW_CUSTOM_RESET_TIME && result.dailyResetTimezone) {
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
      // Load redirect URLs
      if (result.redirectUrls && Array.isArray(result.redirectUrls)) {
        setRedirectUrls(result.redirectUrls);
      }
      if (typeof result.timerBadgeWidthScale === 'number') {
        const scale = Math.min(MAX_TIMER_BADGE_WIDTH_SCALE, Math.max(MIN_TIMER_BADGE_WIDTH_SCALE, result.timerBadgeWidthScale));
        setTimerBadgeWidthScale(scale);
      } else if (typeof result.timerBadgeScale === 'number') {
        const scale = Math.min(MAX_TIMER_BADGE_WIDTH_SCALE, Math.max(MIN_TIMER_BADGE_WIDTH_SCALE, result.timerBadgeScale));
        setTimerBadgeWidthScale(scale);
      }
      if (typeof result.timerBadgeTextScale === 'number') {
        const scale = Math.min(MAX_TIMER_BADGE_TEXT_SCALE, Math.max(MIN_TIMER_BADGE_TEXT_SCALE, result.timerBadgeTextScale));
        setTimerBadgeTextScale(scale);
      } else if (typeof result.timerBadgeScale === 'number') {
        const scale = Math.min(MAX_TIMER_BADGE_TEXT_SCALE, Math.max(MIN_TIMER_BADGE_TEXT_SCALE, result.timerBadgeScale));
        setTimerBadgeTextScale(scale);
      }
      if (typeof result.upcomingLimitReminderSeconds === 'number') {
        const reminder = Math.min(
          MAX_UPCOMING_LIMIT_REMINDER_SECONDS,
          Math.max(MIN_UPCOMING_LIMIT_REMINDER_SECONDS, Math.round(result.upcomingLimitReminderSeconds))
        );
        setUpcomingLimitReminderSeconds(reminder);
      } else {
        setUpcomingLimitReminderSeconds(DEFAULT_UPCOMING_LIMIT_REMINDER_SECONDS);
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
        timerDisplayMode: timerDisplayMode,
        timerBadgeWidthScale: timerBadgeWidthScale,
        timerBadgeTextScale: timerBadgeTextScale,
        upcomingLimitReminderSeconds: upcomingLimitReminderSeconds,
        redirectUrls: redirectUrls
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

  // Add a redirect URL
  const handleAddRedirectUrl = async () => {
    const trimmedUrl = newRedirectUrl.trim();
    if (!trimmedUrl) return;

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      alert('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    const updatedUrls = [...redirectUrls, trimmedUrl];
    setRedirectUrls(updatedUrls);
    setNewRedirectUrl('');
    await chrome.storage.local.set({ redirectUrls: updatedUrls });
  };

  // Remove a redirect URL
  const handleRemoveRedirectUrl = async (index: number) => {
    const updatedUrls = redirectUrls.filter((_, i) => i !== index);
    setRedirectUrls(updatedUrls);
    await chrome.storage.local.set({ redirectUrls: updatedUrls });
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

      {ALLOW_CUSTOM_RESET_TIME && (
        <div className="flex flex-col space-y-4 bg-zinc-800 border border-zinc-600 rounded-lg p-4">
          <div>
            <h4 className="text-sm font-medium text-zinc-200 mb-2">Daily Reset Time</h4>
            <p className="text-xs text-zinc-400 mb-4">
              Set the time when your daily time tracking should reset. All time limits are "per day"
              and will reset at this time.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div>
              <label htmlFor="reset-time" className="text-sm text-zinc-300 mb-1 block">
                Reset at:
              </label>
              <input
                id="reset-time"
                type="time"
                value={resetTime}
                onChange={(e) => setResetTime(e.target.value)}
                className="px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {timezoneAbbr && (
              <div className="text-zinc-300 font-medium mt-6">
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

          <div className="text-xs text-zinc-500">
            {`Example: Setting "${DEFAULT_DAILY_RESET_TIME}" means your daily limits reset at that time each day.`}
          </div>
        </div>
      )}

      {/* Timer Display Setting */}
      <div className="flex flex-col space-y-4 bg-zinc-800 border border-zinc-600 rounded-lg p-4">
        <div>
          <h4 className="text-sm font-medium text-zinc-200 mb-3">Timer Display Mode</h4>
          <p className="text-xs text-zinc-400 mb-4">
            Choose how time information is displayed in the timer badge.
          </p>
        </div>

        <div className="flex flex-col space-y-1">
          {/* Simple option */}
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-zinc-700 transition-colors">
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
              className="w-4 h-4 text-zinc-300 bg-zinc-700 border-zinc-600 focus:ring-zinc-500"
            />
            <div>
              <div className="text-sm text-zinc-200 font-medium">Simple Timer</div>
              <div className="text-xs text-zinc-400">
                Just the time and progress bar
              </div>
            </div>
          </label>

          {/* Complex option */}
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-zinc-700 transition-colors">
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
              className="w-4 h-4 text-zinc-300 bg-zinc-700 border-zinc-600 focus:ring-zinc-500"
            />
            <div>
              <div className="text-sm text-zinc-200 font-medium">Complex Timer</div>
              <div className="text-xs text-zinc-400">
                Rule name, time, and progress bar
              </div>
            </div>
          </label>

          {/* Compact option */}
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-zinc-700 transition-colors">
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
              className="w-4 h-4 text-zinc-300 bg-zinc-700 border-zinc-600 focus:ring-zinc-500"
            />
            <div>
              <div className="text-sm text-zinc-200 font-medium">Complexer Timer</div>
              <div className="text-xs text-zinc-400">
                Complex view plus explicit limit text below the bar
              </div>
            </div>
          </label>
        </div>

        <div className="mt-2 border-t border-zinc-700 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="timer-badge-width-scale" className="text-sm font-medium text-zinc-200">
              Badge Width
            </label>
            <span className="text-xs text-zinc-400">{Math.round(timerBadgeWidthScale * 100)}%</span>
          </div>
          <input
            id="timer-badge-width-scale"
            type="range"
            min={String(MIN_TIMER_BADGE_WIDTH_SCALE)}
            max={String(MAX_TIMER_BADGE_WIDTH_SCALE)}
            step="0.05"
            value={timerBadgeWidthScale}
            onChange={async (e) => {
              const nextScale = Math.min(MAX_TIMER_BADGE_WIDTH_SCALE, Math.max(MIN_TIMER_BADGE_WIDTH_SCALE, Number(e.target.value)));
              setTimerBadgeWidthScale(nextScale);
              await chrome.storage.local.set({ timerBadgeWidthScale: nextScale });
            }}
            className="w-full accent-zinc-500"
          />
          <div className="mt-4 mb-2 flex items-center justify-between">
            <label htmlFor="timer-badge-text-scale" className="text-sm font-medium text-zinc-200">
              Text Size
            </label>
            <span className="text-xs text-zinc-400">{Math.round(timerBadgeTextScale * 100)}%</span>
          </div>
          <input
            id="timer-badge-text-scale"
            type="range"
            min={String(MIN_TIMER_BADGE_TEXT_SCALE)}
            max={String(MAX_TIMER_BADGE_TEXT_SCALE)}
            step="0.05"
            value={timerBadgeTextScale}
            onChange={async (e) => {
              const nextScale = Math.min(MAX_TIMER_BADGE_TEXT_SCALE, Math.max(MIN_TIMER_BADGE_TEXT_SCALE, Number(e.target.value)));
              setTimerBadgeTextScale(nextScale);
              await chrome.storage.local.set({ timerBadgeTextScale: nextScale });
            }}
            className="w-full accent-zinc-500"
          />
          <div className="mt-1 text-xs text-zinc-500">
            Width and text scale are controlled independently. Timer text remains larger than labels.
          </div>
        </div>

        <div className="mt-2 border-t border-zinc-700 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="upcoming-limit-reminder-seconds" className="text-sm font-medium text-zinc-200">
              Length of time for reminder of upcoming limit
            </label>
            <span className="text-xs text-zinc-400">{upcomingLimitReminderSeconds}s</span>
          </div>
          <input
            id="upcoming-limit-reminder-seconds"
            type="range"
            min={String(MIN_UPCOMING_LIMIT_REMINDER_SECONDS)}
            max={String(MAX_UPCOMING_LIMIT_REMINDER_SECONDS)}
            step="1"
            value={upcomingLimitReminderSeconds}
            onChange={async (e) => {
              const reminder = Math.min(
                MAX_UPCOMING_LIMIT_REMINDER_SECONDS,
                Math.max(MIN_UPCOMING_LIMIT_REMINDER_SECONDS, Math.round(Number(e.target.value)))
              );
              setUpcomingLimitReminderSeconds(reminder);
              await chrome.storage.local.set({ upcomingLimitReminderSeconds: reminder });
            }}
            className="w-full accent-zinc-500"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
            <span>{MIN_UPCOMING_LIMIT_REMINDER_SECONDS}s</span>
            <span>{MAX_UPCOMING_LIMIT_REMINDER_SECONDS}s</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Shows red warning flashes on screen and badge before the active limit is reached.
          </div>
        </div>
      </div>

      {/* Redirect URLs Setting */}
      <div className="flex flex-col space-y-4 bg-zinc-800 border border-zinc-600 rounded-lg p-4">
        <div>
          <h4 className="text-sm font-medium text-zinc-200 mb-2">Redirect URLs</h4>
          <p className="text-xs text-zinc-400 mb-4">
            When you exceed your time limit, you'll be redirected to a random URL from this list.
            This applies to hard limits, soft limits (after all plus ones used), and session limits.
          </p>
        </div>

        {/* List of existing redirect URLs */}
        {redirectUrls.length > 0 && (
          <div className="flex flex-col space-y-2">
            {redirectUrls.map((url, index) => (
              <div
                key={index}
                className="flex items-center gap-2 py-2 px-3 bg-zinc-700 border border-zinc-600 rounded-lg"
              >
                <img
                  src={getFaviconUrl(url)}
                  alt=""
                  className="w-4 h-4"
                  onError={(e) => {
                    e.currentTarget.src = FAVICON_FALLBACK;
                  }}
                />
                <span className="flex-1 text-sm text-zinc-200 truncate">{formatUrlForDisplay(url)}</span>
                <button
                  onClick={() => handleRemoveRedirectUrl(index)}
                  className="text-red-400 hover:text-red-300 text-xs font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new redirect URL */}
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={newRedirectUrl}
            onChange={(e) => setNewRedirectUrl(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAddRedirectUrl();
              }
            }}
            placeholder="https://example.com"
            className="flex-1 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-sm"
          />
          <button
            onClick={handleAddRedirectUrl}
            className="purple-button"
          >
            Add URL
          </button>
        </div>

        {redirectUrls.length === 0 && (
          <div className="text-xs text-zinc-500 italic">
            No redirect URLs configured. Add at least one URL to enable redirects when time limits are exceeded.
          </div>
        )}
      </div>

      {/* Additional info */}
      {user && (
        <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-4">
          <p className="text-zinc-300 text-sm">
            Your time tracking data is synced to your account and will persist across devices.
          </p>
        </div>
      )}
    </div>
  );
};

export default Settings;
