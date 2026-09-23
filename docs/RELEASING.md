# Releasing a new Somnus version

Follow these steps every time. The installed app compares its own version with
the newest GitHub release and offers an update when the release is newer. That
only works if the version in the APK and the release tag match.

## Checklist

1. **Pick the new version**, e.g. `0.4.0` (it must be higher than the last
   release: `gh release list -R moi-script/somnus`).

2. **Set it in `apps/mobile/package.json`**, the only place the version lives:

   ```json
   "version": "0.4.0"
   ```

3. **Check the one-time Android setup** (see below). Both must print something:

   ```bash
   grep -n "appVersion" apps/mobile/android/app/build.gradle
   grep -n "0D1023" apps/mobile/android/app/src/main/res/values/ic_launcher_background.xml
   ```

   If either prints nothing, redo that setup before building.

4. **Build the APK**:

   ```bash
   npm run apk
   ```

5. **Write release notes** in `notes.md` (what changed, for the person
   installing it).

6. **Create the release**, with the tag matching step 2 plus a `v`:

   ```bash
   gh release create v0.4.0 apps/web/public/downloads/somnus.apk --title "Somnus 0.4.0" --notes-file notes.md
   ```

   The asset must be named `somnus.apk`. The download links use
   `releases/latest/download/somnus.apk`.

7. **Commit the version bump**:

   ```bash
   git add apps/mobile/package.json
   git commit -m "chore: release 0.4.0"
   git push
   ```

8. **Verify**. On a phone with the previous version, open the app. The banner
   "Somnus 0.4.0 is out" appears (the app checks at most every 6 hours, so
   reinstalling or clearing app data forces a fresh check). After updating,
   **Me** shows `Somnus 0.4.0 · Up to date`.

## Common mistakes

| Mistake | What happens |
| --- | --- |
| Forgot step 2 | The new APK still reports the old version and keeps offering itself as an update. |
| Tag doesn't match `package.json` | Same as above, or the update is never offered. |
| Version not higher than the last one | Android refuses to install over the old APK (`versionCode` didn't grow). |
| Asset not named `somnus.apk` | The Update button and download links return 404. |

## One-time setup: Gradle reads the version

`apps/mobile/android/` is gitignored, so this edit is not in the repo and has
to be redone on a fresh clone or after regenerating the Android project
(`npx cap add android`). In `apps/mobile/android/app/build.gradle`:

Under `apply plugin: 'com.android.application'`, add:

```groovy
def appVersion = new groovy.json.JsonSlurper().parse(file('../../package.json')).version
def (vMajor, vMinor, vPatch) = appVersion.tokenize('.').collect { it.toInteger() }
```

In `defaultConfig`, replace `versionCode 1` / `versionName "1.0"` with:

```groovy
versionCode vMajor * 10000 + vMinor * 100 + vPatch
versionName appVersion
```

Without it, Android always reports version `1.0` / code `1` and may refuse to
install a new APK over an old one.

## One-time setup: app icon

The launcher icon, splash screen and dark splash colour are generated from
`logo/applogo.jpg` into the same gitignored `android/` folder. On a fresh clone
or after regenerating the Android project, run:

```bash
python scripts/make-icons.py
```

If the app shows the blue Capacitor "X" icon, this step was skipped. To change
the logo, replace `logo/applogo.jpg` and rerun it.

If `npm run apk` says `JAVA_HOME is set to an invalid directory`, use the
pinned JDK:

```bash
JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot" npm run apk
```
