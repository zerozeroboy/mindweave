import { app, BrowserWindow, ipcMain, Menu, nativeImage, type NativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerWorkspaceIpc } from "./ipc/workspace.js";
import { registerAgentIpc } from "./ipc/agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDataRoot = path.join(app.getPath("appData"), "AgentOS");
const userDataPath = path.join(appDataRoot, "user-data");
const sessionDataPath = path.join(appDataRoot, "session-data");
const diskCachePath = path.join(sessionDataPath, "Cache");

process.env.AGENTOS_DATA_DIR = userDataPath;

fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(sessionDataPath, { recursive: true });
fs.mkdirSync(diskCachePath, { recursive: true });

app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
app.commandLine.appendSwitch("disk-cache-dir", diskCachePath);
const appUserModelId = app.isPackaged ? "com.mindweave.desktop" : "com.mindweave.desktop.dev";
app.setAppUserModelId(appUserModelId);

if (app.isPackaged) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const windows = BrowserWindow.getAllWindows();
      const win = windows.length ? windows[0] : null;
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
      createWindow();
    });
  }
}

function resolveWindowIcon(): string | NativeImage | undefined {
  const candidates = process.platform === "win32" ? [
    path.join(__dirname, "..", "assets", "app-icon.ico"),
    path.join(__dirname, "..", "assets", "app-icon.png"),
    path.join(__dirname, "..", "src", "assets", "mw-logo.ico"),
    path.join(__dirname, "..", "src", "assets", "mw-logo.png")
  ] : [
    path.join(__dirname, "..", "src", "assets", "mw-logo.ico"),
    path.join(__dirname, "..", "src", "assets", "mw-logo.png"),
    path.join(__dirname, "..", "assets", "app-icon.ico"),
    path.join(__dirname, "..", "assets", "app-icon.png")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const svgCandidates = [path.join(__dirname, "..", "src", "assets", "mw-logo.svg")];
  for (const svgPath of svgCandidates) {
    if (!fs.existsSync(svgPath)) continue;
    try {
      const svgContent = fs.readFileSync(svgPath, "utf8");
      const encodedSvg = encodeURIComponent(svgContent);
      const image = nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodedSvg}`);
      if (!image.isEmpty()) {
        return process.platform === "win32" ? image.resize({ width: 256, height: 256 }) : image;
      }
    } catch {
      // ignore invalid or unreadable svg and continue fallback
    }
  }
  return undefined;
}

function registerWindowControlsIpc() {
  ipcMain.handle("window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle("window:maximize-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return Boolean(win?.isMaximized());
  });
}

function createWindow() {
  const icon = resolveWindowIcon();
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.on("maximize", () => win.webContents.send("window:maximized-changed", true));
  win.on("unmaximize", () => win.webContents.send("window:maximized-changed", false));
  if (app.isPackaged) {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    win.loadFile(indexPath);
  } else {
    win.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  if (app.isPackaged && !app.hasSingleInstanceLock()) {
    return;
  }
  if (app.isPackaged) {
    void import("./api-server.js");
  }
  registerWorkspaceIpc();
  registerAgentIpc();
  registerWindowControlsIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
