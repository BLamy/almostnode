/** macOS-flavored dock/app icons drawn as self-contained SVGs. */

function IconFrame({
  children,
  gradient,
  id,
}: {
  children: React.ReactNode;
  gradient: [string, string];
  id: string;
}) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={gradient[0]} />
          <stop offset="1" stopColor={gradient[1]} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${id})`} />
      {children}
    </svg>
  );
}

export function FinderIcon() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="finder-l" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ea9ff" />
          <stop offset="1" stopColor="#1f6fe5" />
        </linearGradient>
        <linearGradient id="finder-r" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbecff" />
          <stop offset="1" stopColor="#a9cdf7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#finder-r)" />
      <path d="M2 16C2 8.8 8.8 2 16 2H32V62H16C8.8 62 2 55.2 2 48V16Z" fill="url(#finder-l)" />
      <path d="M20 22v9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M44 22v9" stroke="#21508f" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M24 42c4 4 12 4 16 0"
        stroke="#21508f"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function TerminalIcon() {
  return (
    <IconFrame id="term-g" gradient={["#3a3f47", "#15171b"]}>
      <rect x="9" y="13" width="46" height="38" rx="6" fill="#0c0e11" />
      <path
        d="M16 24l7 6-7 6"
        stroke="#7ef0a0"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M28 38h12" stroke="#7ef0a0" strokeWidth="3" strokeLinecap="round" />
    </IconFrame>
  );
}

export function CodeIcon() {
  return (
    <IconFrame id="code-g" gradient={["#39a0f0", "#1572c7"]}>
      <path
        d="M24 22l-10 10 10 10"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M40 22l10 10-10 10"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M36 18l-8 28" stroke="#bfe2ff" strokeWidth="3.2" strokeLinecap="round" />
    </IconFrame>
  );
}

export function KeychainIcon() {
  return (
    <IconFrame id="key-g" gradient={["#c9a24a", "#9a7426"]}>
      <circle cx="26" cy="26" r="9" fill="none" stroke="#fff7e0" strokeWidth="4" />
      <path
        d="M31 31l13 13M40 40l5-5M44 44l4-4"
        stroke="#fff7e0"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </IconFrame>
  );
}

export function ChromeIcon() {
  // Raster logo on a white tile; mirror IconFrame's geometry (rect inset 2/64,
  // rx 14/60) so it reads as the same squircle as the SVG icons.
  return (
    <div
      style={{
        width: "93.75%",
        height: "93.75%",
        margin: "3.125%",
        borderRadius: "23%",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <img
        src={`${import.meta.env.BASE_URL}chrome-icon.png`}
        alt=""
        width="100%"
        height="100%"
        style={{ display: "block", objectFit: "cover" }}
      />
    </div>
  );
}

const TS_DOTS: Array<[number, number, number]> = [
  [6, 6, 1],
  [12, 6, 0.4],
  [18, 6, 1],
  [6, 12, 0.4],
  [12, 12, 1],
  [18, 12, 0.4],
  [6, 18, 1],
  [12, 18, 0.4],
  [18, 18, 1],
];

/** Tailscale wordmark dot-grid, in currentColor (for the menu bar). */
export function TailscaleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      {TS_DOTS.map(([cx, cy, o], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.1" fill="currentColor" opacity={o} />
      ))}
    </svg>
  );
}

export function TailscaleIcon() {
  return (
    <IconFrame id="ts-g" gradient={["#2a2a2e", "#101013"]}>
      {TS_DOTS.map(([cx, cy, o], i) => (
        <circle key={i} cx={cx * (64 / 24)} cy={cy * (64 / 24)} r="5.4" fill="#fff" opacity={o} />
      ))}
    </IconFrame>
  );
}

export function WinampIcon() {
  return (
    <IconFrame id="winamp-g" gradient={["#3b3b3b", "#161616"]}>
      <rect x="11" y="13" width="42" height="12" rx="2.5" fill="#06160a" />
      <path
        d="M15 19h6M23 19h5M30 19h9M41 19h6"
        stroke="#39ff84"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M37 27l-13 15h8l-4 11 15-17h-9z" fill="#ff8a1e" />
    </IconFrame>
  );
}

export function NapsterIcon() {
  // The classic Napster cat: white headphone-wearing face, green eyes.
  return (
    <IconFrame id="napster-g" gradient={["#5a8fd6", "#3f6fb2"]}>
      {/* headphone band + ear cups */}
      <path
        d="M18 26c2-9 10-14 14-14s12 5 14 14"
        fill="none"
        stroke="#fff"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <rect x="12" y="24" width="7" height="12" rx="3.5" fill="#fff" />
      <rect x="45" y="24" width="7" height="12" rx="3.5" fill="#fff" />
      {/* cat face with pointed ears */}
      <path
        d="M22 22l6 7h8l6-7v20c0 6-5 10-10 10s-10-4-10-10V22z"
        fill="#fff"
      />
      {/* green eyes */}
      <path d="M25 38c3-3 6-3 8 0-2 2-6 2-8 0z" fill="#6cc24a" />
      <path d="M31 38c2-3 5-3 8 0-2 2-6 2-8 0z" fill="#6cc24a" />
      {/* nose */}
      <path d="M29 44h6l-3 4z" fill="#3f6fb2" />
    </IconFrame>
  );
}

export function AppStoreIcon() {
  // App Store-style: blue rounded square with a white "A" drawn from sticks.
  return (
    <IconFrame id="appstore-g" gradient={["#2aa5ff", "#0a63f0"]}>
      <g
        stroke="#fff"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M24 44 L32 20 L40 44" />
        <path d="M27.5 37 H36.5" />
        <path d="M21 48 H43" strokeWidth="3.2" opacity="0.85" />
      </g>
    </IconFrame>
  );
}

export function SettingsIcon() {
  return (
    <IconFrame id="settings-g" gradient={["#b0b0b8", "#6c6c76"]}>
      <circle cx="32" cy="32" r="8.5" fill="none" stroke="#fff" strokeWidth="4.5" />
      <g stroke="#fff" strokeWidth="4.5" strokeLinecap="round">
        <path d="M32 11v7M32 46v7M11 32h7M46 32h7" />
        <path d="M17.2 17.2l5 5M41.8 41.8l5 5M46.8 17.2l-5 5M22.2 41.8l-5 5" />
      </g>
    </IconFrame>
  );
}

export function ChatIcon() {
  return (
    <IconFrame id="chat-g" gradient={["#ff8a3d", "#f2620f"]}>
      <path
        d="M16 22h32v18a6 6 0 0 1-6 6H28l-10 8v-8a6 6 0 0 1-2-4V22z"
        fill="#fff"
        opacity="0.95"
      />
      <circle cx="26" cy="33" r="2.4" fill="#f2620f" />
      <circle cx="34" cy="33" r="2.4" fill="#f2620f" />
      <circle cx="42" cy="33" r="2.4" fill="#f2620f" />
    </IconFrame>
  );
}

export function ExecutorIcon() {
  return (
    <IconFrame id="executor-g" gradient={["#1c1f26", "#0a0b0e"]}>
      <rect x="9" y="11" width="46" height="42" rx="7" fill="#05060a" stroke="#2b313d" />
      <path
        d="M16 22l6 5-6 5"
        stroke="#8b5cf6"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M26 34h10" stroke="#8b5cf6" strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M43 20l-5 11h5l-3 11 9-14h-6l4-8z"
        fill="#f0abfc"
        stroke="none"
      />
    </IconFrame>
  );
}
