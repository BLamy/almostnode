/**
 * SVG displacement filters for real liquid-glass refraction. Referenced from
 * CSS via `backdrop-filter: url(#liquid-glass)`, so they warp the *backdrop*
 * (wallpaper / windows behind the panel) rather than the panel's own content —
 * no layout impact on children. Mounted once at the desktop root.
 *
 * feTurbulence makes a smooth low-frequency noise field; feDisplacementMap bends
 * the backdrop's pixels along that field (R→x, G→y). Higher `scale` = stronger
 * refraction. Kept static — animating the field would recompute a full-screen
 * displacement every frame.
 */
export function LiquidGlassFilters() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {/* Strong panel refraction (chat drawer). */}
        <filter
          id="liquid-glass"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.0035 0.004"
            numOctaves="1"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="0.7" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="22"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Subtler refraction for window chrome. */}
        <filter
          id="liquid-glass-soft"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.005 0.006"
            numOctaves="1"
            seed="4"
            result="noise2"
          />
          <feGaussianBlur in="noise2" stdDeviation="0.6" result="softNoise2" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise2"
            scale="8"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
