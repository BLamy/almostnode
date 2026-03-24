export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--surface-foreground))',
        },
        'chart-1': 'hsl(var(--chart-1))',
        'chart-2': 'hsl(var(--chart-2))',
        'chart-3': 'hsl(var(--chart-3))',
        'chart-4': 'hsl(var(--chart-4))',
        'chart-5': 'hsl(var(--chart-5))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', 'monospace'],
      },
      fontSize: {
        display: ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'title-1': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
        'title-2': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        'title-3': ['1.25rem', { lineHeight: '1.4', letterSpacing: '-0.005em' }],
        'body-lg': ['1.125rem', { lineHeight: '1.6' }],
        body: ['1rem', { lineHeight: '1.6' }],
        'body-sm': ['0.875rem', { lineHeight: '1.5' }],
        caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        overline: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      },
      spacing: {
        section: '5rem',
        card: '2rem',
        'card-sm': '1.25rem',
        gutter: '1.5rem',
      },
      transitionTimingFunction: {
        'out-quad': 'var(--ease-out-quad)',
        'out-cubic': 'var(--ease-out-cubic)',
        'out-quart': 'var(--ease-out-quart)',
        'out-quint': 'var(--ease-out-quint)',
        'out-expo': 'var(--ease-out-expo)',
        'out-circ': 'var(--ease-out-circ)',
        'in-out-quad': 'var(--ease-in-out-quad)',
        'in-out-cubic': 'var(--ease-in-out-cubic)',
        'in-out-quart': 'var(--ease-in-out-quart)',
        'in-out-quint': 'var(--ease-in-out-quint)',
        'in-out-expo': 'var(--ease-in-out-expo)',
        'in-out-circ': 'var(--ease-in-out-circ)',
      },
      transitionDuration: {
        micro: 'var(--duration-micro)',
        fast: 'var(--duration-fast)',
        standard: 'var(--duration-standard)',
        modal: 'var(--duration-modal)',
        slow: 'var(--duration-slow)',
        exit: 'var(--duration-exit)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'scale-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.95)' },
        },
        'slide-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-out-down': {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(8px)' },
        },
        'slide-out-up': {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--duration-standard) var(--ease-out-quart)',
        'fade-out': 'fade-out var(--duration-exit) var(--ease-out-quart)',
        'scale-in': 'scale-in var(--duration-standard) var(--ease-out-quart)',
        'scale-out': 'scale-out var(--duration-exit) var(--ease-out-quart)',
        'slide-in-up': 'slide-in-up var(--duration-standard) var(--ease-out-quart)',
        'slide-in-down': 'slide-in-down var(--duration-standard) var(--ease-out-quart)',
        'slide-in-left': 'slide-in-left var(--duration-standard) var(--ease-out-quart)',
        'slide-in-right': 'slide-in-right var(--duration-standard) var(--ease-out-quart)',
        'slide-out-down': 'slide-out-down var(--duration-exit) var(--ease-out-quart)',
        'slide-out-up': 'slide-out-up var(--duration-exit) var(--ease-out-quart)',
      },
    },
  },
};
