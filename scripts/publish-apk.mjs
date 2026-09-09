import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Puts the freshly built APK where the /download page can serve it.
 *
 * Copies into both public/ (the source of truth for the next web build) and
 * out/ (the export being served right now), so the download link works
 * without a further rebuild. Deliberately runs after the APK is packaged -
 * see clean-apk-assets.mjs for why it must not be present before.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(
  here,
  '../apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk',
);

if (!fs.existsSync(built)) {
  console.error('[apk] no debug APK found. Did the Gradle build actually succeed?');
  process.exit(1);
}

const size = (fs.statSync(built).size / 1024 / 1024).toFixed(1);

for (const dir of [
  path.resolve(here, '../apps/web/public/downloads'),
  path.resolve(here, '../apps/web/out/downloads'),
]) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(built, path.join(dir, 'lacs.apk'));
}

console.log(`[apk] published lacs.apk (${size} MB) - served at /download`);
