interface TrafficLightsProps {
  onClose: () => void;
  onMinimize: () => void;
  onZoom: () => void;
}

/** macOS window controls: close (red), minimize (yellow), zoom (green). */
export function TrafficLights({ onClose, onMinimize, onZoom }: TrafficLightsProps) {
  return (
    <div
      className="os-traffic"
      // Don't let a click on the lights start a window drag.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="os-traffic__dot os-traffic__dot--close"
        aria-label="Close"
        onClick={onClose}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6" />
        </svg>
      </button>
      <button
        type="button"
        className="os-traffic__dot os-traffic__dot--min"
        aria-label="Minimize"
        onClick={onMinimize}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.6 6h6.8" />
        </svg>
      </button>
      <button
        type="button"
        className="os-traffic__dot os-traffic__dot--zoom"
        aria-label="Zoom"
        onClick={onZoom}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 4h4v4z M8 8H4V4z" />
        </svg>
      </button>
    </div>
  );
}
