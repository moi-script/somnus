import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAbiFilters, withInstallPermission } from './android-setup.mjs';

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application />
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

const GRADLE = `android {
    defaultConfig {
        applicationId "local.somnus.app"
        versionName appVersion
    }
}
`;

test('adds the install permission once', () => {
  const once = withInstallPermission(MANIFEST);
  assert.match(once, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.equal(withInstallPermission(once), once);
  assert.equal(once.match(/REQUEST_INSTALL_PACKAGES/g).length, 1);
});

test('builds for phone processors only, once', () => {
  const once = withAbiFilters(GRADLE);
  assert.match(once, /abiFilters 'arm64-v8a', 'armeabi-v7a'/);
  assert.equal(withAbiFilters(once), once);
  assert.ok(once.indexOf('abiFilters') > once.indexOf('defaultConfig {'));
});

test('handles Windows line endings in build.gradle', () => {
  const crlf = GRADLE.replace(/\n/g, '\r\n');
  assert.match(withAbiFilters(crlf), /abiFilters/);
});
