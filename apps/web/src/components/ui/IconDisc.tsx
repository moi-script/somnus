import type { ReactNode } from 'react';
import { TONE, type Tone } from './tone';

export function IconDisc({ icon, tone, size = 'h-10 w-10' }: { icon: ReactNode; tone: Tone; size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-2xl ${TONE[tone].soft} ${TONE[tone].text}`}>
      {icon}
    </span>
  );
}
