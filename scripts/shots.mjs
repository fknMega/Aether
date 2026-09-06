// ─────────────────────────────────────────────────────────────────────────────
// Regenerate the README screenshots.
//
//   npm run preview:web      # in one terminal — serves the renderer on :5199
//   npm run shots            # in another
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
const OUT = resolve(import.meta.dirname, "..", "docs", "media");
const W = 1440, H = 872;

/** Each shot is [filename, query]. Both themes are rendered for every view. */
const SHOTS = [
  ["chat",       "view=chat"],
  ["graph",      "view=graph"],
  ["graph-node", "view=graph&select=fknmega"],
  ["welcome",    "view=chat&empty=1"],
  ["modules",    "view=settings&tab=Modules"],
  ["providers",  "view=settings&tab=Model"],
];

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
  win.destroy();
  app.quit();
}

app.whenReady().then(() =>
  main().catch((e) => { console.error(e); app.exit(1); }),
);
