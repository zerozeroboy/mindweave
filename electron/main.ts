import { app, BrowserWindow } from "electron";
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

fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(sessionDataPath, { recursive: true });
fs.mkdirSync(diskCachePath, { recursive: true });

app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
app.commandLine.appendSwitch("disk-cache-dir", diskCachePath);

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL("http://127.0.0.1:5173");
}

app.whenReady().then(() => {
  registerWorkspaceIpc();
  registerAgentIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
