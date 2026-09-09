import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Next only auto-loads a .env sitting in its own directory, but this repo
 * keeps one .env at the root that every workspace shares. Without this, a
 * NEXT_PUBLIC_* value set at the root is silently ignored and the bundle
 * falls back to its default - which shipped an APK pointing at
 * localhost:4000, meaning the phone itself.
 */
function loadRootEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, '../../.env');
  if (!fs.existsSync(envPath)) return {};

  const out = {};
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    // Only NEXT_PUBLIC_* is safe to inline: everything here reaches the
    // browser, and JWT_SECRET must never be among it.
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    out[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const rootEnv = loadRootEnv();

if (rootEnv.NEXT_PUBLIC_API_URL) {
  console.log(`[web] API URL baked into this build: ${rootEnv.NEXT_PUBLIC_API_URL}`);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the exact same build serves the website and becomes the
  // Capacitor webview payload. Keeps one UI instead of two that drift.
  output: 'export',
  images: { unoptimized: true },
  // Capacitor serves from the filesystem, where /live resolves to /live/index.html.
  trailingSlash: true,
  env: rootEnv,
};

export default nextConfig;
