import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'local.somnus.app',
  appName: 'Somnus',
  // The same static export the website serves. One UI, two shells.
  webDir: '../web/out',
  android: {
    // The API is almost always plain HTTP on a LAN during development, which
    // Android blocks by default. Release builds pointed at an HTTPS server
    // should set this back to false.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
