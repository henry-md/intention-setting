import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, RotateCw, X } from 'lucide-react';
import {
  type ExtensionUpdatePrompt,
  requestExtensionUpdate,
} from '../utils/extensionUpdate';

interface ExtensionUpdateModalProps {
  prompt: ExtensionUpdatePrompt;
  onClose: () => void;
}

const ExtensionUpdateModal: React.FC<ExtensionUpdateModalProps> = ({ prompt, onClose }) => {
  const [isChecking, setIsChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [canReload, setCanReload] = useState(false);

  const openStorePage = () => {
    if (!prompt.storeUrl) return;
    chrome.tabs.create({ url: prompt.storeUrl });
  };

  const checkForUpdate = async () => {
    setIsChecking(true);
    setStatusMessage(null);

    const result = await requestExtensionUpdate();
    setStatusMessage(result.message);
    setCanReload(result.status === 'update_available');
    setIsChecking(false);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-update-title"
        className="relative w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-white shadow-2xl shadow-black/50"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/8 hover:text-white"
          aria-label="Dismiss update reminder"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-3 flex items-center gap-3 pr-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-200">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-200/80">
              Update Available
            </p>
            <h2 id="extension-update-title" className="text-base font-semibold leading-tight">
              Intention Setting {prompt.latestVersion}
            </h2>
          </div>
        </div>

        <p className="text-sm leading-5 text-zinc-300">
          {prompt.message || 'A newer extension version is available.'}
        </p>

        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
          Current version {prompt.currentVersion}
          {prompt.isRequired && prompt.minSupportedVersion
            ? ` · Required version ${prompt.minSupportedVersion}`
            : ''}
        </div>

        {statusMessage && (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
            {statusMessage}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {canReload ? (
            <button
              type="button"
              onClick={() => chrome.runtime.reload()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200"
            >
              <RotateCw className="h-4 w-4" />
              Reload Extension
            </button>
          ) : (
            <button
              type="button"
              onClick={checkForUpdate}
              disabled={isChecking}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? 'Checking...' : 'Check for Update'}
            </button>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={openStorePage}
              disabled={!prompt.storeUrl}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ExternalLink className="h-4 w-4" />
              Web Store
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Later
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ExtensionUpdateModal;
