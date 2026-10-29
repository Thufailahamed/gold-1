# GoldOS Desktop

An Electron shell that installs GoldOS as a desktop app (macOS, Windows, Linux).
It opens the hosted web app in a native window. It holds no business logic and
no local database, so web releases reach every install without reinstalling.

## Run in development

Point the window at a local web server (the Next.js dev server on port 3000):

```bash
pnpm --filter goldos-web dev            # terminal 1
GOLDOS_URL=http://localhost:3000 pnpm --filter goldos-desktop start   # terminal 2
```

`GOLDOS_URL` is ignored in packaged builds, which always load production.

## Build an installer

```bash
pnpm --filter goldos-desktop dist
```

Output goes to `apps/desktop/release/`:

- macOS: `GoldOS-<version>-<arch>.dmg`
- Windows: `GoldOS Setup <version>.exe` (NSIS). Build on Windows or in CI.
- Linux: `GoldOS-<version>.AppImage`

electron-builder cannot reliably cross-build Windows or Linux from a Mac, so
`.github/workflows/desktop.yml` builds all three. Run it manually from the
Actions tab, or push a tag such as `desktop-v0.1.0`.

## Signing

Unsigned installers work, but the OS warns on first launch:

- **macOS:** Gatekeeper blocks it. Users right-click → Open. Proper distribution
  needs a *Developer ID Application* certificate and notarization (Apple
  Developer Program). Local builds may be signed with a development certificate
  that electron-builder finds in the keychain, which is fine on your own Mac
  only.
- **Windows:** SmartScreen warns until the installer has a code-signing
  certificate.

Set these secrets in GitHub to sign in CI: `DESKTOP_CSC_LINK`,
`DESKTOP_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`.

## Security model

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no preload script.
- Navigation and popups stay on the GoldOS web origin and the API origin.
  Anything else opens in the system browser (http, https and mailto only).
- The camera is the only browser permission granted, and only to GoldOS pages
  (for barcode scanning).
- One window per machine: a second launch focuses the existing window.
