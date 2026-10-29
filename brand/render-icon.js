// Renders brand/goldos-icon.svg to PNG sizes with Electron's Chromium engine.
// Usage: GOLDOS_SVG=<svg> GOLDOS_OUT=<dir> electron render-icon.js
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SVG = process.env.GOLDOS_SVG;
const OUT = process.env.GOLDOS_OUT;
const SIZES = [1024, 512, 256, 180, 128, 64, 32, 16];

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, "utf8");
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: false },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    const img = size === 1024 ? full : full.resize({ width: size, height: size, quality: "best" });
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), img.toPNG());
  }
  console.log("rendered", SIZES.join(", "));
  app.quit();
});
