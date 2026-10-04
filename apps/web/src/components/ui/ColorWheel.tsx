'use client';

import { useRef } from 'react';
import { hueSatToWheel, wheelToHueSat } from '@/lib/levels';

/**
 * Hue round the edge (red at the top, clockwise), white in the middle.
 * `onChange` follows the finger for the preview; only `onCommit`, on release,
 * should send anything to the bulb. `touch-none` keeps a drag from scrolling.
 */
export function ColorWheel({
  hue,
  sat,
  size = 208,
  onChange,
  onCommit,
}: {
  hue: number;
  sat: number;
  size?: number;
  onChange: (h: number, s: number) => void;
  onCommit: (h: number, s: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pick = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const r = rect.width / 2;
    return wheelToHueSat(e.clientX - rect.left - r, e.clientY - rect.top - r, r);
  };
  const marker = hueSatToWheel(hue, sat, size / 2);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Colour"
      aria-valuenow={hue}
      aria-valuetext={`Hue ${hue}, saturation ${sat}%`}
      tabIndex={0}
      className="relative mx-auto touch-none select-none rounded-full"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle closest-side, #fff, rgba(255,255,255,0)), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pick(e);
        onChange(p.h, p.s);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const p = pick(e);
        onChange(p.h, p.s);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        const p = pick(e);
        onCommit(p.h, p.s);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span
        className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lift"
        style={{ left: size / 2 + marker.x, top: size / 2 + marker.y, background: `hsl(${hue} ${sat}% 50%)` }}
      />
    </div>
  );
}
