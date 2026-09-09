import type { Config } from 'tailwindcss';

/**
 * Colours come from CSS variables so the theme can be swapped at runtime.
 * Channels rather than hex, so Tailwind's alpha modifiers (bg-card/60) still
 * work.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        card: token('card'),
        ink: token('ink'),
        muted: token('muted'),
        line: token('line'),
        heart: token('heart'),
        skin: token('skin'),
        motion: token('motion'),
        sleep: token('sleep'),
        oxygen: token('oxygen'),
        alarm: token('alarm'),
      },
      fontFamily: {
        sans: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '24px',
        pill: '999px',
      },
      boxShadow: {
        soft: '0 2px 16px rgb(var(--shadow) / 0.06)',
        lift: '0 8px 28px rgb(var(--shadow) / 0.10)',
      },
    },
  },
  plugins: [],
};

export default config;
