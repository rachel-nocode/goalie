import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

let mainWindow = null;
let serverProcess = null;
let serverPort = null;

app.name = "IdeaNibble";

app.whenReady().then(async () => {
  serverPort = await findOpenPort(43127);
  await startLocalServer(serverPort);
  await waitForServer(serverPort);
  createWindow(serverPort);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      createWindow(serverPort);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopLocalServer();
});

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#d2ece0",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

async function startLocalServer(port) {
  if (serverProcess) {
    return;
  }

  serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      WEDGERADAR_DESKTOP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[idea-nibble-server] ${chunk}`);
  });

  serverProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[idea-nibble-server] ${chunk}`);
  });

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (code && !app.isQuitting) {
      console.error(`IdeaNibble server stopped with code ${code}.`);
    }
  });
}

function stopLocalServer() {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

async function waitForServer(port) {
  const start = Date.now();

  while (Date.now() - start < 30000) {
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

  throw new Error("IdeaNibble local server did not start in time.");
}

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
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

    try {
      tryPort(startPort);
    } catch (error) {
      reject(error);
    }
  });
}
