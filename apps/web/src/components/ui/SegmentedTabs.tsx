export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  activeClass = 'bg-primary text-white shadow-glow',
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  activeClass?: string;
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-2xl border border-line bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
            t.id === active ? activeClass : 'text-muted hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Two-way switch such as Manual / Adaptive Radar; the chosen side glows green. */
export function SegmentedToggle<T extends string>(props: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return <SegmentedTabs {...props} activeClass="bg-good text-canvas shadow-glow" />;
}
