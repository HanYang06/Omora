/**
 * Omora 桌面壳：一个薄主进程，只做三件事——开窗口、装页面、给调试留口子。
 *
 * 页面从哪来：
 *   开发（OMORA_DEV_URL 有值）→ 直接装 vite dev server，热更新照旧；
 *   发布（没有 OMORA_DEV_URL）→ 装 app/ui-engine/dist/index.html。
 *
 * 为什么不在这里起 Python 内核：开发时内核由 omora dev 起（和 vite 一起），
 * 壳只当浏览器用；发布形态再让壳去拉起 kernel，是下一步的事。
 */

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEV_URL = process.env.OMORA_DEV_URL ?? "";
// 截图只在无 GPU 的机器 / 远程会话里跑，走软件合成更稳
if (process.env.OMORA_SHOT) {
  app.disableHardwareAcceleration();
}
const DEVTOOLS = process.env.OMORA_DEVTOOLS === "1";
const SHOT = process.env.OMORA_SHOT ?? "";
const SHOT_DELAY = Number(process.env.OMORA_SHOT_DELAY ?? 2500);

function distIndex() {
  return path.join(__dirname, "..", "ui-engine", "dist", "index.html");
}

function fail(message) {
  console.error("[shell] " + message);
  app.exit(2);
}

/** 截图：先试 capturePage，不行就走 CDP（有些合成环境只有后者能出图）。 */
async function grab(window) {
  try {
    const image = await window.webContents.capturePage();
    return image.toPNG();
  } catch (first) {
    const debugger_ = window.webContents.debugger;
    debugger_.attach("1.3");
    try {
      const shot = await debugger_.sendCommand("Page.captureScreenshot", {
        format: "png",
        fromSurface: false,
        captureBeyondViewport: false,
      });
      return Buffer.from(shot.data, "base64");
    } finally {
      debugger_.detach();
    }
  }
}

/** 截图时顺手把 DOM 的关键尺寸倒出来，省得瞎猜。 */
async function dumpLayout(window) {
  const script = `(() => {
    const pick = (sel) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height), kids: node.children.length };
    };
    return {
      viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      root: pick("#root"),
      app: pick(".omora-app"),
      split: pick(".omora-split"),
      main: pick(".omora-split-main"),
      mainFirst: (document.querySelector(".omora-split-main")?.firstElementChild?.className) ?? null,
      search: pick(".omora-search"),
      errors: window.__omoraErrors ?? [],
    };
  })()`;
  try {
    const value = await window.webContents.executeJavaScript(script);
    fs.writeFileSync(SHOT + ".json", JSON.stringify(value, null, 2));
  } catch (error) {
    console.error("[shell] 布局导出失败 " + error);
  }
}

/**
 * 麦克风 / 摄像头的授权：Electron 不会替用户弹权限框，必须在这里显式放行。
 * 只放 media，别的（剪贴板、通知……）一律不给。
 */
function grantMedia() {
  const allowed = new Set(["media"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    allowed.has(permission),
  );
}

function capture(window) {
  window.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      try {
        await dumpLayout(window);
        fs.writeFileSync(SHOT, await grab(window));
        console.log("[shell] 截图已存 " + SHOT);
      } catch (error) {
        console.error("[shell] 截图失败 " + error);
      } finally {
        app.quit();
      }
    }, SHOT_DELAY);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#e4e8db",
    title: "Omora",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (SHOT) {
    capture(window);
  }

  if (DEV_URL.length > 0) {
    // dev server 可能比壳晚起来几百毫秒：连不上就再等，别停在白板上
    let retries = 0;
    window.webContents.on("did-fail-load", (_event, code, description, url) => {
      if (retries >= 40 || !url.startsWith("http")) {
        return;
      }
      retries += 1;
      setTimeout(() => window.loadURL(url), 400);
    });
    window.loadURL(DEV_URL);
    if (DEVTOOLS) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  const index = distIndex();
  if (!fs.existsSync(index)) {
    fail("找不到 " + index + "，先跑 pnpm --dir app/ui-engine build");
    return;
  }
  window.loadFile(index);
}

app.whenReady().then(() => {
  grantMedia();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
