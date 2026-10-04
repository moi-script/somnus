import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronIcon } from '../Icons';
import { IconDisc } from './IconDisc';
import type { Tone } from './tone';

export function ListRow({
  icon,
  tone = 'primary',
  title,
  subtitle,
  href,
  onClick,
  right,
}: {
  icon: ReactNode;
  tone?: Tone;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  right?: ReactNode;
}) {
  const body = (
    <>
      <IconDisc icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="block truncate text-sm text-muted">{subtitle}</span>}
      </span>
      {right}
      {(href || onClick) && <ChevronIcon className="h-5 w-5 shrink-0 text-muted" />}
    </>
  );
  const cls = 'flex w-full items-center gap-3 px-4 py-3 text-left';
  if (href) return <Link href={href} className={`${cls} hover:bg-canvas/50`}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} hover:bg-canvas/50`}>{body}</button>;
  return <div className={cls}>{body}</div>;
}
