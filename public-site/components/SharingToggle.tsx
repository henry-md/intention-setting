'use client';

import { useState } from 'react';
import { useShareSettings } from '@/hooks/useShareSettings';

export default function SharingToggle() {
  const { shareSettings, loading, isEnabled, toggleSharing } = useShareSettings();
  const [copying, setCopying] = useState(false);

  const handleToggle = async () => {
    await toggleSharing();
  };

  const handleCopyLink = async () => {
    if (!shareSettings?.shareId) return;

    const publicUrl = `${window.location.origin}/${encodeURIComponent(shareSettings.shareId)}`;
    await navigator.clipboard.writeText(publicUrl);

    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading sharing settings...</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Public Sharing
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Allow others to view your usage statistics via a shareable link
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 dark:focus:ring-zinc-50 ${
            isEnabled ? 'bg-zinc-900 dark:bg-zinc-50' : 'bg-zinc-200 dark:bg-zinc-700'
          }`}
          role="switch"
          aria-checked={isEnabled}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out dark:bg-zinc-900 ${
              isEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {isEnabled && shareSettings?.shareId && (
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 sm:p-4 dark:bg-zinc-800">
          <div className="mb-2 text-xs font-medium uppercase text-zinc-600 dark:text-zinc-400">
            Your Public Link
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              readOnly
              value={`${window.location.origin}/${encodeURIComponent(shareSettings.shareId)}`}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              onClick={handleCopyLink}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 sm:w-auto"
            >
              {copying ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            Anyone with this link can view your usage statistics
          </p>
        </div>
      )}

      {isEnabled && (
        <div className="mt-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <svg
              className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Public Sharing Enabled
              </div>
              <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Your usage statistics are now visible to anyone with the link. Toggle off to make
                your stats private again.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
