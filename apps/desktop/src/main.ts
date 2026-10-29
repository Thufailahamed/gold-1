import { app, BrowserWindow, session, shell } from "electron";

// The window always shows the hosted web app. Its API calls already come from
// this origin (WEB_ORIGIN in apps/api/wrangler.toml), so the CSRF and CORS
// checks keep working without any server change. GOLDOS_URL is for development
// only; a packaged install always loads production.
const PRODUCTION_URL = "https://goldos-web.thufailahamed627.workers.dev";
const API_URL = "https://goldos-api.thufailahamed627.workers.dev";
const APP_URL = app.isPackaged ? PRODUCTION_URL : (process.env.GOLDOS_URL ?? PRODUCTION_URL);

// Pages can open the API directly (label and PDF endpoints), and those need the
// session cookies held by this window, so the API origin counts as in-app too.
const TRUSTED_ORIGINS = new Set([new URL(APP_URL).origin, new URL(API_URL).origin]);

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

let mainWindow: BrowserWindow | null = null;

function isTrustedUrl(url: string): boolean {
  try {
    return TRUSTED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function openExternal(url: string): void {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    // Malformed URL: nothing to open.
  }
}

// Applies to every window, including popups, so no page can leave the trusted
// origins inside the GoldOS window.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
});

// Grant the camera (barcode scanning) to GoldOS pages only. Microphone and every
// other permission are refused. The default session can only be read after ready.
function configurePermissions(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    const cameraOnly =
      permission === "media" && !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((type) => type === "video");
    callback(isTrustedUrl(webContents.getURL()) && cameraOnly);
  });
}

function offlinePage(message: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>GoldOS</title>
<body style="font-family:-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#faf8f3;color:#2b2b2b">
<div style="text-align:center"><h1 style="font-weight:600">GoldOS can't reach the server</h1>
<p>${message}</p><button onclick="location.href='${APP_URL}'" style="padding:8px 18px;font-size:14px">Try again</button></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: "GoldOS",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 is an aborted load, which happens when the user navigates away.
    if (!isMainFrame || errorCode === -3) return;
    void win.loadURL(offlinePage(errorDescription));
  });

  void win.loadURL(APP_URL);
}

// A shop should run one window. A second launch focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    configurePermissions();
    createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
