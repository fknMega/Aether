// ─────────────────────────────────────────────────────────────────────────────
// Regenerate the README screenshots.
//
//   npm run preview:web      # in one terminal (from app/) — serves the renderer on :5199
//   npm run shots            # in another; writes to ../docs/media
//
// Drives the real renderer against the mocked bridge in an Electron window and
// writes PNGs to docs/media. No Playwright, no Puppeteer — Electron is already
// a devDependency, so this adds nothing to the tree.
//
// The mock is dev-only seed data; nothing here touches a real case or account.
// ─────────────────────────────────────────────────────────────────────────────
import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ORIGIN = process.env.AETHER_PREVIEW ?? "http://localhost:5199";
const OUT = resolve(import.meta.dirname, "..", "..", "docs", "media");
const W = 1440, H = 872;

/** Each shot is [filename, query]. Both themes are rendered for every view. */
const SHOTS = [
  ["chat",       "view=chat"],
  ["graph",      "view=graph"],
  ["graph-node", "view=graph&select=fknmega"],
  ["welcome",    "view=chat&empty=1"],
  ["modules",    "view=settings&tab=Modules"],
  ["providers",  "view=settings&tab=Model"],
  ["onboarding", "onboard=1"],
  ["setup",      "setup=1"],
  ["permission", "view=chat&empty=1&perm=shell&ask=1"],
];

/** Pictures for the setup guides (docs/*.md). Light theme, rendered once with
 *  macOS chrome and once with Windows chrome, so each guide shows its own OS.
 *  `open` names an element to click before the shot (aria-label). */
const GUIDE = [
  ["welcome",        "onboard=1&provider=claude&view=chat&empty=1"],
  ["onboard-openai", "onboard=1&provider=openai&view=chat&empty=1"],
  ["onboard-gemini", "onboard=1&provider=gemini&view=chat&empty=1"],
  ["onboard-ollama", "onboard=1&provider=ollama&ollama=down&view=chat&empty=1"],
  ["setup",          "setup=1&view=chat&empty=1"],
  ["model-claude",   "view=settings&tab=Model&provider=claude"],
  ["model-ollama",   "view=settings&tab=Model&provider=ollama"],
  ["model-openai",   "view=settings&tab=Model&provider=openai&key=1"],
  ["modules",        "view=settings&tab=Modules"],
  ["module-editor",  "view=settings&tab=Modules", "Edit nesher"],
  ["module-notes",   "view=settings&tab=Modules", "Edit nesher:2"],
  ["chat",           "view=chat&empty=1&provider=ollama"],
  ["access-full",    "view=chat&empty=1&access=full"],
  ["permission",     "view=chat&empty=1&perm=shell&ask=1"],
  ["graph",          "view=graph&select=fknmega"],
];
const GUIDE_OUT = join(OUT, "guide");

/** The graph settles under a force simulation, so a fixed delay is the honest
 *  way to wait for it — there is no load event for "the layout has cooled". */
const SETTLE = { graph: 3800, "graph-node": 4200, default: 1400 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: W, height: H, show: false,
    // capturePage on a hidden window returns an empty bitmap unless the window
    // is allowed to paint while it is not on screen.
    paintWhenInitiallyHidden: true,
    backgroundColor: "#0F1214",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  for (const theme of ["dark", "light"]) {
    for (const [name, query] of SHOTS) {
      const url = `${ORIGIN}/preview.html?${query}&theme=${theme}`;
      await win.loadURL(url);
      await sleep(SETTLE[name] ?? SETTLE.default);

      // Open a node's inspector for the detail shot. The preview bridge exposes
      // this hook precisely so a screenshot can reach a state that otherwise
      // needs a click at coordinates the layout decides.
      if (name === "modules") {
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.group-head')].forEach(b => { if (/Domains|Scanning/.test(b.textContent)) b.click() }), null`,
        ).catch(() => {});
        await sleep(400);
      }

      // The approval prompt only exists mid-turn, so send one first.
      if (name === "permission") {
        await win.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector('.composer textarea');
          const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          set.call(ta, 'sweep helio-labs.io');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => document.querySelector('.send-btn')?.click(), 120);
          return null;
        })()`).catch(() => {});
        await sleep(1600);
      }
      if (name === "graph-node") {
        await win.webContents.executeJavaScript(
          `window.__selectNode && window.__selectNode("fknmega"), null`,
        ).catch(() => {});
        await sleep(700);
      }

      const image = await win.webContents.capturePage();
      const file = join(OUT, theme === "dark" ? `${name}.png` : `${name}-light.png`);
      writeFileSync(file, image.toPNG());
      console.log(`wrote ${file}`);
    }
  }

  // ── guide pictures ─────────────────────────────────────────────────────────
  mkdirSync(GUIDE_OUT, { recursive: true });
  for (const platform of ["darwin", "win32"]) {
    for (const [name, query, open] of GUIDE) {
      await win.loadURL(`${ORIGIN}/preview.html?${query}&theme=light&platform=${platform}`);
      await sleep(SETTLE[name] ?? SETTLE.default);
      if (name === "modules" || name.startsWith("module-")) {
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.group-head')].forEach(b => { if (/Domains|Scanning/.test(b.textContent)) b.click() }), null`,
        ).catch(() => {});
        await sleep(300);
      }
      if (open) {
        // "label" or "label:N" — the Nth button with that aria-label.
        const [label, nth] = open.split(":");
        await win.webContents.executeJavaScript(
          `(() => { const b = document.querySelectorAll('button[aria-label=${JSON.stringify(label)}]'); (b[${Number(nth ?? 1) - 1}] ?? b[0])?.click(); return null; })()`,
        ).catch(() => {});
        await sleep(600);
        if (name === "module-notes") {
          await win.webContents.executeJavaScript(`document.getElementById('mod-notes')?.scrollIntoView({ block: 'center' }), null`).catch(() => {});
          await sleep(200);
        }
      }
      if (name === "permission") {
        await win.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector('.composer textarea');
          const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          set.call(ta, 'sweep helio-labs.io');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => document.querySelector('.send-btn')?.click(), 120);
          return null;
        })()`).catch(() => {});
        await sleep(1600);
      }
      if (name === "graph") {
        await win.webContents.executeJavaScript(`window.__selectNode && window.__selectNode("fknmega"), null`).catch(() => {});
        await sleep(700);
      }
      const image = await win.webContents.capturePage();
      const file = join(GUIDE_OUT, `${name}-${platform === "win32" ? "win" : "mac"}.png`);
      writeFileSync(file, image.toPNG());
      console.log(`wrote ${file}`);
    }
  }
  win.destroy();
  app.quit();
}

app.whenReady().then(() =>
  main().catch((e) => { console.error(e); app.exit(1); }),
);
