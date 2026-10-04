const MB = 1024 * 1024;

/** "Downloading 12 / 19 MB" while the in-app update downloads. */
export function downloadLabel(received: number, total: number): string {
  if (received <= 0) return 'Starting the download…';
  const got = Math.round(received / MB);
  return total > 0 ? `Downloading ${got} / ${Math.round(total / MB)} MB` : `Downloading ${got} MB`;
}

/**
 * Words for a failed update. Which step failed matters more than the
 * plugin's message: the fix is different (connection vs Android setting).
 */
export function updateErrorText(step: 'download' | 'install', _err: unknown): string {
  return step === 'download'
    ? 'The download did not finish. Check the internet connection and try again.'
    : 'The installer did not open. Allow Somnus to install apps in Android settings, or download it in the browser.';
}
