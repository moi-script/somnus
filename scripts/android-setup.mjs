import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Settings the gitignored android/ project needs, applied on every
 * `npm run sync` so a fresh clone or a regenerated project gets them too.
 * Each change is idempotent.
 *
 * - REQUEST_INSTALL_PACKAGES: lets the in-app updater open Android's
 *   installer on the downloaded APK. Without it the installer never opens.
 * - abiFilters: build for real phone processors only. The x86 database
 *   libraries are for emulators and add ~10 MB to every download.
 */

const PERMISSION = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />';

export function withInstallPermission(manifest) {
  if (manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES')) return manifest;
  return manifest.replace('</manifest>', `    ${PERMISSION}\n</manifest>`);
}

export function withAbiFilters(gradle) {
  if (gradle.includes('abiFilters')) return gradle;
  return gradle.replace(
    /defaultConfig \{(\r?\n)/,
    (_, nl) => `defaultConfig {${nl}        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }${nl}`,
  );
}

function patch(file, transform) {
  if (!fs.existsSync(file)) {
    console.warn(`[android] ${path.basename(file)} not found, skipped (run npx cap add android first)`);
    return;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`[android] updated ${path.basename(file)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/mobile/android/app');
  patch(path.join(app, 'src/main/AndroidManifest.xml'), withInstallPermission);
  patch(path.join(app, 'build.gradle'), withAbiFilters);
}
