import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Step, Story } from '../types';
import { Diagram } from './Diagram';
import { NarrationPanel } from './NarrationPanel';
import { cancelSpeech, isSpeechSupported, speak, speechify } from './speech';

const AUTO_NEXT_SECONDS = 10;

/** Spoken text for a step (cover subtitle or narration, smoothed), or its override. */
function spokenText(step: Step): string {
  const body = step.cover ? step.coverSubtitle || step.narration : step.narration;
  return step.say ?? speechify(step.title ? `${step.title}. ${body}` : body);
}

/** Estimated time a step takes: spoken length when narrating, else its dwell. */
function estDuration(step: Step, muted: boolean, speechSupported: boolean): number {
  if (muted || !speechSupported) return dwellFor(step);
  const words = spokenText(step).split(/\s+/).filter(Boolean).length;
  return Math.min(45000, Math.max(2500, words * 380 + 1200));
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** How long autoplay lingers on a step before advancing. */
function dwellFor(step: Step): number {
  if (step.autoAdvanceMs) return step.autoAdvanceMs;
  let span = 0;
  for (const m of step.messages ?? []) {
    span = Math.max(span, (m.delay ?? 0) + (m.duration ?? 950));
  }
  return Math.max(4200, span + 1800);
}

export function Presentation({
  story,
  onExit,
  nextChapterTitle,
  onNextChapter,
  autoStart = true,
  onStart,
}: {
  story: Story;
  onExit?: () => void;
  nextChapterTitle?: string;
  onNextChapter?: () => void;
  /** start playing on mount (auto-advanced chapters do; a first page view may not) */
  autoStart?: boolean;
  /** called the first time playback starts, so the host can auto-play the rest */
  onStart?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoStart);
  const [muted, setMuted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_NEXT_SECONDS);
  const reduced = usePrefersReducedMotion();
  const speechSupported = isSpeechSupported();

  const last = story.steps.length - 1;
  const step = story.steps[index];

  const durations = useMemo(
    () => story.steps.map((s) => estDuration(s, muted, speechSupported)),
    [story, muted, speechSupported]
  );

  const togglePlay = useCallback(() => {
    setFinished(false);
    setPlaying((p) => !p);
  }, []);

  // Live refs so the narration's end callback reads current play/mute state.
  const playingRef = useRef(playing);
  const mutedRef = useRef(muted);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Tell the host once playback is running (so subsequent chapters auto-play).
  useEffect(() => {
    if (playing) onStart?.();
  }, [playing, onStart]);

  const next = useCallback(() => setIndex((i) => Math.min(last, i + 1)), [last]);
  const prev = useCallback(() => {
    setPlaying(false);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Home') {
        setIndex(0);
      } else if (e.key === 'End') {
        setIndex(last);
      } else if (e.key === 'Escape' && onExit) {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, last, onExit, togglePlay]);

  // Autoplay. When sound is on, the narration's end (below) advances the slide,
  // so playback waits for the audio. When muted, it falls back to a dwell timer.
  useEffect(() => {
    if (!playing) return;
    if (!muted && speechSupported) return; // narration drives advancing & finishing
    const t = window.setTimeout(() => {
      if (index >= last) {
        setPlaying(false);
        setFinished(true);
      } else {
        setIndex((i) => i + 1);
      }
    }, dwellFor(step));
    return () => window.clearTimeout(t);
  }, [playing, index, last, step, muted, speechSupported]);

  // Narration is driven by PLAY, not the sound button: it only speaks while the
  // slideshow is *playing* and unmuted. The sound button is just a mute toggle —
  // it controls whether audio comes out, never playback. When a slide's audio
  // finishes, advance to the next slide (so playback waits for the voice).
  useEffect(() => {
    if (!playing || muted || !speechSupported) {
      cancelSpeech();
      return;
    }
    const text = spokenText(step);

    let fired = false;
    let cancelled = false;
    let advanceTimer = 0;
    const onDone = () => {
      if (fired || cancelled || !playingRef.current || mutedRef.current) return;
      fired = true;
      advanceTimer = window.setTimeout(() => {
        if (index >= last) {
          setPlaying(false);
          setFinished(true);
        } else {
          setIndex((i) => Math.min(last, i + 1));
        }
      }, 450);
    };

    speak(text, { onend: onDone, onerror: onDone });

    // Backstop so a silently-failing voice can't stall playback forever.
    const words = text.split(/\s+/).filter(Boolean).length;
    const backstop = window.setTimeout(onDone, Math.min(45000, Math.max(8000, words * 420 + 4000)));

    return () => {
      cancelled = true;
      window.clearTimeout(advanceTimer);
      window.clearTimeout(backstop);
      cancelSpeech();
    };
  }, [playing, muted, index, last, step, speechSupported]);

  // Leaving the last slide dismisses the end-of-chapter card.
  useEffect(() => {
    if (index !== last) setFinished(false);
  }, [index, last]);

  // End-of-chapter countdown → auto-advance to the next chapter after 10s.
  useEffect(() => {
    if (!finished || !onNextChapter) return;
    setSecondsLeft(AUTO_NEXT_SECONDS);
    const id = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [finished, onNextChapter]);

  useEffect(() => {
    if (finished && onNextChapter && secondsLeft === 0) onNextChapter();
  }, [finished, onNextChapter, secondsLeft]);

  return (
    <div className="presentation">
      {onExit && (
        <button className="chapters-btn" onClick={onExit} aria-label="Back to chapters">
          ← Chapters
        </button>
      )}

      {finished && (
        <div className="end-card" role="dialog" aria-label="Chapter finished">
          {onNextChapter ? (
            <>
              <div className="end-eyebrow">Up next</div>
              <div className="end-title">{nextChapterTitle}</div>
              <div className="end-countbar">
                <span />
              </div>
              <div className="end-sub">Auto-playing in {secondsLeft}s</div>
              <div className="end-actions">
                <button className="end-go" onClick={onNextChapter}>
                  Play now →
                </button>
                <button className="end-cancel" onClick={() => setFinished(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="end-eyebrow">The end</div>
              <div className="end-title">That’s the last chapter</div>
              <div className="end-actions">
                {onExit && (
                  <button className="end-go" onClick={onExit}>
                    ← Chapters
                  </button>
                )}
                <button className="end-cancel" onClick={() => setFinished(false)}>
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <Diagram story={story} stepIndex={index} reduced={reduced} />

      {!playing && !finished && (
        <button className="play-overlay" onClick={togglePlay} aria-label="Play slideshow">
          <span className="play-overlay-btn">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
        </button>
      )}

      <NarrationPanel
        story={story}
        index={index}
        playing={playing}
        muted={muted}
        durations={durations}
        finished={finished}
        onPrev={prev}
        onNext={next}
        onTogglePlay={togglePlay}
        onToggleSound={speechSupported ? () => setMuted((m) => !m) : undefined}
        onSeek={(i) => setIndex(i)}
      />
    </div>
  );
}
