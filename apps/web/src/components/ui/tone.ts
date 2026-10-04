/**
 * Every accent the kit draws with. Tailwind needs the class names written
 * out in full to keep them; `color` is for SVG and inline styles, where
 * CSS variables only work through `style`.
 */
export type Tone = 'heart' | 'oxygen' | 'stress' | 'sleep' | 'motion' | 'skin' | 'primary' | 'good' | 'alarm' | 'muted';

export const TONE: Record<Tone, { text: string; soft: string; color: string }> = {
  heart: { text: 'text-heart', soft: 'bg-heart/15', color: 'rgb(var(--heart))' },
  oxygen: { text: 'text-oxygen', soft: 'bg-oxygen/15', color: 'rgb(var(--oxygen))' },
  stress: { text: 'text-stress', soft: 'bg-stress/15', color: 'rgb(var(--stress))' },
  sleep: { text: 'text-sleep', soft: 'bg-sleep/15', color: 'rgb(var(--sleep))' },
  motion: { text: 'text-motion', soft: 'bg-motion/15', color: 'rgb(var(--motion))' },
  skin: { text: 'text-skin', soft: 'bg-skin/15', color: 'rgb(var(--skin))' },
  primary: { text: 'text-primary', soft: 'bg-primary/15', color: 'rgb(var(--primary))' },
  good: { text: 'text-good', soft: 'bg-good/15', color: 'rgb(var(--good))' },
  alarm: { text: 'text-alarm', soft: 'bg-alarm/15', color: 'rgb(var(--alarm))' },
  muted: { text: 'text-muted', soft: 'bg-muted/15', color: 'rgb(var(--muted))' },
};
