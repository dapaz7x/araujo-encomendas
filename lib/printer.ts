import type { Item } from './orders';

declare global {
  interface Window {
    electronAPI?: {
      printReceipt: (payload: { mode: 'windows' | 'network'; printerName?: string; printerIp?: string; printerPort?: number; rawData: string }) => Promise<void>;
      listPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
      checkNetworkPrinter: (payload: { printerIp: string; printerPort: number }) => Promise<{ reachable: boolean }>;
      getNetworkConfig: () => Promise<{ mode:'local'|'host'|'client'; serverIp:string; port:number; localIps:string[] }>;
      saveNetworkConfig: (payload: { mode:'local'|'host'|'client'; serverIp:string; port:number }) => Promise<{ mode:'local'|'host'|'client'; serverIp:string; port:number; localIps:string[] }>;
      listOrders: () => Promise<import('./orders').SavedOrder[]>;
      saveOrder: (order: import('./orders').SavedOrder) => Promise<import('./orders').SavedOrder>;
      importOrders: (orders: import('./orders').SavedOrder[]) => Promise<import('./orders').SavedOrder[]>;
      updateOrderStatus: (payload: { id:string; status:import('./orders').OrderStatus }) => Promise<{ ok:boolean }>;
      deleteOrder: (id:string) => Promise<{ ok:boolean }>;
      openPrintLog: () => Promise<void>;
    };
  }
}

const ESC = 0x1b;
const GS = 0x1d;
const WIDTH = 42;

function ascii(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\n]/g, '');
}

function wrap(text: string, width = WIDTH) {
  const words = ascii(text).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  words.forEach(word => {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  });
  if (line) lines.push(line);
  return lines.length ? lines.join('\n') : '-';
}

function field(form: FormData, name: string) {
  return String(form.get(name) || '').trim();
}

function formatDeliveryDate(value: string) {
  if (!value) return '';
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
}

export function buildEscPosOrder(form: FormData, items: Item[], orderType: string) {
  const chunks: Array<number[] | string> = [];
  const push = (...values: Array<number[] | string>) => chunks.push(...values);
  const customer = field(form, 'customer').toUpperCase();
  const phone = field(form, 'phone');
  const date = formatDeliveryDate(field(form, 'deliveryDate'));
  const time = field(form, 'deliveryTime');
  const address = field(form, 'address').toUpperCase();
  const notes = field(form, 'notes').toUpperCase();
  const attendant = field(form, 'attendant').toUpperCase();
  const signalPayment = field(form, 'signalPayment').toUpperCase();
  const signalValue = field(form, 'signalValue');
  const emittedAt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  push(
    [ESC, 0x40], [ESC, 0x33, 0x2a], [ESC, 0x61, 0x01], [ESC, 0x45, 0x01],
    [GS, 0x21, 0x11], 'ARAUJO\n', [GS, 0x21, 0x00],
    'PADARIA & PIZZARIA\nPEDIDO DE PRODUCAO\n', [ESC, 0x45, 0x00],
    '------------------------------------------\n',
    [ESC, 0x61, 0x00], `EMISSAO: ${emittedAt}\n\n`,
    [ESC, 0x61, 0x01], [ESC, 0x45, 0x01], 'CLIENTE\n', [GS, 0x21, 0x11],
    `${wrap(customer, 21)}\n`, [GS, 0x21, 0x00],
    `TELEFONE: ${phone}\n\n`,
    [GS, 0x21, 0x11], `${orderType.toUpperCase()}\n`, [GS, 0x21, 0x00],
    `${date} AS ${time}\n`, [ESC, 0x45, 0x00]
  );

  if (orderType === 'Entrega' && address) {
    push('\n', [ESC, 0x61, 0x00], [ESC, 0x45, 0x01], 'ENDERECO:\n', [ESC, 0x45, 0x00], `${wrap(address)}\n`);
  }

  push(
    '\n==========================================\n',
    [ESC, 0x61, 0x01], [ESC, 0x45, 0x01], [GS, 0x21, 0x01],
    'ITENS DO PEDIDO\n', [GS, 0x21, 0x00], [ESC, 0x61, 0x00],
    '==========================================\n\n'
  );

  items.filter(item => item.description.trim()).forEach(item => {
    push(
      [ESC, 0x45, 0x01], [GS, 0x21, 0x01],
      `${wrap(`${item.quantity}X ${item.description.toUpperCase()}`)}\n`,
      [GS, 0x21, 0x00], [ESC, 0x45, 0x00], '\n'
    );
  });

  if (notes) {
    push(
      '------------------------------------------\n',
      [ESC, 0x45, 0x01], [GS, 0x21, 0x01], 'OBSERVACOES:\n',
      `${wrap(notes)}\n`, [GS, 0x21, 0x00], [ESC, 0x45, 0x00], '\n'
    );
  }

  push(
    '------------------------------------------\n',
    [ESC, 0x45, 0x01], `SINAL: ${signalPayment} - R$ ${signalValue}\n`, [ESC, 0x45, 0x00],
    '\nRESPONSAVEL:\n', [ESC, 0x45, 0x01], `${wrap(attendant || '-')}\n`, [ESC, 0x45, 0x00],
    [ESC, 0x64, 0x05], [GS, 0x56, 0x00]
  );

  const bytes: number[] = [];
  chunks.forEach(chunk => {
    if (typeof chunk === 'string') {
      const value = ascii(chunk);
      for (let i = 0; i < value.length; i += 1) bytes.push(value.charCodeAt(i));
    } else bytes.push(...chunk);
  });
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
