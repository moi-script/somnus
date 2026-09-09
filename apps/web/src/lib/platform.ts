/**
 * One UI, two shells.
 *
 * The same build is served as a website and packaged as the Capacitor webview,
 * so screens that only make sense on the phone - BLE scanning, the local
 * buffer - are revealed at runtime rather than built into a separate app.
 *
 * Capacitor injects window.Capacitor before the bundle runs; on the web it is
 * simply absent.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() ?? false;
}

export function platformName(): 'android' | 'ios' | 'web' {
  const name = capacitor()?.getPlatform?.();
  if (name === 'android' || name === 'ios') return name;
  return 'web';
}
