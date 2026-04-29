import React from 'react';
import { Info, X } from 'lucide-react';
import type { ExtensionClientMessagePrompt } from '../utils/extensionUpdate';

interface ClientMessageModalProps {
  prompt: ExtensionClientMessagePrompt;
  onClose: () => void;
}

const ClientMessageModal: React.FC<ClientMessageModalProps> = ({ prompt, onClose }) => {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-message-title"
        className="relative w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-white shadow-2xl shadow-black/50"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/8 hover:text-white"
          aria-label="Dismiss message"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-3 flex items-center gap-3 pr-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-400/10 text-sky-200">
            <Info className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-200/80">
              Message
            </p>
            <h2 id="client-message-title" className="text-base font-semibold leading-tight">
              Intention Setting
            </h2>
          </div>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-5 text-zinc-300">
          {prompt.message}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200"
        >
          Got it
        </button>
      </section>
    </div>
  );
};

export default ClientMessageModal;
