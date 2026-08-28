const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

app.setName('Araújo Encomendas');
app.setAppUserModelId('br.com.araujo.encomendas');

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#f3efe8',
    title: 'Araújo Encomendas',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, '..', 'desktop-dist', 'index.html'));
}

function printLogPath() {
  return path.join(app.getPath('userData'), 'impressao.log');
}

function writePrintLog(message) {
  fs.appendFileSync(printLogPath(), `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

ipcMain.handle('print-receipt', async (event, payload) => {
  let rawFile;
  try {
    const requestedName = String(payload?.printerName || 'ELGIN i8');
    const rawData = String(payload?.rawData || '');
    if (!rawData) throw new Error('Os dados da encomenda não foram recebidos.');

    const printers = await event.sender.getPrintersAsync();
    const wanted = requestedName.trim().toLowerCase();
    const printer = printers.find(({ name, displayName }) =>
      name.toLowerCase() === wanted || String(displayName || '').toLowerCase() === wanted
    ) || printers.find(({ name, displayName }) =>
      name.toLowerCase().includes('elgin i8') || String(displayName || '').toLowerCase().includes('elgin i8')
    );
    if (!printer) throw new Error('Impressora ELGIN i8 não encontrada no Windows.');

    writePrintLog(`Impressora selecionada: ${printer.name}`);
    rawFile = path.join(os.tmpdir(), `araujo-encomendas-${process.pid}-${Date.now()}.bin`);
    fs.writeFileSync(rawFile, Buffer.from(rawData, 'base64'));
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'rawPrinter.ps1')
      : path.join(__dirname, '..', 'rawPrinter.ps1');
    if (!fs.existsSync(scriptPath)) throw new Error(`Auxiliar de impressão não encontrado: ${scriptPath}`);

    const { stdout, stderr } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, '-PrinterName', printer.name, '-DataFile', rawFile
    ], { windowsHide: true, timeout: 20000 });
    if (stdout.trim()) writePrintLog(stdout.trim());
    if (stderr.trim()) writePrintLog(`Aviso: ${stderr.trim()}`);
  } catch (error) {
    writePrintLog(`ERRO: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    throw error;
  } finally {
    if (rawFile && fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
  }
});

ipcMain.handle('open-print-log', async () => {
  if (!fs.existsSync(printLogPath())) writePrintLog('Relatório de impressão criado.');
  const errorMessage = await shell.openPath(printLogPath());
  if (errorMessage) throw new Error(errorMessage);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

