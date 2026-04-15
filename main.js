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
    x: d.workArea.x,
    y: d.workArea.y,
    width: d.workArea.width,
    height: d.workArea.height,
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

function createTrailWindow(display) {
  const { x, y, width, height } = display.workArea;
  trailWin = new BrowserWindow({
    x, y, width, height,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false,
    focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  trailWin.loadFile('trail.html');
  trailWin.setIgnoreMouseEvents(true);
}

function createSlimeWindow(display) {
  const { x, y, width, height } = display.workArea;
  slimeWin = new BrowserWindow({
    width: 120, height: 120,
    x: Math.floor(x + width/2 - 60),
    y: y + height - 120,
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

  // 右鍵選單
  ipcMain.on('show-context-menu', () => {
    buildContextMenu().popup({ window: slimeWin });
  });

  // 自動移動
  ipcMain.on('move-window', (e, { x, y }) => {
    if (!dragging && slimeWin && !slimeWin.isDestroyed()) {
      const nx = parseInt(x, 10) || 0, ny = parseInt(y, 10) || 0;
      if (isFinite(nx) && isFinite(ny)) slimeWin.setPosition(nx, ny);
    }
  });

  // 足跡座標
  ipcMain.on('trail-blob', (e, data) => {
    if (trailWin && !trailWin.isDestroyed()) {
      trailWin.webContents.send('trail-blob', data);
    }
  });

  // 拖曳
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
  // 點托盤也重建選單確保最新狀態
  tray.on('click', () => tray.setContextMenu(buildContextMenu()));
}

app.whenReady().then(() => {
  const primary = screen.getPrimaryDisplay();
  createTrailWindow(primary);
  createSlimeWindow(primary);
  createTray();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
