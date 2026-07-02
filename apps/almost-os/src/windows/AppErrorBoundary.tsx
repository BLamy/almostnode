import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

/**
 * Crash isolation for a single app window. A render error in one app is caught
 * here and shown as an in-window fallback ("<App> crashed — Reload") instead of
 * unmounting the whole desktop. Reload clears the error and re-mounts the app's
 * subtree (a fresh start without closing the window); Close removes the window.
 *
 * Each WindowManager `Window` renders its own boundary, so failures are scoped
 * to that window.
 */
interface AppErrorBoundaryProps {
  /** App/window name shown in the fallback. */
  appName: string;
  /** Remove the window entirely (traffic-light close). */
  onClose: () => void;
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  /** Bumped on Reload to force a fresh mount of the children. */
  resetKey: number;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the crash observable without taking down the OS.
    console.error(
      `[almost-os] app "${this.props.appName}" crashed:`,
      error,
      info.componentStack,
    );
    // Mark the crash in the background Replay recording so the AI can debug it.
    void import("../os/replay-capture")
      .then((m) => m.recordReplayError(`${this.props.appName} crashed: ${error.message}`, info.componentStack))
      .catch(() => undefined);
  }

  private reload = (): void => {
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  render(): ReactNode {
    const { error, resetKey } = this.state;
    if (error) {
      return (
        <div className="os-app-crash" role="alert">
          <div className="os-app-crash__glyph" aria-hidden="true">
            ⚠️
          </div>
          <div className="os-app-crash__title">{this.props.appName} stopped responding</div>
          <div className="os-app-crash__detail">{error.message || "The app crashed."}</div>
          <div className="os-app-crash__actions">
            <button
              type="button"
              className="os-app-crash__btn os-app-crash__btn--primary"
              onClick={this.reload}
            >
              Reload
            </button>
            <button
              type="button"
              className="os-app-crash__btn"
              onClick={this.props.onClose}
            >
              Close
            </button>
          </div>
        </div>
      );
    }
    // Keying on resetKey remounts the subtree on Reload (fresh mount, no extra
    // DOM node so app layout is untouched); a Reload that immediately re-throws
    // simply shows the fallback again.
    return <Fragment key={resetKey}>{this.props.children}</Fragment>;
  }
}
