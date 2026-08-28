const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printReceipt: (payload) => ipcRenderer.invoke('print-receipt', payload),
  openPrintLog: () => ipcRenderer.invoke('open-print-log'),
});
