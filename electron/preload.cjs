const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printReceipt: (payload) => ipcRenderer.invoke('print-receipt', payload),
  listPrinters: () => ipcRenderer.invoke('list-printers'),
  checkNetworkPrinter: (payload) => ipcRenderer.invoke('check-network-printer', payload),
  getNetworkConfig: () => ipcRenderer.invoke('get-network-config'),
  saveNetworkConfig: (payload) => ipcRenderer.invoke('save-network-config', payload),
  listOrders: () => ipcRenderer.invoke('orders-list'),
  saveOrder: (order) => ipcRenderer.invoke('orders-save', order),
  importOrders: (orders) => ipcRenderer.invoke('orders-import', orders),
  updateOrderStatus: (payload) => ipcRenderer.invoke('orders-status', payload),
  deleteOrder: (id) => ipcRenderer.invoke('orders-delete', id),
  openPrintLog: () => ipcRenderer.invoke('open-print-log'),
});
