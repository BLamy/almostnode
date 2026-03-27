import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type AuthStrategyWithImagesProps = {
  headline: string;
  siteUrl: string;
  paceMultiplier: number;
};

const palette = {
  bg: '#061019',
  bgAlt: '#0f1d2d',
  text: '#eff5ff',
  muted: '#97abc7',
  blue: '#3f8de8',
  orange: '#ff9a2b',
  green: '#49c27c',
  violet: '#7567ff',
  gold: '#ffc352',
  border: 'rgba(255, 255, 255, 0.1)',
  panel: 'rgba(10, 17, 28, 0.84)',
  panelSoft: 'rgba(255, 255, 255, 0.05)',
};

const sans = 'Instrument Sans, Inter, ui-sans-serif, system-ui, sans-serif';
const mono = 'IBM Plex Mono, Menlo, monospace';

const sec = (fps: number, seconds: number) => Math.floor(fps * seconds);

const shellStyle: CSSProperties = {
  background: palette.panel,
  border: `1px solid ${palette.border}`,
  boxShadow: '0 30px 80px rgba(0, 0, 0, 0.32)',
  backdropFilter: 'blur(18px)',
};

const stageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  fontFamily: sans,
  color: palette.text,
};

type SlideSceneProps = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  image: string;
  accent: string;
  paceMultiplier: number;
  align?: 'left' | 'right';
  footer?: string;
  kicker?: string;
  imageNote?: string;
  imageOverlay?: ReactNode;
};

const SceneBackdrop = ({
  accent,
  paceMultiplier,
}: {
  accent: string;
  paceMultiplier: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pacedFrame = frame / paceMultiplier;
  const enter = spring({
    fps,
    frame: pacedFrame,
    config: {
      stiffness: 150,
      damping: 18,
      mass: 0.8,
    },
  });
  const sweep = interpolate(pacedFrame, [0, 120], [180, -260], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={stageStyle}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${palette.bg} 0%, ${palette.bgAlt} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
          backgroundSize: '112px 112px',
          opacity: 0.14,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -220 + interpolate(pacedFrame, [0, 150], [0, 120], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          top: -220,
          width: 720,
          height: 720,
          borderRadius: 999,
          background: `radial-gradient(circle, ${accent}33 0%, ${accent}10 34%, transparent 72%)`,
          filter: 'blur(28px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -120,
          top: 160,
          width: 540,
          height: 540,
          borderRadius: 999,
          background: `radial-gradient(circle, ${accent}25 0%, ${accent}08 42%, transparent 75%)`,
          filter: 'blur(30px)',
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: sweep,
          top: 0,
          width: 380,
          height: '100%',
          transform: 'skewX(-18deg)',
          background:
            'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent)',
          opacity: 0.12 * enter,
        }}
      />
    </AbsoluteFill>
  );
};

const ImageCard = ({
  image,
  accent,
  direction,
  paceMultiplier,
  note,
  overlay,
}: {
  image: string;
  accent: string;
  direction: 'left' | 'right';
  paceMultiplier: number;
  note?: string;
  overlay?: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pacedFrame = frame / paceMultiplier;
  const reveal = spring({
    fps,
    frame: pacedFrame,
    config: {
      stiffness: 155,
      damping: 18,
      mass: 0.85,
    },
  });
  const drift = interpolate(pacedFrame, [0, 150], [direction === 'left' ? -18 : 18, 8], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = interpolate(pacedFrame, [0, 150], [1, 1.045], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        ...shellStyle,
        position: 'relative',
        width: 1020,
        height: 640,
        borderRadius: 34,
        overflow: 'hidden',
        background: '#f8fbff',
        opacity: reveal,
        transform: `translateX(${(1 - reveal) * (direction === 'left' ? -80 : 80)}px) scale(${0.94 + reveal * 0.06})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: `1px solid ${accent}33`,
          borderRadius: 34,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateX(${drift}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <Img
          src={staticFile(image)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
        {overlay}
      </div>
      {note ? (
        <div
          style={{
            ...shellStyle,
            position: 'absolute',
            left: 22,
            right: 22,
            bottom: 22,
            padding: '14px 16px',
            borderRadius: 18,
            background: 'rgba(6, 16, 25, 0.86)',
            color: palette.text,
            fontSize: 18,
            lineHeight: 1.35,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};

const SlideScene = ({
  eyebrow,
  title,
  description,
  bullets,
  image,
  accent,
  paceMultiplier,
  align = 'right',
  footer,
  kicker,
  imageNote,
  imageOverlay,
}: SlideSceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pacedFrame = frame / paceMultiplier;
  const textReveal = spring({
    fps,
    frame: pacedFrame,
    config: {
      stiffness: 165,
      damping: 20,
      mass: 0.8,
    },
  });

  const copyBlock = (
    <div
      style={{
        width: 560,
        opacity: textReveal,
        transform: `translateY(${(1 - textReveal) * 26}px)`,
      }}
    >
      <div
        style={{
          fontSize: 18,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: accent,
          marginBottom: 16,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontSize: 72,
          lineHeight: 0.96,
          fontWeight: 800,
          letterSpacing: '-0.05em',
          marginBottom: 18,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 28,
          lineHeight: 1.36,
          color: '#d8e1ef',
          marginBottom: 26,
        }}
      >
        {description}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {bullets.map((bullet, index) => {
          const reveal = spring({
            fps,
            frame: pacedFrame - 5 - index * 4,
            config: {
              stiffness: 180,
              damping: 22,
              mass: 0.85,
            },
          });
          return (
            <div
              key={bullet}
              style={{
                ...shellStyle,
                borderRadius: 18,
                padding: '15px 18px',
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                opacity: reveal,
                transform: `translateX(${(1 - reveal) * -18}px)`,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: accent,
                  boxShadow: `0 0 16px ${accent}`,
                  marginTop: 7,
                  flex: 'none',
                }}
              />
              <div style={{ fontSize: 20, lineHeight: 1.35, color: '#e4ebf7' }}>
                {bullet}
              </div>
            </div>
          );
        })}
      </div>
      {footer ? (
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 18,
            background: `${accent}14`,
            border: `1px solid ${accent}33`,
            color: palette.text,
            fontSize: 20,
            lineHeight: 1.35,
          }}
        >
          {footer}
        </div>
      ) : null}
      {kicker ? (
        <div
          style={{
            marginTop: 18,
            fontFamily: mono,
            fontSize: 18,
            color: palette.muted,
          }}
        >
          {kicker}
        </div>
      ) : null}
    </div>
  );

  return (
    <AbsoluteFill style={stageStyle}>
      <SceneBackdrop accent={accent} paceMultiplier={paceMultiplier} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '120px 96px 96px',
          gap: 48,
        }}
      >
        {align === 'left' ? (
          <>
            <ImageCard
              image={image}
              accent={accent}
              direction="left"
              paceMultiplier={paceMultiplier}
              note={imageNote}
              overlay={imageOverlay}
            />
            {copyBlock}
          </>
        ) : (
          <>
            {copyBlock}
            <ImageCard
              image={image}
              accent={accent}
              direction="right"
              paceMultiplier={paceMultiplier}
              note={imageNote}
              overlay={imageOverlay}
            />
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};

const PlayersArrowCorrection = () => {
  const labelStyle: CSSProperties = {
    fill: '#2868b7',
    fontFamily: mono,
    fontSize: 16,
    fontWeight: 600,
  };

  return (
    <svg
      viewBox="0 0 1020 640"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      <rect x="291" y="290" width="98" height="74" rx="18" fill="#f8fbff" />
      <rect x="584" y="281" width="112" height="96" rx="18" fill="#f8fbff" />

      <rect x="599" y="286" width="58" height="24" rx="12" fill="#f8fbff" />
      <text x="629" y="303" textAnchor="middle" style={labelStyle}>
        push
      </text>
      <line x1="648" y1="320" x2="606" y2="320" stroke="#ff9a2b" strokeWidth="4" />
      <polygon points="606,320 616,314 616,326" fill="#ff9a2b" />

      <rect x="581" y="330" width="90" height="24" rx="12" fill="#f8fbff" />
      <text x="628" y="347" textAnchor="middle" style={labelStyle}>
        asserts
      </text>
      <line x1="606" y1="338" x2="648" y2="338" stroke="#2868b7" strokeWidth="4" />
      <polygon points="648,338 638,332 638,344" fill="#2868b7" />
    </svg>
  );
};

const HeroScene = ({
  headline,
  siteUrl,
  paceMultiplier,
}: AuthStrategyWithImagesProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pacedFrame = frame / paceMultiplier;
  const reveal = spring({
    fps,
    frame: pacedFrame,
    config: {
      stiffness: 170,
      damping: 20,
      mass: 0.82,
    },
  });

  return (
    <AbsoluteFill style={stageStyle}>
      <SceneBackdrop accent={palette.blue} paceMultiplier={paceMultiplier} />
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 94,
          width: 700,
          opacity: reveal,
          transform: `translateY(${(1 - reveal) * 28}px)`,
        }}
      >
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
            marginBottom: 22,
          }}
        >
          WebAuthn diagrams + auth strategy
        </div>
        <div
          style={{
            fontSize: 100,
            lineHeight: 0.94,
            fontWeight: 800,
            letterSpacing: '-0.055em',
            marginBottom: 18,
          }}
        >
          {headline}
          <br />
          <span style={{ color: palette.orange }}>through the actual trust model.</span>
        </div>
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.38,
            color: '#d9e2f0',
            marginBottom: 26,
          }}
        >
          The server keeps the encrypted vault. The user unlocks their private
          passkey manager, and that synced keychain can answer from any approved
          device when a push arrives.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            'Server stores ciphertext only',
            'User-owned passkey manager',
            'Synced across approved devices',
            'Push + biometric gates action',
            'Grant is scoped and expires',
          ].map((chip, index) => {
            const chipReveal = spring({
              fps,
              frame: pacedFrame - 4 - index * 4,
              config: {
                stiffness: 185,
                damping: 24,
                mass: 0.8,
              },
            });
            return (
              <div
                key={chip}
                style={{
                  ...shellStyle,
                  padding: '14px 16px',
                  borderRadius: 999,
                  fontSize: 19,
                  color: palette.text,
                  opacity: chipReveal,
                  transform: `translateY(${(1 - chipReveal) * 14}px)`,
                }}
              >
                {chip}
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: mono,
            fontSize: 20,
            color: palette.gold,
          }}
        >
          {siteUrl}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 96,
          top: 90,
        }}
      >
        <ImageCard
          image="webauthn-big-idea.png"
          accent={palette.blue}
          direction="right"
          paceMultiplier={paceMultiplier}
        />
      </div>
    </AbsoluteFill>
  );
};

const OutroScene = ({ paceMultiplier }: { paceMultiplier: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pacedFrame = frame / paceMultiplier;
  const reveal = spring({
    fps,
    frame: pacedFrame,
    config: {
      stiffness: 165,
      damping: 18,
      mass: 0.84,
    },
  });

  const thumbs = [
    'webauthn-players.png',
    'webauthn-enrollment.png',
    'webauthn-auth-flow.png',
    'webauthn-why-secure.png',
  ];

  return (
    <AbsoluteFill style={stageStyle}>
      <SceneBackdrop accent={palette.green} paceMultiplier={paceMultiplier} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '94px 96px 88px',
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: palette.green,
            marginBottom: 16,
            opacity: reveal,
          }}
        >
          Security by design
        </div>
        <div
          style={{
            fontSize: 84,
            lineHeight: 0.95,
            fontWeight: 800,
            letterSpacing: '-0.05em',
            maxWidth: 1180,
            marginBottom: 22,
            opacity: reveal,
            transform: `translateY(${(1 - reveal) * 22}px)`,
          }}
        >
          No single party can act alone.
        </div>
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.36,
            color: '#d6dfed',
            maxWidth: 980,
            marginBottom: 34,
            opacity: reveal,
          }}
        >
          That is the point of the auth strategy: split trust, keep the keychain
          under the user’s private passkey provider, let any approved device answer
          a push, and still force each high-value action through a fresh proof path.
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
            marginBottom: 26,
          }}
        >
          {thumbs.map((thumb, index) => {
            const thumbReveal = spring({
              fps,
              frame: pacedFrame - 4 - index * 3,
              config: {
                stiffness: 190,
                damping: 22,
                mass: 0.8,
              },
            });
            return (
              <div
                key={thumb}
                style={{
                  ...shellStyle,
                  borderRadius: 24,
                  overflow: 'hidden',
                  background: '#f8fbff',
                  opacity: thumbReveal,
                  transform: `translateY(${(1 - thumbReveal) * 24}px)`,
                }}
              >
                <Img
                  src={staticFile(thumb)}
                  style={{
                    width: '100%',
                    height: 210,
                    objectFit: 'contain',
                    background: '#f8fbff',
                  }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            'Encrypted blob on server',
            'User-owned synced keychain',
            'Any approved device can answer',
            'Push request for each action',
            'Short-lived grant tokens',
            'Agent must re-request after expiry',
          ].map((chip, index) => {
            const chipReveal = spring({
              fps,
              frame: pacedFrame - 8 - index * 3,
              config: {
                stiffness: 180,
                damping: 24,
                mass: 0.8,
              },
            });
            return (
              <div
                key={chip}
                style={{
                  ...shellStyle,
                  padding: '14px 16px',
                  borderRadius: 999,
                  fontSize: 19,
                  color: palette.text,
                  opacity: chipReveal,
                  transform: `translateY(${(1 - chipReveal) * 16}px)`,
                }}
              >
                {chip}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const AuthStrategyWithImages = ({
  headline,
  siteUrl,
  paceMultiplier,
}: AuthStrategyWithImagesProps) => {
  const { fps } = useVideoConfig();
  const pace = Math.max(1, paceMultiplier);
  const dur = (seconds: number) => sec(fps, seconds * pace);

  const heroDuration = dur(2);
  const playersDuration = dur(2);
  const bigIdeaDuration = dur(2);
  const enrollmentDuration = dur(2.5);
  const authFlowDuration = dur(2.5);
  const architectureDuration = dur(2);
  const secureDuration = dur(2);
  const outroDuration = dur(2);

  return (
    <AbsoluteFill style={stageStyle}>
      <Sequence from={0} durationInFrames={heroDuration} premountFor={fps}>
        <HeroScene headline={headline} siteUrl={siteUrl} paceMultiplier={pace} />
      </Sequence>
      <Sequence from={heroDuration} durationInFrames={playersDuration} premountFor={fps}>
        <SlideScene
          eyebrow="Meet the players"
          title="Three actors. The user-owned keychain spans devices."
          description="The user approves the action, their private passkey manager keeps the synced credential set, and the server enclave releases narrow grants only after a valid assertion."
          bullets={[
            'The user interacts with their own passkey manager, such as Apple Passwords or 1Password.',
            'That private keychain is synced across their approved devices, so any of them can answer the push.',
            'The server enclave stores encrypted secrets and issues short-lived grants only after verification.',
          ]}
          image="webauthn-players.png"
          accent={palette.blue}
          paceMultiplier={pace}
          align="right"
          imageNote="Practical model: the “trusted device” box is the user’s private passkey provider and synced keychain, not one permanently special phone."
          imageOverlay={<PlayersArrowCorrection />}
          footer="Trust is split on purpose: user presence, synced credential custody, and server coordination stay separate."
        />
      </Sequence>
      <Sequence
        from={heroDuration + playersDuration}
        durationInFrames={bigIdeaDuration}
        premountFor={fps}
      >
        <SlideScene
          eyebrow="The big idea"
          title="Server holds vault. The user’s synced keychain unlocks it."
          description="The encrypted blob can sit on the server, but the vault only opens when the user unlocks their passkey manager on one of their approved devices."
          bullets={[
            'The server can verify assertions, send pushes, and release scoped grants.',
            'The passkey manager syncs the credential set across the user’s devices.',
            'Any enrolled device can unlock locally, derive the needed key material, and approve the action.',
          ]}
          image="webauthn-big-idea.png"
          accent={palette.orange}
          paceMultiplier={pace}
          align="left"
          kicker="The synced keychain is the bridge."
        />
      </Sequence>
      <Sequence
        from={heroDuration + playersDuration + bigIdeaDuration}
        durationInFrames={enrollmentDuration}
        premountFor={fps}
      >
        <SlideScene
          eyebrow="Enrollment"
          title="Enrollment binds the vault to the user’s synced credential set."
          description="Registration creates the passkey, user verification unlocks the provider, the key material is derived locally, and only ciphertext is uploaded."
          bullets={[
            'WebAuthn registration requires user verification inside the user’s passkey provider.',
            'The resulting keychain is synced to the user’s approved devices.',
            'Local cryptography happens only after a responding device unlocks that provider.',
            'After setup, auth repeats as request -> push -> unlock -> grant -> expiry.',
          ]}
          image="webauthn-enrollment.png"
          accent={palette.green}
          paceMultiplier={pace}
          align="right"
          footer="Enrollment gives device portability without giving the server standing access."
        />
      </Sequence>
      <Sequence
        from={heroDuration + playersDuration + bigIdeaDuration + enrollmentDuration}
        durationInFrames={authFlowDuration}
        premountFor={fps}
      >
        <SlideScene
          eyebrow="Per-action auth"
          title="A push can be answered from any synced device."
          description="Every high-value action re-opens the proof path: the server sends a push, the user taps it on any approved device, the passkey manager unlocks locally, and a scoped grant is issued."
          bullets={[
            'The request is explicit, not ambient. Something needs auth first.',
            'The responding device does not need to be the original enrolling device; it just needs the synced keychain.',
            'The grant is scoped to the requested resource and expires quickly.',
            'Each new action requires a new push plus local unlock.',
          ]}
          image="webauthn-auth-flow.png"
          accent={palette.orange}
          paceMultiplier={pace}
          align="left"
          footer="Any synced device can satisfy the proof, but none get standing access."
        />
      </Sequence>
      <Sequence
        from={
          heroDuration
          + playersDuration
          + bigIdeaDuration
          + enrollmentDuration
          + authFlowDuration
        }
        durationInFrames={architectureDuration}
        premountFor={fps}
      >
        <SlideScene
          eyebrow="End-to-end architecture"
          title="The whole path stays narrow."
          description="Agent, server enclave, push service, passkey provider, responding device, and user each participate in sequence, so grants stay scoped and secrets never become ambient server state."
          bullets={[
            'The agent asks for auth because it needs to act.',
            'The server enclave coordinates but never decrypts.',
            'The user’s passkey provider and responding device return a signed assertion, not the private key.',
            'The grant is just enough for the requested API call and then it expires.',
          ]}
          image="webauthn-full-architecture.png"
          accent={palette.violet}
          paceMultiplier={pace}
          align="right"
          footer="This is why the architecture reads like a choreography, not a login screen."
        />
      </Sequence>
      <Sequence
        from={
          heroDuration
          + playersDuration
          + bigIdeaDuration
          + enrollmentDuration
          + authFlowDuration
          + architectureDuration
        }
        durationInFrames={secureDuration}
        premountFor={fps}
      >
        <SlideScene
          eyebrow="Why it holds"
          title="Each party knows only part of the story."
          description="Security comes from capability partitioning: the agent can use grants, the server can coordinate, and the user’s passkey provider can prove presence on an approved device. None of them can do the whole job alone."
          bullets={[
            'The agent cannot see decrypted secrets or bypass the local unlock step.',
            'The server cannot derive the vault key or access the user’s synced keychain.',
            'A synced device can answer the push, but only with fresh user presence and short-lived grants.',
          ]}
          image="webauthn-why-secure.png"
          accent={palette.green}
          paceMultiplier={pace}
          align="left"
          footer="Together: no single party can act alone."
        />
      </Sequence>
      <Sequence
        from={
          heroDuration
          + playersDuration
          + bigIdeaDuration
          + enrollmentDuration
          + authFlowDuration
          + architectureDuration
          + secureDuration
        }
        durationInFrames={outroDuration}
        premountFor={fps}
      >
        <OutroScene paceMultiplier={pace} />
      </Sequence>
    </AbsoluteFill>
  );
};
