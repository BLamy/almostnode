import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type AuthStrategyExplainerProps = {
  headline: string;
  subheadline: string;
  siteUrl: string;
};

const palette = {
  bg: '#071018',
  bgAlt: '#0d1826',
  text: '#eff5ff',
  muted: '#9cb0cb',
  accent: '#ff7a59',
  gold: '#ffc352',
  cyan: '#5dd5ff',
  green: '#56d39e',
  violet: '#8f7cff',
  red: '#ff6b77',
  border: 'rgba(255, 255, 255, 0.09)',
  panel: 'rgba(10, 17, 28, 0.82)',
  panelSoft: 'rgba(255, 255, 255, 0.04)',
};

const mono = 'IBM Plex Mono, Menlo, monospace';
const sans = 'Instrument Sans, Inter, ui-sans-serif, system-ui, sans-serif';

const sec = (fps: number, seconds: number) => Math.floor(fps * seconds);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

const fadeIn = (frame: number, start: number, duration: number) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const fadeOut = (frame: number, start: number, duration: number) =>
  interpolate(frame, [start, start + duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const sceneWindow = (
  frame: number,
  start: number,
  end: number,
  enterDuration = 16,
  exitDuration = 16,
) => fadeIn(frame, start, enterDuration) * fadeOut(frame, end - exitDuration, exitDuration);

const pop = (frame: number, fps: number, start: number) =>
  spring({
    fps,
    frame: frame - start,
    config: {
      stiffness: 170,
      damping: 22,
      mass: 0.9,
    },
  });

const panelStyle: CSSProperties = {
  background: palette.panel,
  border: `1px solid ${palette.border}`,
  boxShadow: '0 30px 80px rgba(0, 0, 0, 0.34)',
  backdropFilter: 'blur(20px)',
};

const tagStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 18px',
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.06)',
  border: `1px solid ${palette.border}`,
  fontSize: 18,
  color: palette.muted,
};

const tiers = [
  {
    tier: 'Tier A',
    title: 'Unattended trusted node',
    body: 'Bounded ongoing use after one authentication event for lower-risk workflows.',
    accent: palette.accent,
  },
  {
    tier: 'Tier B',
    title: 'Fresh-presence device',
    body: 'Phone or high-trust device requires biometric or PIN verification per sensitive request.',
    accent: palette.green,
  },
  {
    tier: 'Tier C',
    title: 'Infrastructure service node',
    body: 'Always-on internal-service access without exposure to personal external-provider credentials.',
    accent: palette.cyan,
  },
  {
    tier: 'Tier D',
    title: 'Ephemeral requesting agent',
    body: 'Agent can request actions and receive scoped results, but it is not trusted with reusable secrets.',
    accent: palette.violet,
  },
];

const shellLines = [
  '$ tailscale login',
  'provider: tailscale',
  'state: running',
  'tailnet: example.ts.net',
  '$ request use github.createIssue',
  'scope: repo:docs  ttl: 5m',
  'result: scoped grant delivered',
];

const coreClaims = [
  'Server coordinates policy and routing, but does not execute reusable secret use.',
  'Passkey-backed PRF derives the vault key locally; ciphertext and metadata are the only server-side state.',
  'Trusted nodes execute approved actions over the tailnet; agents ask for actions, not secret disclosure.',
  'TTL, revocation, nonce checks, and audit records constrain every approval window.',
];

const Pill = ({
  label,
  color,
  style,
}: {
  label: string;
  color: string;
  style?: CSSProperties;
}) => (
  <div
    style={{
      ...tagStyle,
      ...style,
      color: palette.text,
    }}
  >
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 18px ${color}`,
      }}
    />
    {label}
  </div>
);

const CodeChip = ({ text }: { text: string }) => (
  <div
    style={{
      padding: '10px 14px',
      borderRadius: 14,
      border: `1px solid ${palette.border}`,
      background: 'rgba(255, 255, 255, 0.05)',
      fontFamily: mono,
      fontSize: 17,
      color: palette.gold,
    }}
  >
    {text}
  </div>
);

const FigureCard = ({
  title,
  caption,
  src,
  frame,
  start,
  zoom = [1, 1.04],
  style,
  children,
}: {
  title: string;
  caption: string;
  src: string;
  frame: number;
  start: number;
  zoom?: [number, number];
  style?: CSSProperties;
  children?: ReactNode;
}) => {
  const zoomValue = interpolate(frame, [start, start + 120], zoom, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        ...panelStyle,
        ...style,
        borderRadius: 28,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '18px 22px 14px',
          borderBottom: `1px solid ${palette.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 20,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 15, color: palette.muted }}>{caption}</div>
      </div>
      <div
        style={{
          position: 'relative',
          height: 'calc(100% - 66px)',
          background: 'rgba(255, 255, 255, 0.03)',
        }}
      >
        <Img
          src={src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoomValue})`,
            transformOrigin: 'center center',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(6, 10, 16, 0.02) 0%, rgba(6, 10, 16, 0.08) 54%, rgba(6, 10, 16, 0.18) 100%)',
          }}
        />
        {children}
      </div>
    </div>
  );
};

const TierCard = ({
  tier,
  title,
  body,
  accent,
  frame,
  fps,
  start,
}: {
  tier: string;
  title: string;
  body: string;
  accent: string;
  frame: number;
  fps: number;
  start: number;
}) => {
  const reveal = pop(frame, fps, start);

  return (
    <div
      style={{
        ...panelStyle,
        borderRadius: 24,
        padding: '22px 22px 20px',
        opacity: reveal,
        transform: `translateY(${(1 - reveal) * 30}px)`,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 999,
          marginBottom: 16,
          background: `${accent}22`,
          color: accent,
          fontWeight: 700,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: accent,
          }}
        />
        {tier}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.08,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 18,
          color: '#d3dced',
          lineHeight: 1.42,
        }}
      >
        {body}
      </div>
    </div>
  );
};

export const AuthStrategyExplainer = ({
  headline,
  subheadline,
  siteUrl,
}: AuthStrategyExplainerProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const heroStart = 0;
  const heroEnd = sec(fps, 4.0);
  const enrollStart = sec(fps, 2.6);
  const enrollEnd = sec(fps, 7.6);
  const tierStart = sec(fps, 6.1);
  const tierEnd = sec(fps, 10.6);
  const proxyStart = sec(fps, 8.8);
  const proxyEnd = sec(fps, 13.5);
  const boundaryStart = sec(fps, 11.8);
  const boundaryEnd = sec(fps, 15.7);
  const outroStart = sec(fps, 14.4);

  const heroOpacity = sceneWindow(frame, heroStart, heroEnd, 18, 22);
  const enrollOpacity = sceneWindow(frame, enrollStart, enrollEnd, 20, 22);
  const tierOpacity = sceneWindow(frame, tierStart, tierEnd, 18, 18);
  const proxyOpacity = sceneWindow(frame, proxyStart, proxyEnd, 18, 18);
  const boundaryOpacity = sceneWindow(frame, boundaryStart, boundaryEnd, 18, 20);
  const outroOpacity = fadeIn(frame, outroStart, 20);

  const heroLift = 1 - pop(frame, fps, 0);
  const spotlightShift = interpolate(frame, [0, 480], [0, 180]);
  const scanline = interpolate(frame, [0, 480], [320, -420]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${palette.bg} 0%, ${palette.bgAlt} 100%)`,
        fontFamily: sans,
        color: palette.text,
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
          backgroundSize: '120px 120px',
          opacity: 0.14,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: -260 + spotlightShift,
          top: -240,
          width: 760,
          height: 760,
          borderRadius: 999,
          background:
            'radial-gradient(circle, rgba(255, 122, 89, 0.22) 0%, rgba(255, 122, 89, 0.06) 36%, transparent 72%)',
          filter: 'blur(26px)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          right: -130,
          top: 120,
          width: 620,
          height: 620,
          borderRadius: 999,
          background:
            'radial-gradient(circle, rgba(93, 213, 255, 0.18) 0%, rgba(93, 213, 255, 0.05) 40%, transparent 74%)',
          filter: 'blur(30px)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: scanline,
          top: 0,
          width: 420,
          height: '100%',
          transform: 'skewX(-18deg)',
          background:
            'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent)',
          opacity: 0.11,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 94,
          top: 74,
          opacity: heroOpacity,
          transform: `translateY(${heroLift * 34}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            marginBottom: 26,
          }}
        >
          <Img
            src={staticFile('brand-mark.svg')}
            style={{
              width: 74,
              height: 74,
              borderRadius: 20,
              boxShadow: '0 22px 50px rgba(0, 0, 0, 0.36)',
            }}
          />
          <div>
            <div
              style={{
                fontSize: 18,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: palette.gold,
                marginBottom: 8,
              }}
            >
              opensandbox
            </div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>
              WebAuthn + Tailnet credential execution
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.06)',
            border: `1px solid ${palette.border}`,
            color: palette.muted,
            fontSize: 17,
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: palette.green,
              boxShadow: '0 0 18px rgba(86, 211, 158, 0.75)',
            }}
          />
          Coordination server stores ciphertext only. Trusted nodes perform credential use.
        </div>

        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: '-0.055em',
            lineHeight: 0.96,
            marginBottom: 18,
            maxWidth: 820,
          }}
        >
          {headline}
          <br />
          <span style={{ color: palette.accent }}>without server-side secret exposure.</span>
        </div>

        <div
          style={{
            fontSize: 28,
            lineHeight: 1.38,
            color: '#d7dfed',
            maxWidth: 720,
            marginBottom: 30,
          }}
        >
          {subheadline}
          {' '}
          Agents request actions. Eligible nodes authenticate locally, decrypt locally, and execute over the tailnet.
        </div>

        <div style={{ display: 'flex', gap: 14, marginBottom: 22 }}>
          <Pill label="Passkey-backed local vault key" color={palette.green} />
          <Pill label="Scoped grants with TTL" color={palette.gold} />
          <Pill label="Trust-tier node selection" color={palette.cyan} />
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <CodeChip text="deriveVaultKeyFromPrf(prfOutput, prfSalt)" />
          <CodeChip text="provider: 'tailscale'" />
          <CodeChip text="request action, not secret" />
        </div>
      </div>

      <FigureCard
        title="System architecture"
        caption="Patent draft figure 1"
        src={staticFile('fig1-system-architecture.png')}
        frame={frame}
        start={heroStart}
        zoom={[1, 1.03]}
        style={{
          position: 'absolute',
          right: 84,
          top: 82,
          width: 800,
          height: 444,
          opacity: heroOpacity,
          transform: `translateX(${(1 - pop(frame, fps, sec(fps, 0.2))) * 120}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 26,
            right: 26,
            bottom: 24,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Pill label="Agent submits proxy request" color={palette.accent} style={{ fontSize: 15, padding: '10px 14px' }} />
          <Pill label="Trusted node authenticates locally" color={palette.green} style={{ fontSize: 15, padding: '10px 14px' }} />
          <Pill label="Server never sees reusable token" color={palette.violet} style={{ fontSize: 15, padding: '10px 14px' }} />
        </div>
      </FigureCard>

      <div
        style={{
          position: 'absolute',
          left: 84,
          top: 448,
          width: 824,
          height: 394,
          opacity: enrollOpacity,
          transform: `translateY(${(1 - pop(frame, fps, enrollStart)) * 34}px)`,
        }}
      >
        <FigureCard
          title="Enrollment and local encryption"
          caption="Patent draft figure 2"
          src={staticFile('fig2-enrollment-key-derivation.png')}
          frame={frame}
          start={enrollStart}
          zoom={[1, 1.04]}
          style={{ width: '100%', height: '100%' }}
        >
          <div
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: 22,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <CodeChip text="WebAuthn PRF -> HKDF -> AES-GCM key" />
            <CodeChip text="KEYCHAIN_STORAGE_KEY stores ciphertext only" />
          </div>
        </FigureCard>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 946,
          top: 560,
          width: 888,
          opacity: enrollOpacity,
        }}
      >
        <div
          style={{
            ...panelStyle,
            borderRadius: 28,
            padding: '26px 28px 22px',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: 20,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: palette.gold,
              marginBottom: 10,
            }}
          >
            Core principle
          </div>
          <div
            style={{
              fontSize: 48,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              marginBottom: 14,
            }}
          >
            The server coordinates access.
            <br />
            It does not perform reusable secret use.
          </div>
          <div
            style={{
              fontSize: 21,
              lineHeight: 1.45,
              color: '#d5deed',
            }}
          >
            Enrollment binds a passkey-backed credential, derives the vault key locally,
            encrypts locally, and uploads ciphertext plus metadata only.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {[
            'Passkey registration with user verification',
            'PRF output derives local vault key',
            'Local AES-GCM encryption before upload',
            'Server stores ciphertext, IV, salt, policy, audit refs',
          ].map((item, index) => {
            const reveal = pop(frame, fps, enrollStart + 8 + index * 4);
            return (
              <div
                key={item}
                style={{
                  ...panelStyle,
                  borderRadius: 20,
                  padding: '18px 18px 16px',
                  opacity: reveal,
                  transform: `translateY(${(1 - reveal) * 24}px)`,
                }}
              >
                <div style={{ display: 'flex', gap: 12 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background:
                        index < 2 ? `${palette.green}22` : `${palette.accent}22`,
                      color: index < 2 ? palette.green : palette.accent,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      flex: 'none',
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ fontSize: 18, lineHeight: 1.35, color: '#dbe4f0' }}>
                    {item}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          top: 204,
          opacity: tierOpacity,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 22,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 18,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: palette.cyan,
                marginBottom: 10,
              }}
            >
              Trust-tier policy
            </div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 800,
                lineHeight: 1.02,
                letterSpacing: '-0.04em',
              }}
            >
              Different nodes get different standing trust.
            </div>
          </div>
          <CodeChip text="eligible node = policy + scope + presence + availability" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {tiers.map((tier, index) => (
            <TierCard
              key={tier.tier}
              tier={tier.tier}
              title={tier.title}
              body={tier.body}
              accent={tier.accent}
              frame={frame}
              fps={fps}
              start={tierStart + index * 5}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 84,
          top: 154,
          width: 1084,
          height: 520,
          opacity: proxyOpacity,
          transform: `translateX(${(1 - pop(frame, fps, proxyStart)) * -46}px)`,
        }}
      >
        <FigureCard
          title="Proxy request sequence"
          caption="Patent draft figure 3"
          src={staticFile('fig3-proxy-sequence-flow.png')}
          frame={frame}
          start={proxyStart}
          zoom={[1, 1.03]}
          style={{ width: '100%', height: '100%' }}
        >
          <div
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: 24,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Pill label="Agent requests use (scope + purpose + TTL)" color={palette.accent} style={{ fontSize: 15, padding: '10px 14px' }} />
            <Pill label="Push + biometric approval" color={palette.green} style={{ fontSize: 15, padding: '10px 14px' }} />
            <Pill label="Grant returned, raw credential stays local" color={palette.violet} style={{ fontSize: 15, padding: '10px 14px' }} />
          </div>
        </FigureCard>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 84,
          top: 170,
          width: 590,
          opacity: proxyOpacity,
        }}
      >
        <div
          style={{
            ...panelStyle,
            borderRadius: 28,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: `1px solid ${palette.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: palette.muted,
              fontSize: 15,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 999, background: '#ff5f57' }} />
            <div style={{ width: 12, height: 12, borderRadius: 999, background: '#febc2e' }} />
            <div style={{ width: 12, height: 12, borderRadius: 999, background: '#28c840' }} />
            <div style={{ marginLeft: 8, fontFamily: mono }}>almostnode network runtime</div>
          </div>
          <div
            style={{
              padding: '18px 20px 20px',
              fontFamily: mono,
              fontSize: 24,
              lineHeight: 1.58,
              minHeight: 276,
            }}
          >
            {shellLines.map((line, index) => {
              const start = proxyStart + index * 8;
              const visible = fadeIn(frame, start, 8);
              return (
                <div
                  key={line}
                  style={{
                    opacity: visible,
                    color:
                      line.startsWith('$')
                        ? palette.green
                        : line.startsWith('result')
                          ? palette.gold
                          : '#dbe3ef',
                    minHeight: 34,
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            ...panelStyle,
            borderRadius: 24,
            padding: '22px 22px 18px',
          }}
        >
          <div
            style={{
              fontSize: 17,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: palette.gold,
              marginBottom: 12,
            }}
          >
            Implementation anchor
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.12,
              fontWeight: 700,
              marginBottom: 14,
            }}
          >
            The runtime already models Tailscale as a first-class network provider.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <CodeChip text="NetworkState: 'needs-login' | 'running' | 'locked'" />
            <CodeChip text="tailscale <status|login|logout>" />
            <CodeChip text="tailnet URLs route through the adapter" />
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 84,
          bottom: 154,
          width: 854,
          height: 412,
          opacity: boundaryOpacity,
          transform: `translateY(${(1 - pop(frame, fps, boundaryStart)) * 26}px)`,
        }}
      >
        <FigureCard
          title="Trust boundary"
          caption="Patent draft figure 4"
          src={staticFile('fig4-security-trust-boundary.png')}
          frame={frame}
          start={boundaryStart}
          zoom={[1, 1.02]}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          right: 84,
          bottom: 154,
          width: 854,
          height: 412,
          opacity: boundaryOpacity,
          transform: `translateY(${(1 - pop(frame, fps, boundaryStart + 6)) * 26}px)`,
        }}
      >
        <FigureCard
          title="Grant lifecycle and revocation"
          caption="Patent draft figure 5"
          src={staticFile('fig5-grant-lifecycle-state-machine.png')}
          frame={frame}
          start={boundaryStart + 6}
          zoom={[1, 1.02]}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          bottom: 34,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          opacity: boundaryOpacity,
        }}
      >
        {coreClaims.map((claim, index) => {
          const reveal = pop(frame, fps, boundaryStart + 6 + index * 3);
          return (
            <div
              key={claim}
              style={{
                ...panelStyle,
                borderRadius: 18,
                padding: '16px 18px',
                opacity: reveal,
                transform: `translateY(${(1 - reveal) * 18}px)`,
                fontSize: 18,
                lineHeight: 1.38,
                color: '#d8e1ef',
              }}
            >
              {claim}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          bottom: 44,
          opacity: outroOpacity,
          transform: `translateY(${(1 - clamp(outroOpacity)) * 22}px)`,
        }}
      >
        <div
          style={{
            ...panelStyle,
            borderRadius: 32,
            padding: '26px 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background:
              'linear-gradient(135deg, rgba(255, 122, 89, 0.2), rgba(255, 195, 82, 0.14), rgba(93, 213, 255, 0.1))',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 18,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: palette.gold,
                marginBottom: 10,
              }}
            >
              Auth strategy
            </div>
            <div
              style={{
                fontSize: 62,
                lineHeight: 0.98,
                fontWeight: 800,
                letterSpacing: '-0.045em',
              }}
            >
              Server stores ciphertext.
              <br />
              Trusted nodes execute the action.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <CodeChip text={siteUrl} />
            <Pill label="Passkeys + tailnet + scoped grants" color={palette.green} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
