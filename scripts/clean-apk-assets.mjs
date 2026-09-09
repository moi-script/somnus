import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Removes the distributable APK from the web export before Capacitor packages
 * it.
 *
 * The /download page serves the APK out of apps/web/public, and Capacitor
 * copies that whole directory into the app's assets - so without this the app
 * ships a copy of the previous APK inside itself, growing by ~25 MB every
 * build. Run before `cap sync`; scripts/publish-apk.mjs puts it back for the
 * website afterwards.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const targets = [
  path.resolve(here, '../apps/web/public/downloads'),
  path.resolve(here, '../apps/web/out/downloads'),
  path.resolve(here, '../apps/mobile/android/app/src/main/assets/public/downloads'),
];

for (const dir of targets) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.apk')) continue;
    fs.rmSync(path.join(dir, file));
    console.log(`[apk] removed ${path.relative(process.cwd(), path.join(dir, file))}`);
  }
}
