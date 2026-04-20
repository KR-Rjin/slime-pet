const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');

let slimeWin, trailWin, tray;
let dragging = false;
let dragOffsetX = 0, dragOffsetY = 0;
let dragInterval = null;

function createTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="#3ab0e0"/>
    <ellipse cx="5" cy="7" rx="2" ry="1.2" fill="#1a2a3a"/>
    <ellipse cx="11" cy="7" rx="2" ry="1.2" fill="#1a2a3a"/>
    <line x1="5" y1="10" x2="11" y2="10" stroke="#1a2a3a" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
  return nativeImage.createFromBuffer(Buffer.from(svg), { scaleFactor: 1.0 });
}

function getDisplayInfo() {
  return screen.getAllDisplays().map(d => ({
    id: d.id,
    x: d.bounds.x,
    y: d.workArea.y,       // 用 workArea.y 避開 macOS menu bar
    width: d.bounds.width,
    height: d.bounds.height - (d.workArea.y - d.bounds.y), // 扣掉 menu bar 高度
  }));
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: '改變顏色',
      submenu: [
        { label: '🔵 藍色（預設）', click: () => slimeWin.webContents.send('set-color', '#1aa0d0') },
        { label: '🟢 綠色',         click: () => slimeWin.webContents.send('set-color', '#1ab06a') },
        { label: '🟣 紫色',         click: () => slimeWin.webContents.send('set-color', '#7c5cbf') },
        { label: '🩷 粉紅',         click: () => slimeWin.webContents.send('set-color', '#d0559a') },
        { label: '🟠 橘色',         click: () => slimeWin.webContents.send('set-color', '#d07820') },
        { type: 'separator' },
        { label: '自訂顏色…',       click: () => slimeWin.webContents.send('open-color-picker') },
      ]
    },
    { type: 'separator' },
    { label: '縮小 (−10%)', click: () => slimeWin.webContents.send('resize-slime', -0.10) },
    { label: '放大 (+10%)', click: () => slimeWin.webContents.send('resize-slime', +0.10) },
    { type: 'separator' },
    {
      label: '顯示 / 隱藏', click: () => {
        if (slimeWin.isVisible()) { slimeWin.hide(); trailWin.hide(); }
        else { slimeWin.show(); trailWin.show(); }
      }
    },
    { type: 'separator' },
    { label: '關閉史萊姆', click: () => app.quit() }
  ]);
}

function createTrailWindow() {
  // trail window 覆蓋所有螢幕的聯合區域
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  trailWin = new BrowserWindow({
    x: minX, y: minY,
    width: maxX - minX,
    height: maxY - minY,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false,
    focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  trailWin.loadFile('trail.html');
  trailWin.setIgnoreMouseEvents(true);
  trailWin.setAlwaysOnTop(true, 'screen-saver');
}

function createSlimeWindow(display) {
  const { x, y, width, height } = display.bounds;
  slimeWin = new BrowserWindow({
    width: 170, height: 170,
    x: Math.floor(x + width/2 - 85),
    y: y + height - 170,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  slimeWin.loadFile('index.html');
  slimeWin.setAlwaysOnTop(true, 'screen-saver');

  slimeWin.webContents.on('did-finish-load', () => {
    slimeWin.webContents.send('screen-info', { displays: getDisplayInfo() });
  });

  screen.on('display-added',   () => slimeWin.webContents.send('screen-info', { displays: getDisplayInfo() }));
  screen.on('display-removed', () => slimeWin.webContents.send('screen-info', { displays: getDisplayInfo() }));

  ipcMain.on('show-context-menu', () => {
    buildContextMenu().popup({ window: slimeWin });
  });

  ipcMain.on('move-window', (e, { x, y }) => {
    if (!dragging && slimeWin && !slimeWin.isDestroyed()) {
      let nx = parseInt(x, 10) || 0, ny = parseInt(y, 10) || 0;
      if (isFinite(nx) && isFinite(ny)) {
        // 找出史萊姆目前的螢幕（根據視窗中心）
        const [cx, cy] = [nx + 60, ny + 60];
        const displays = screen.getAllDisplays();
        let curDisplay = displays[0];
        for (const d of displays) {
          if (cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width &&
              cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height) {
            curDisplay = d; break;
          }
        }
        // 如果視窗中心跑出目前螢幕，clamp 回來
        const b = curDisplay.bounds;
        nx = Math.max(b.x - 60, Math.min(b.x + b.width - 60, nx));
        ny = Math.max(b.y - 60, Math.min(b.y + b.height - 60, ny));
        slimeWin.setPosition(nx, ny);
      }
    }
  });

  ipcMain.on('trail-blob', (e, data) => {
    if (trailWin && !trailWin.isDestroyed()) {
      trailWin.webContents.send('trail-blob', data);
    }
  });

  ipcMain.on('start-drag', (e, { mouseX, mouseY }) => {
    dragging = true;
    const [wx, wy] = slimeWin.getPosition();
    dragOffsetX = mouseX - wx;
    dragOffsetY = mouseY - wy;
    if (dragInterval) clearInterval(dragInterval);
    dragInterval = setInterval(() => {
      if (!dragging) { clearInterval(dragInterval); dragInterval = null; return; }
      const pos = screen.getCursorScreenPoint();
      const dx = parseInt(pos.x - dragOffsetX, 10), dy = parseInt(pos.y - dragOffsetY, 10);
      if (isFinite(dx) && isFinite(dy)) slimeWin.setPosition(dx, dy);
      const [wx2, wy2] = slimeWin.getPosition();
      slimeWin.webContents.send('drag-move', { winX: wx2, winY: wy2 });
    }, 16);
  });

  ipcMain.on('end-drag', () => {
    dragging = false;
    if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('史萊姆寵物');
  tray.setContextMenu(buildContextMenu());
  tray.on('click', () => tray.setContextMenu(buildContextMenu()));
}

app.whenReady().then(() => {
  const primary = screen.getPrimaryDisplay();
  createTrailWindow();
  createSlimeWindow(primary);
  createTray();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
