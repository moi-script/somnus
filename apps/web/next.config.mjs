/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the exact same build serves the website and becomes the
  // Capacitor webview payload. Keeps one UI instead of two that drift.
  output: 'export',
  images: { unoptimized: true },
  // Capacitor serves from the filesystem, where /live resolves to /live/index.html.
  trailingSlash: true,
};

export default nextConfig;
