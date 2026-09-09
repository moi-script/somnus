import type { Config } from 'tailwindcss';

/**
 * Instrument palette. Channel hues are identity, not decoration: pulse is
 * always coral, skin always amber, motion always teal - in traces, badges,
 * event rows and readouts alike, so a colour alone tells you the channel.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: '#06121A',
        panel: '#0C1D26',
        rule: '#17323D',
        ink: '#DCEAF0',
        muted: '#7D9AA6',
        pulse: '#FF5470',
        skin: '#FFC24B',
        motion: '#4FD6C8',
        alarm: '#FF3B3B',
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '3px',
      },
    },
  },
  plugins: [],
};

export default config;
