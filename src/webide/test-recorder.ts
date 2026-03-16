import type { ExecResult as JustBashExecResult } from 'just-bash';
import type { PlaywrightSelectorContext } from '../shims/playwright-command';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecordedStep {
  command: string;
  args: string[];
  result: JustBashExecResult;
  selectorContext?: PlaywrightSelectorContext;
  timestamp: number;
}

export type RecorderState = 'idle' | 'recording';

export interface TestRecorderCallbacks {
  onTestDetected: () => void;
  onStepRecorded: (step: RecordedStep, stepIndex: number) => void;
}

// Commands that constitute user interactions (trigger recording)
const INTERACTION_COMMANDS = new Set([
  'open', 'click', 'fill', 'type', 'press', 'hover',
]);

// Read-only commands that we still record for context but don't trigger recording
const CONTEXT_COMMANDS = new Set([
  'snapshot', 'console', 'eval', 'screenshot',
]);

// Commands we never record
const IGNORED_COMMANDS = new Set([
  'help', 'close', 'resize',
]);

// ── TestRecorder ─────────────────────────────────────────────────────────────

export class TestRecorder {
  private state: RecorderState = 'idle';
  private steps: RecordedStep[] = [];
  private callbacks: TestRecorderCallbacks | null = null;
  private hasNotifiedDetection = false;

  setCallbacks(callbacks: TestRecorderCallbacks): void {
    this.callbacks = callbacks;
  }

  getState(): RecorderState {
    return this.state;
  }

  getSteps(): readonly RecordedStep[] {
    return this.steps;
  }

  /**
   * Called by the playwright-command listener when any command runs.
   */
  recordCommand(
    subcommand: string,
    args: string[],
    result: JustBashExecResult,
    selectorContext?: PlaywrightSelectorContext,
  ): void {
    if (IGNORED_COMMANDS.has(subcommand)) return;

    // Only record if the command succeeded
    if (result.exitCode !== 0) return;

    const isInteraction = INTERACTION_COMMANDS.has(subcommand);
    const isContext = CONTEXT_COMMANDS.has(subcommand);

    // Start recording on first interaction
    if (this.state === 'idle' && isInteraction) {
      this.state = 'recording';
      this.steps = [];
      this.hasNotifiedDetection = false;
    }

    // Only record interaction and context commands when in recording state
    if (this.state !== 'recording') return;
    if (!isInteraction && !isContext) return;

    const step: RecordedStep = {
      command: subcommand,
      args: [...args],
      result: { ...result },
      selectorContext,
      timestamp: Date.now(),
    };
    this.steps.push(step);

    this.callbacks?.onStepRecorded(step, this.steps.length - 1);

    // Notify once when first interaction is captured
    if (isInteraction && !this.hasNotifiedDetection) {
      this.hasNotifiedDetection = true;
      this.callbacks?.onTestDetected();
    }
  }

  /**
   * Finalize recording and return the captured steps.
   */
  finalize(): RecordedStep[] {
    const result = [...this.steps];
    this.reset();
    return result;
  }

  /**
   * Discard current recording.
   */
  reset(): void {
    this.state = 'idle';
    this.steps = [];
    this.hasNotifiedDetection = false;
  }
}
