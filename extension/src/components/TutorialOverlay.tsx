import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, Mail, Sparkles, X } from 'lucide-react';
import { COMPANION_WEB_APP_URL, TUTORIAL_EXACT_PROMPT } from '../constants';

export type TutorialStep = 'invite' | 'prompt' | 'openRule' | 'makeHard' | 'saveHard' | 'replayTutorial' | 'companionWebApp' | 'complete';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TutorialOverlayProps {
  step: TutorialStep;
  promptMismatch: boolean;
  onStart: () => void;
  onDecline: () => void;
  onExit: () => void;
  onContinue: () => void;
  onFinish: () => void;
}

const TARGET_SELECTORS: Record<TutorialStep, string | null> = {
  invite: '[data-tutorial-target="ai-open-button"]',
  prompt: '[data-tutorial-target="ai-input"]',
  openRule: '[data-tutorial-target="social-media-rule-card"]',
  makeHard: '[data-tutorial-target="hard-rule-button"]',
  saveHard: '[data-tutorial-target="save-rule-button"]',
  replayTutorial: '[data-tutorial-target="replay-tutorial-button"]',
  companionWebApp: '[data-tutorial-target="companion-web-app-link"]',
  complete: null,
};

const TUTORIAL_STEP_COUNT = 6;

const STEP_INDEX: Record<TutorialStep, number | null> = {
  invite: null,
  prompt: 1,
  openRule: 2,
  makeHard: 3,
  saveHard: 4,
  replayTutorial: 5,
  companionWebApp: 6,
  complete: null,
};

const DEVELOPER_PHOTO_SRC = './images/developer-hello.jpg';
const DEVELOPER_EMAIL_URL = 'https://mail.google.com/mail/u/0/?to=henrymdeutsch%40gmail.com&tf=cm';

const getFallbackRect = (): SpotlightRect => {
  const width = Math.min(window.innerWidth - 48, 320);
  const height = 156;

  return {
    top: Math.max(72, Math.round(window.innerHeight * 0.28)),
    left: Math.max(24, Math.round((window.innerWidth - width) / 2)),
    width,
    height,
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const measureTarget = (selector: string | null): SpotlightRect => {
  if (!selector) return getFallbackRect();

  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return getFallbackRect();

  const targetRect = target.getBoundingClientRect();
  const padding = 8;
  const left = clamp(targetRect.left - padding, 8, Math.max(8, window.innerWidth - 24));
  const top = clamp(targetRect.top - padding, 8, Math.max(8, window.innerHeight - 24));
  const right = clamp(targetRect.right + padding, left + 24, window.innerWidth - 8);
  const bottom = clamp(targetRect.bottom + padding, top + 24, window.innerHeight - 8);

  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
};

const expandRect = (rect: SpotlightRect, padding: number): SpotlightRect => {
  const left = Math.max(8, rect.left - padding);
  const top = Math.max(8, rect.top - padding);
  const right = Math.min(window.innerWidth - 8, rect.left + rect.width + padding);
  const bottom = Math.min(window.innerHeight - 8, rect.top + rect.height + padding);

  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
};

const stepCopy = (step: TutorialStep, promptMismatch: boolean) => {
  if (step === 'invite') {
    return {
      eyebrow: 'New in Intention Setting',
      title: 'Want a 60 second tour?',
      body: 'Create an AI rule, open it, and turn it into a hard limit. Quick, guided, and hands-on.',
    };
  }

  if (step === 'prompt') {
    return {
      eyebrow: `Step 1 of ${TUTORIAL_STEP_COUNT}`,
      title: 'Ask AI to build the soft rule',
      body: promptMismatch
        ? 'Type the prompt exactly as shown, then press Enter.'
        : 'Type this exact prompt in the AI chat, then press Enter.',
    };
  }

  if (step === 'openRule') {
    return {
      eyebrow: `Step 2 of ${TUTORIAL_STEP_COUNT}`,
      title: 'Open the new rule',
      body: 'The soft social media limit is ready. Click the rule to edit it.',
    };
  }

  if (step === 'makeHard') {
    return {
      eyebrow: `Step 3 of ${TUTORIAL_STEP_COUNT}`,
      title: 'Make it a hard rule',
      body: 'Select Hard so the limit becomes strict when time runs out.',
    };
  }

  if (step === 'saveHard') {
    return {
      eyebrow: `Step 4 of ${TUTORIAL_STEP_COUNT}`,
      title: 'Save the change',
      body: 'Save the rule and the extension will sync the hard limit.',
    };
  }

  if (step === 'replayTutorial') {
    return {
      eyebrow: `Step 5 of ${TUTORIAL_STEP_COUNT}`,
      title: 'Replay this anytime',
      body: 'If you ever want to go through the tutorial again, it lives here in Settings.',
    };
  }

  if (step === 'companionWebApp') {
    return {
      eyebrow: `Step 6 of ${TUTORIAL_STEP_COUNT}`,
      title: 'There is a web app too',
      body: 'The companion web app lives here if you want to open Intention Setting in a regular browser tab.',
    };
  }

  return {
    eyebrow: 'Tutorial complete',
    title: 'You are set',
    body: ":o hello! This is a very new app! So if you want to chat with me, the developer, about your bad UX or to say what's up, pls do!",
  };
};

const getCardPosition = (rect: SpotlightRect, step: TutorialStep): React.CSSProperties => {
  const cardWidth = Math.min(step === 'complete' || step === 'companionWebApp' ? 360 : 330, window.innerWidth - 32);
  const left = clamp(rect.left + rect.width / 2 - cardWidth / 2, 16, window.innerWidth - cardWidth - 16);
  const estimatedHeight = step === 'complete'
    ? Math.min(460, window.innerHeight - 32)
    : step === 'companionWebApp'
      ? 280
      : 220;
  const shouldPlaceAbove = rect.top > window.innerHeight * 0.54;

  if (shouldPlaceAbove) {
    return {
      width: cardWidth,
      left,
      bottom: Math.max(16, window.innerHeight - rect.top + 14),
    };
  }

  return {
    width: cardWidth,
    left,
    top: Math.min(rect.top + rect.height + 14, window.innerHeight - estimatedHeight - 16),
  };
};

const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  step,
  promptMismatch,
  onStart,
  onDecline,
  onExit,
  onContinue,
  onFinish,
}) => {
  const selector = TARGET_SELECTORS[step];
  const hasTargetSpotlight = selector !== null;
  const cardRef = useRef<HTMLElement>(null);
  const [rect, setRect] = useState<SpotlightRect>(() => measureTarget(selector));
  const [cardRect, setCardRect] = useState<SpotlightRect | null>(null);
  const copy = stepCopy(step, promptMismatch);
  const cardPosition = useMemo(() => getCardPosition(rect, step), [rect, step]);
  const stepIndex = STEP_INDEX[step];
  const cardBacklightRect = cardRect ? expandRect(cardRect, 16) : null;

  useLayoutEffect(() => {
    const updateRect = () => setRect(measureTarget(selector));
    updateRect();

    const intervalId = window.setInterval(updateRect, 180);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [selector, step]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const updateCardRect = () => {
      const nextRect = card.getBoundingClientRect();
      setCardRect({
        top: nextRect.top,
        left: nextRect.left,
        width: nextRect.width,
        height: nextRect.height,
      });
    };

    updateCardRect();
    const animationFrame = window.requestAnimationFrame(updateCardRect);
    const resizeObserver = new ResizeObserver(updateCardRect);
    resizeObserver.observe(card);
    window.addEventListener('resize', updateCardRect);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCardRect);
    };
  }, [cardPosition, step]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-[80]">
      {hasTargetSpotlight ? (
        <>
          <div
            className="fixed left-0 right-0 top-0 bg-black/35"
            style={{ height: rect.top }}
          />
          <div
            className="fixed left-0 right-0 bg-black/35"
            style={{ top: rect.top + rect.height, bottom: 0 }}
          />
          <div
            className="fixed left-0 bg-black/35"
            style={{ top: rect.top, width: rect.left, height: rect.height }}
          />
          <div
            className="fixed right-0 bg-black/35"
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              height: rect.height,
            }}
          />

          <div
            className="fixed z-[81] rounded-[10px] border border-emerald-300/70 shadow-[0_0_0_1px_rgba(16,185,129,0.22),0_0_34px_rgba(16,185,129,0.24)]"
            style={rect}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/35" />
      )}

      {!hasTargetSpotlight && cardBacklightRect && (
        <div
          className="fixed z-[81] rounded-[24px] border border-emerald-300/55 bg-emerald-300/[0.03] shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_0_44px_rgba(16,185,129,0.26),0_0_96px_rgba(16,185,129,0.12)]"
          style={cardBacklightRect}
        />
      )}

      <section
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        className="pointer-events-auto fixed z-[82] max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl border border-white/12 bg-zinc-950/96 p-4 text-white shadow-2xl shadow-black/50 ring-1 ring-white/10"
        style={cardPosition}
      >
        <button
          type="button"
          onClick={onExit}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/8 hover:text-white"
          aria-label="Exit tutorial"
          title="Exit tutorial"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-3 flex items-center gap-2 pr-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
            {step === 'complete' ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-200/80">
              {copy.eyebrow}
            </p>
            <h2 className="text-base font-semibold leading-tight text-white">{copy.title}</h2>
          </div>
        </div>

        {step === 'complete' && (
          <img
            src={DEVELOPER_PHOTO_SRC}
            alt="Henry waving hello"
            className="mx-auto mb-3 h-40 w-36 rounded-xl border border-white/10 object-cover shadow-lg shadow-black/35"
          />
        )}

        <p className="text-sm leading-5 text-zinc-300">{copy.body}</p>

        {step === 'prompt' && (
          <div
            className={`mt-3 rounded-lg border p-3 text-[13px] leading-5 text-zinc-100 ${
              promptMismatch
                ? 'border-red-400/60 bg-red-500/10'
                : 'border-zinc-700 bg-zinc-900'
            }`}
          >
            {TUTORIAL_EXACT_PROMPT}
          </div>
        )}

        {stepIndex !== null && (
          <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: TUTORIAL_STEP_COUNT }, (_, index) => index + 1).map((index) => (
              <div
                key={index}
                className={`h-1.5 flex-1 rounded-full ${
                  index <= stepIndex ? 'bg-emerald-300' : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>
        )}

        {step === 'invite' && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onDecline}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Nah
            </button>
            <button
              type="button"
              onClick={onStart}
              className="flex-1 rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200"
            >
              Go!
            </button>
          </div>
        )}

        {step === 'replayTutorial' && (
          <button
            type="button"
            onClick={onContinue}
            className="mt-4 w-full rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200"
          >
            Got it
          </button>
        )}

        {step === 'companionWebApp' && (
          <div className="mt-4 flex flex-col gap-2">
            <a
              href={COMPANION_WEB_APP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200"
            >
              <ExternalLink className="h-4 w-4" />
              Open web app
            </a>
            <button
              type="button"
              onClick={onContinue}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'complete' && (
          <div className="mt-4 flex flex-col gap-2">
            <a
              href={DEVELOPER_EMAIL_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/70 bg-emerald-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-200"
            >
              <Mail className="h-4 w-4" />
              Email me
            </a>
            <button
              type="button"
              onClick={onFinish}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Done
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default TutorialOverlay;
