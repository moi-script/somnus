const PILL = {
  good: 'bg-good/15 text-good',
  warn: 'bg-skin/15 text-skin',
  bad: 'bg-alarm/15 text-alarm',
  idle: 'bg-muted/15 text-muted',
} as const;

export function StatusPill({
  tone,
  label,
  dot = true,
}: {
  tone: keyof typeof PILL;
  label: string;
  dot?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${PILL[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {label}
    </span>
  );
}
