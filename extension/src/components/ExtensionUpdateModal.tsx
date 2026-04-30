import React from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import type { ExtensionUpdatePrompt } from '../utils/extensionUpdate';

interface ExtensionUpdateModalProps {
  prompt: ExtensionUpdatePrompt;
  onClose: () => void;
}

const ExtensionUpdateModal: React.FC<ExtensionUpdateModalProps> = ({ prompt, onClose }) => {
  const defaultMessage = prompt.isRequired
    ? 'This extension version is no longer supported. Open the Chrome Web Store page to upgrade.'
    : 'A newer extension version is available.';

  const openStorePage = () => {
    if (!prompt.storeUrl) return;
    chrome.tabs.create({ url: prompt.storeUrl });
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
              {prompt.isRequired ? 'Update Required' : 'Update Available'}
            </p>
            <h2 id="extension-update-title" className="text-base font-semibold leading-tight">
              Intention Setting {prompt.latestVersion}
            </h2>
          </div>
        </div>

        <p className="text-sm leading-5 text-zinc-300">
          {prompt.message || defaultMessage}
        </p>

        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
          Current version {prompt.currentVersion}
          {prompt.isRequired && prompt.minSupportedVersion
            ? ` · Required version ${prompt.minSupportedVersion}`
            : ''}
        </div>

        {prompt.storeUrl && (
          <button
            type="button"
            onClick={openStorePage}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/45 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-400/15"
          >
            <ExternalLink className="h-4 w-4" />
            Open Chrome Web Store upgrade page
          </button>
        )}
      </section>
    </div>
  );
};

export default ExtensionUpdateModal;
