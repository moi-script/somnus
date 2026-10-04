/**
 * Downloads the new APK inside the app and opens Android's installer on it.
 *
 * Loaded dynamically: the plugins only exist inside the Capacitor shell.
 * Throws an InstallStepError saying which step failed, so the banner can
 * point at the right fix.
 */

const FILE = 'somnus-update.apk';

export class InstallStepError extends Error {
  constructor(
    readonly step: 'download' | 'install',
    readonly cause: unknown,
  ) {
    super(`${step} failed`);
  }
}

export async function downloadAndInstall(
  url: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  const { FileOpener } = await import('@capacitor-community/file-opener');

  let path: string;
  const listener = await Filesystem.addListener('progress', (p) => onProgress(p.bytes, p.contentLength));
  try {
    const result = await Filesystem.downloadFile({
      url,
      path: FILE,
      directory: Directory.Cache,
      progress: true,
      recursive: true,
    });
    path = result.path ?? (await Filesystem.getUri({ path: FILE, directory: Directory.Cache })).uri;
  } catch (err) {
    throw new InstallStepError('download', err);
  } finally {
    await listener.remove();
  }

  try {
    // Android shows "Update this app?". The first time it asks to allow
    // Somnus to install apps (REQUEST_INSTALL_PACKAGES in the manifest).
    await FileOpener.open({
      filePath: path,
      contentType: 'application/vnd.android.package-archive',
      openWithDefault: true,
    });
  } catch (err) {
    throw new InstallStepError('install', err);
  }
}
