/**
 * Hand-drawn icon set.
 *
 * Inline SVG rather than an icon package: this bundle ships inside the APK,
 * and a dozen paths cost less than a dependency.
 */
interface IconProps {
  className?: string;
  strokeWidth?: number;
}

const base = 'h-6 w-6';

function Svg({
  children,
  className,
  strokeWidth = 1.7,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function HeartIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20s-7-4.6-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.4 12 20 12 20Z" />
    </Svg>
  );
}

export function PulseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12h3l2-5 3 10 2.5-6 1.5 3h6" />
    </Svg>
  );
}

export function DropIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5s5.5 5.6 5.5 9.4a5.5 5.5 0 0 1-11 0C6.5 9.1 12 3.5 12 3.5Z" />
    </Svg>
  );
}

export function StepsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 20v-3.5a3 3 0 0 1 .6-1.8l.6-.8a3 3 0 0 0 .6-1.8V6.8A1.8 1.8 0 0 1 9.6 5c1 0 1.8.8 1.8 1.8V12" />
      <path d="M14 20v-2.6a3 3 0 0 1 .6-1.8l.5-.7a3 3 0 0 0 .6-1.8v-3.4a1.8 1.8 0 0 1 3.6 0v5" />
    </Svg>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2Z" />
    </Svg>
  );
}

export function ThermometerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z" />
      <path d="M12 17.5v-3" />
    </Svg>
  );
}

export function SparkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 13.7 9l5.3 1.8-5.3 1.9L12 18l-1.7-5.3L5 10.8 10.3 9 12 3.5Z" />
    </Svg>
  );
}

export function BluetoothIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m7.5 8 9 8-4.5 4V4l4.5 4-9 8" />
    </Svg>
  );
}

export function RunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="15" cy="5" r="1.6" />
      <path d="m8 21 2.5-5 3-2.2-1.5-4L9 12l-3 .8" />
      <path d="m13.5 13.8 3 2.2 1 5" />
      <path d="m12 10.8 3.5-1.4 3 1.6" />
    </Svg>
  );
}

export function ChipIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
      <path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" />
    </Svg>
  );
}

export function PersonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

export function ChevronIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  );
}

export function TargetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function PaletteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20a8 8 0 1 1 8-8c0 2-1.6 2.6-3 2.6h-1.4a1.8 1.8 0 0 0-1.2 3.1c.4.5.2 1.3-.6 1.5a8 8 0 0 1-1.8.2Z" />
      <circle cx="8.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function HelpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.8 9.6a2.2 2.2 0 1 1 2.9 2.1c-.5.2-.7.6-.7 1.1v.5" />
      <circle cx="12" cy="16.4" r="0.7" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function MailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="m4.5 8 7.5 5 7.5-5" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8.2" r="0.7" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7L11 7.3" />
      <path d="M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </Svg>
  );
}
