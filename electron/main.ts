import { app, BrowserWindow, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}`;

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let nextProcess: ChildProcess | null = null;

function waitForServer(url: string, attempts = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    let tries = 0;

    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
            return;
          }
          retry();
        })
        .on("error", retry);
    };

    const retry = () => {
      tries += 1;
      if (tries >= attempts) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(check, 500);
    };

    check();
  });
}

function startStandaloneServer(): Promise<void> {
  const standaloneDir = path.join(__dirname, "..", ".next", "standalone");
  const serverScript = path.join(standaloneDir, "server.js");

  return new Promise((resolve, reject) => {
    nextProcess = spawn(process.execPath, [serverScript], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(PORT),
        HOSTNAME: HOST,
      },
      stdio: "inherit",
    });

    nextProcess.on("error", reject);
    waitForServer(APP_URL).then(resolve).catch(reject);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await waitForServer(APP_URL);
    await mainWindow.loadURL(APP_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await startStandaloneServer();
    await mainWindow.loadURL(APP_URL);
  }
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  nextProcess?.kill();
  nextProcess = null;
});
