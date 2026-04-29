import { useEffect, useRef } from 'react';

interface EndOfTutorialAnimationProps {
  onDone: () => void;
}

const TUTORIAL_COMPLETE_VIDEO_SRC = './images/tutorial-complete-serious-powerup.webm';
const TUTORIAL_COMPLETE_STILL_SRC = './images/tutorial-complete-serious-powerup-still.jpg';
const ANIMATION_DURATION_MS = 2800;
const REDUCED_MOTION_DURATION_MS = 900;

const EndOfTutorialAnimation = ({ onDone }: EndOfTutorialAnimationProps) => {
  const onDoneRef = useRef(onDone);
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onDoneRef.current();
    }, prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : ANIMATION_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [prefersReducedMotion]);

  return (
    <div className="end-tutorial-animation" aria-hidden="true">
      {prefersReducedMotion ? (
        <>
          <img
            className="end-tutorial-video-background"
            src={TUTORIAL_COMPLETE_STILL_SRC}
            alt=""
          />
          <img
            className="end-tutorial-video"
            src={TUTORIAL_COMPLETE_STILL_SRC}
            alt=""
          />
        </>
      ) : (
        <>
          <video
            className="end-tutorial-video-background"
            src={TUTORIAL_COMPLETE_VIDEO_SRC}
            autoPlay
            muted
            playsInline
            preload="auto"
          />
          <video
            className="end-tutorial-video"
            src={TUTORIAL_COMPLETE_VIDEO_SRC}
            autoPlay
            muted
            playsInline
            preload="auto"
          />
        </>
      )}
      <div className="end-tutorial-flash" />
      <div className="end-tutorial-vignette" />
    </div>
  );
};

export default EndOfTutorialAnimation;
