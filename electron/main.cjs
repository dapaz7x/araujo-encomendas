const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const ORDER_SERVER_PORT = 37842;
let orderServer;

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

function ordersPath() {
  return path.join(app.getPath('userData'), 'encomendas.json');
}

function networkConfigPath() {
  return path.join(app.getPath('userData'), 'rede.json');
}

function readOrdersFile() {
  try {
    const value = JSON.parse(fs.readFileSync(ordersPath(), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function writeOrdersFile(orders) {
  fs.writeFileSync(ordersPath(), JSON.stringify(orders, null, 2), 'utf8');
}

function readNetworkConfig() {
  try {
    return { mode: 'local', serverIp: '', port: ORDER_SERVER_PORT, ...JSON.parse(fs.readFileSync(networkConfigPath(), 'utf8')) };
  } catch { return { mode: 'local', serverIp: '', port: ORDER_SERVER_PORT }; }
}

function localIpv4Addresses() {
  return Object.values(os.networkInterfaces()).flat().filter(address =>
    address && address.family === 'IPv4' && !address.internal
  ).map(address => address.address);
}

function jsonResponse(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) request.destroy(new Error('Dados excederam o limite permitido.'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Dados inválidos.')); }
    });
    request.on('error', reject);
  });
}

async function handleOrderRequest(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') return jsonResponse(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/orders') return jsonResponse(response, 200, readOrdersFile());

    if (request.method === 'POST' && url.pathname === '/orders') {
      const order = await readJsonBody(request);
      if (!order?.id) return jsonResponse(response, 400, { error: 'Encomenda inválida.' });
      const orders = readOrdersFile().filter(item => item.id !== order.id);
      writeOrdersFile([order, ...orders]);
      return jsonResponse(response, 200, order);
    }

    if (request.method === 'POST' && url.pathname === '/orders/import') {
      const body = await readJsonBody(request);
      const current = readOrdersFile();
      const merged = [...(Array.isArray(body.orders) ? body.orders : []), ...current]
        .filter((order, index, all) => order?.id && all.findIndex(item => item.id === order.id) === index);
      writeOrdersFile(merged);
      return jsonResponse(response, 200, merged);
    }

    const statusMatch = url.pathname.match(/^\/orders\/([^/]+)\/status$/);
    if (request.method === 'PATCH' && statusMatch) {
      const body = await readJsonBody(request);
      const id = decodeURIComponent(statusMatch[1]);
      const orders = readOrdersFile().map(order => order.id === id ? { ...order, status: body.status } : order);
      writeOrdersFile(orders);
      return jsonResponse(response, 200, { ok: true });
    }

    const deleteMatch = url.pathname.match(/^\/orders\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteMatch) {
      const id = decodeURIComponent(deleteMatch[1]);
      writeOrdersFile(readOrdersFile().filter(order => order.id !== id));
      return jsonResponse(response, 200, { ok: true });
    }
    return jsonResponse(response, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    return jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function stopOrderServer() {
  if (orderServer) orderServer.close();
  orderServer = undefined;
}

function startOrderServer(config = readNetworkConfig()) {
  stopOrderServer();
  if (config.mode !== 'host') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleOrderRequest);
    server.once('error', reject);
    server.listen(config.port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      server.on('error', error => writePrintLog(`ERRO NO SERVIDOR DE ENCOMENDAS: ${error.message}`));
      orderServer = server;
      resolve();
    });
  });
}

async function remoteOrderRequest(config, route, options = {}) {
  const response = await fetch(`http://${config.serverIp}:${config.port}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Falha de comunicação (${response.status}).`);
  return body;
}

function ordersOperation(localOperation, remoteRoute, remoteOptions) {
  const config = readNetworkConfig();
  if (config.mode === 'client') return remoteOrderRequest(config, remoteRoute, remoteOptions);
  return Promise.resolve(localOperation());
}

ipcMain.handle('get-network-config', async () => ({ ...readNetworkConfig(), localIps: localIpv4Addresses() }));

ipcMain.handle('save-network-config', async (_event, payload) => {
  const mode = ['local', 'host', 'client'].includes(payload?.mode) ? payload.mode : 'local';
  const port = Number(payload?.port || ORDER_SERVER_PORT);
  const serverIp = String(payload?.serverIp || '').trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('A porta da sincronização é inválida.');
  if (mode === 'client') {
    if (!net.isIP(serverIp)) throw new Error('Informe o IP do computador principal.');
    await remoteOrderRequest({ serverIp, port }, '/health');
    const localOrders = readOrdersFile();
    if (localOrders.length) await remoteOrderRequest({ serverIp, port }, '/orders/import', { method: 'POST', body: JSON.stringify({ orders: localOrders }) });
  }
  const config = { mode, serverIp, port };
  fs.writeFileSync(networkConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  await startOrderServer(config);
  return { ...config, localIps: localIpv4Addresses() };
});

ipcMain.handle('orders-list', () => ordersOperation(readOrdersFile, '/orders'));
ipcMain.handle('orders-save', (_event, order) => ordersOperation(() => {
  const orders = readOrdersFile().filter(item => item.id !== order.id);
  writeOrdersFile([order, ...orders]);
  return order;
}, '/orders', { method: 'POST', body: JSON.stringify(order) }));
ipcMain.handle('orders-import', (_event, orders) => ordersOperation(() => {
  const current = readOrdersFile();
  const merged = [...(Array.isArray(orders) ? orders : []), ...current]
    .filter((order, index, all) => order?.id && all.findIndex(item => item.id === order.id) === index);
  writeOrdersFile(merged);
  return merged;
}, '/orders/import', { method: 'POST', body: JSON.stringify({ orders }) }));
ipcMain.handle('orders-status', (_event, { id, status }) => ordersOperation(() => {
  writeOrdersFile(readOrdersFile().map(order => order.id === id ? { ...order, status } : order));
  return { ok: true };
}, `/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }));
ipcMain.handle('orders-delete', (_event, id) => ordersOperation(() => {
  writeOrdersFile(readOrdersFile().filter(order => order.id !== id));
  return { ok: true };
}, `/orders/${encodeURIComponent(id)}`, { method: 'DELETE' }));

function sendToNetworkPrinter(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`A impressora não respondeu em ${host}:${port}. Confira o IP, o cabo de rede e se ambos estão na mesma rede.`));
    }, 8000);

    socket.once('connect', () => {
      socket.write(data, error => {
        if (error) return;
        socket.end();
      });
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível conectar à impressora em ${host}:${port}: ${error.message}`));
    });
    socket.once('close', hadError => {
      clearTimeout(timer);
      if (!hadError) resolve();
    });
  });
}

function checkNetworkPrinter(host, port) {
  return new Promise((resolve, reject) => {
    if (!net.isIP(host)) return reject(new Error('Informe um IP válido para a impressora.'));
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Nenhuma impressora respondeu em ${host}:${port}.`));
    }, 4000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ reachable: true });
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível localizar a impressora em ${host}:${port}: ${error.message}`));
    });
  });
}

ipcMain.handle('list-printers', async event => {
  const printers = await event.sender.getPrintersAsync();
  return printers.map(({ name, displayName, isDefault }) => ({
    name,
    displayName: displayName || name,
    isDefault: Boolean(isDefault),
  }));
});

ipcMain.handle('check-network-printer', async (_event, payload) => {
  const host = String(payload?.printerIp || '').trim();
  const port = Number(payload?.printerPort || 9100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A porta da impressora é inválida.');
  return checkNetworkPrinter(host, port);
});

ipcMain.handle('print-receipt', async (event, payload) => {
  let rawFile;
  try {
    const mode = payload?.mode === 'network' ? 'network' : 'windows';
    const requestedName = String(payload?.printerName || '');
    const rawData = String(payload?.rawData || '');
    if (!rawData) throw new Error('Os dados da encomenda não foram recebidos.');
    const data = Buffer.from(rawData, 'base64');

    if (mode === 'network') {
      const printerIp = String(payload?.printerIp || '').trim();
      const printerPort = Number(payload?.printerPort || 9100);
      if (!net.isIP(printerIp)) throw new Error('Informe um IP válido para a impressora, por exemplo 192.168.50.217.');
      if (!Number.isInteger(printerPort) || printerPort < 1 || printerPort > 65535) throw new Error('A porta da impressora é inválida. Use 9100, salvo indicação diferente do fabricante.');
      writePrintLog(`Enviando por rede para ${printerIp}:${printerPort}`);
      await sendToNetworkPrinter(printerIp, printerPort, data);
      writePrintLog('Pedido enviado diretamente para a impressora de rede.');
      return;
    }

    const printers = await event.sender.getPrintersAsync();
    const wanted = requestedName.trim().toLowerCase();
    const exact = wanted && printers.find(({ name, displayName }) =>
      name.toLowerCase() === wanted || String(displayName || '').toLowerCase() === wanted
    );
    const likelyThermal = printers.find(({ name, displayName }) =>
      /(?:elgin|pos|thermal|receipt|cupom|80)/i.test(`${name} ${displayName || ''}`)
    );
    const printer = exact || likelyThermal || printers.find(({ isDefault }) => isDefault);
    if (!printer) throw new Error('Nenhuma impressora foi encontrada no Windows. Instale o driver USB e escolha a fila nas configurações do aplicativo.');

    writePrintLog(`Impressora selecionada: ${printer.name}`);
    rawFile = path.join(os.tmpdir(), `araujo-encomendas-${process.pid}-${Date.now()}.bin`);
    fs.writeFileSync(rawFile, data);
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try { await startOrderServer(); } catch (error) { writePrintLog(`ERRO AO INICIAR SINCRONIZAÇÃO: ${error.message}`); }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { stopOrderServer(); if (process.platform !== 'darwin') app.quit(); });

