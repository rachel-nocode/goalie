import { app, BrowserWindow, dialog, nativeImage, shell } from "electron";
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const loadingPage = path.join(__dirname, "loading.html");
const appIconPath = path.join(__dirname, "icon.icns");

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

app.name = "Goalie";

app.setAboutPanelOptions({
  applicationName: "Goalie",
  applicationVersion: app.getVersion(),
  copyright: "© Rachel nocode — Goalie",
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(appIconPath));
  }

  createWindowShell();

  try {
    serverPort = await findOpenPort(43127);
    await startLocalServer(serverPort);
    await waitForServer(serverPort);
    await loadAppUrl(serverPort);
  } catch (error) {
    dialog.showErrorBox(
      "Goalie could not start",
      error instanceof Error ? error.message : "The local server did not start.",
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      createWindowShell();
      void loadAppUrl(serverPort);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopLocalServer();
});

function createWindowShell() {
  if (mainWindow) {
    return;
  }

  mainWindow = new BrowserWindow({
    title: "Goalie",
    width: 1480,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#d2ece0",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    autoHideMenuBar: true,
    show: true,
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void mainWindow.loadFile(loadingPage);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isInternalAppUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function loadAppUrl(port) {
  if (!mainWindow) {
    return;
  }

  const appUrl = `http://127.0.0.1:${port}/`;

  try {
    await mainWindow.loadURL(appUrl, {
      extraHeaders: "Cache-Control: no-cache\r\nPragma: no-cache\r\n",
    });
  } catch (error) {
    dialog.showErrorBox(
      "Goalie could not load",
      error instanceof Error ? error.message : `Could not open ${appUrl}`,
    );
  }
}

function getPathParts() {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
    ...(process.env.PATH || "").split(path.delimiter),
  ].filter(Boolean);
}

function getAugmentedEnv(port, extraEnv = {}) {
  return {
    ...process.env,
    ...extraEnv,
    PATH: getPathParts().join(path.delimiter),
    PORT: String(port),
    GOALIE_DESKTOP: "1",
  };
}

function findNodeBinary() {
  for (const dir of getPathParts()) {
    const candidate = path.join(dir, "node");

    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function getRuntimePaths() {
  if (!app.isPackaged) {
    return {
      appPath: rootDir,
      workDir: rootDir,
    };
  }

  return {
    appPath: app.getAppPath(),
    workDir: app.getPath("userData"),
  };
}

function getServerLaunch(port) {
  const { appPath, workDir } = getRuntimePaths();
  const serverPath = path.join(appPath, "server.mjs");
  const runtimeEnv = {
    GOALIE_ROOT: workDir,
    GOALIE_APP_PATH: appPath,
  };

  if (!app.isPackaged) {
    const nodeBinary = findNodeBinary();
    if (nodeBinary) {
      return {
        command: nodeBinary,
        args: [serverPath],
        cwd: workDir,
        env: getAugmentedEnv(port, runtimeEnv),
      };
    }
  }

  return {
    command: process.execPath,
    args: [serverPath],
    cwd: workDir,
    env: getAugmentedEnv(port, { ...runtimeEnv, ELECTRON_RUN_AS_NODE: "1" }),
  };
}

async function startLocalServer(port) {
  stopLocalServer();

  const launch = getServerLaunch(port);

  serverProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[goalie-server] ${chunk}`);
  });

  serverProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[goalie-server] ${chunk}`);
  });

  serverProcess.on("exit", (code) => {
    serverProcess = null;

    if (code && !isQuitting) {
      console.error(`Goalie server stopped with code ${code}.`);

      if (mainWindow) {
        dialog.showErrorBox(
          "Goalie server stopped",
          "The local server exited unexpectedly. Quit and reopen Goalie to try again.",
        );
      }
    }
  });

  await waitForServerProcess(port);
}

function stopLocalServer() {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

async function waitForServerProcess(port) {
  const start = Date.now();

  while (Date.now() - start < 30000) {
    if (!serverProcess) {
      throw new Error("Goalie local server exited before it was ready.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the local server is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error("Goalie local server did not start in time.");
}

async function waitForServer(port) {
  await waitForServerProcess(port);
}

function findOpenPort(startPort) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const tester = net.createServer();
      tester.once("error", () => {
        tester.close();
        tryPort(port + 1);
      });
      tester.once("listening", () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, "127.0.0.1");
    };

    tryPort(startPort);
  });
}

function isInternalAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}
