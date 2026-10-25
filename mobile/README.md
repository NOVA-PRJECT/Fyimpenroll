# FYIMP mobile

Expo Router app for students, teaching staff, HODs and administrators. Uses Expo SDK 57 and React Native 0.86 for compatibility with the current store version of Expo Go.

## Test with Expo Go

Install dependencies from the repository root:

```sh
npm install
npm run start:go --workspace=mobile
```

Install Expo Go on your phone and keep your phone and computer on the same Wi-Fi. Scan the terminal QR code using Expo Go on Android, or the Camera app on iOS. This starts Expo Go mode explicitly and clears the Metro cache after SDK changes.

Copy `.env.example` to `.env` in this directory and fill in the public API and authentication configuration. Use an API address reachable from the phone; `localhost` on a phone points to the phone itself. For a local backend, set `EXPO_PUBLIC_API_BASE_URL` to your computer's Wi-Fi IPv4 address and backend port, for example `http://192.168.1.100:4000`, then run `npm run dev:backend` from the repository root in a separate terminal. Set `EXPO_PUBLIC_PORTAL_URL=https://fyimpenroll.vercel.app` for the privacy and terms screens. The production export validates all four public environment variables before bundling, so missing policy links cannot ship as an unusable consent screen.

If the LAN connection fails, try:

```sh
npm run start:go --workspace=mobile -- --tunnel
```

Tunnel mode exposes the Metro development server; your backend still needs an address the phone can reach. Restart Expo after editing `.env`.

SDK 58's matching Expo Go store release was pending at the time of this change. Keep SDK 57 until the Expo Go app on your phone supports SDK 58. See the [SDK 58 release notes](https://expo.dev/changelog/sdk-58).

## Other development and checks

From the repository root:

```sh
npm run android --workspace=mobile
npm run ios --workspace=mobile
npm run web --workspace=mobile
npm run typecheck --workspace=mobile
npm run doctor --workspace=mobile
npm run build --workspace=mobile
```

Android local native builds require the Android SDK and Java. iOS local native builds require macOS and Xcode. The build script exports production Android and iOS JavaScript and Hermes assets; it does not produce an APK or IPA. Web is available for layout previews; verify authentication storage, location permissions and offline attendance on native devices.

## Device review

- Check sign-in on a small phone with the keyboard visible, email autofill, password visibility, validation errors and repeated submission.
- Check light and dark appearance, larger system text, screen reader labels and reduced motion.
- Check each role's navigation, password change and consent gates using test accounts.
- Check student dashboard shortcuts, refresh, empty timetable, missing attendance, and failed refresh with previously loaded data.
- Check location denial, campus sign-in and offline attendance synchronization on Android and iOS.

Metro uses Expo's automatic monorepo configuration. Keep native module versions aligned with `expo install --check`; do not hide native version mismatches with install exclusions.

The root React override keeps shared workspace libraries on SDK 57's React 19.2.3 runtime. Update that override together with the app's React version during future SDK changes.
