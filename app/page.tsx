'use client';

import { FormEvent, useEffect, useState } from 'react';
import { deleteOrder, loadOrders, persistOrder, updateOrderStatus, type Item, type OrderStatus, type SavedOrder } from '@/lib/orders';
import { buildEscPosOrder } from '@/lib/printer';
const emptyItem = (id:number):Item => ({ id, quantity:'1', description:'' });
type PrinterMode = 'windows' | 'network';
type PrinterInfo = { name:string; displayName:string; isDefault:boolean };
type PrinterConfig = { mode:PrinterMode; printerName:string; printerIp:string; printerPort:number };
type NetworkMode = 'local' | 'host' | 'client';
type NetworkConfig = { mode:NetworkMode; serverIp:string; port:number; localIps:string[] };
const defaultPrinterConfig:PrinterConfig = { mode:'windows', printerName:'', printerIp:'192.168.50.217', printerPort:9100 };
const defaultNetworkConfig:NetworkConfig = { mode:'local', serverIp:'', port:37842, localIps:[] };

export default function Home() {
  const [items, setItems] = useState<Item[]>([emptyItem(1)]);
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [orderType, setOrderType] = useState('Retirada');
  const [feedback, setFeedback] = useState('');
  const [now, setNow] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [printTest, setPrintTest] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [printerConfig, setPrinterConfig] = useState<PrinterConfig>(defaultPrinterConfig);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig>(defaultNetworkConfig);

  useEffect(() => {
    queueMicrotask(() => {
      setNow(new Date().toLocaleString('pt-BR'));
      const localOrders = loadOrders();
      if (!window.electronAPI?.listOrders) setOrders(localOrders);
      else window.electronAPI.importOrders(localOrders).then(setOrders).catch(() => setOrders(localOrders));
      try {
        const saved = localStorage.getItem('araujo-printer-config');
        if (saved) setPrinterConfig({ ...defaultPrinterConfig, ...JSON.parse(saved) });
      } catch { /* mantém a configuração padrão */ }
    });
    window.electronAPI?.listPrinters?.().then(setPrinters).catch(() => setPrinters([]));
    window.electronAPI?.getNetworkConfig?.().then(setNetworkConfig).catch(() => undefined);
    const timer = window.setInterval(() => {
      window.electronAPI?.listOrders?.().then(setOrders).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const openHelp = (event:KeyboardEvent) => { if (event.key === 'F1') { event.preventDefault(); setHelpOpen(true); } if (event.key === 'Escape') setHelpOpen(false); };
    window.addEventListener('keydown', openHelp);
    return () => window.removeEventListener('keydown', openHelp);
  }, []);
  const filledItems = items.filter(i => i.description);
  function updateItem(id:number, field:keyof Item, value:string) { setItems(current => current.map(item => item.id === id ? { ...item, [field]:value } : item)); }
  function addItem() { setItems(current => [...current, emptyItem(Date.now())]); }
  function removeItem(id:number) { setItems(current => current.length === 1 ? current : current.filter(item => item.id !== id)); }
  async function saveOrder(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const order:SavedOrder = { id:String(Date.now()), customer:String(data.get('customer')||''), phone:String(data.get('phone')||''), deliveryDate:String(data.get('deliveryDate')||''), deliveryTime:String(data.get('deliveryTime')||''), orderType, address:String(data.get('address')||''), notes:String(data.get('notes')||''), attendant:String(data.get('attendant')||''), signalPayment:String(data.get('signalPayment')||''), signalValue:String(data.get('signalValue')||''), items, createdAt:new Date().toISOString(), status:'pending' };
    try { const saved=window.electronAPI?.saveOrder?await window.electronAPI.saveOrder(order):persistOrder(order);setOrders(current=>[saved,...current.filter(item=>item.id!==saved.id)]);setNow(new Date().toLocaleString('pt-BR'));setFeedback(networkConfig.mode==='local'?'Encomenda salva neste computador.':'Encomenda sincronizada na rede.');setTimeout(()=>setFeedback(''),3000); } catch(error) { alert(error instanceof Error?error.message:'Não foi possível salvar a encomenda compartilhada.'); }
  }
  async function changeStatus(id:string,status:OrderStatus) { setOrders(current=>current.map(order=>order.id===id?{...order,status}:order));try{if(window.electronAPI?.updateOrderStatus)await window.electronAPI.updateOrderStatus({id,status});else updateOrderStatus(id,status);}catch(error){alert(error instanceof Error?error.message:'Não foi possível atualizar o status.');} }
  async function removeSavedOrder(order:SavedOrder) { if(!confirm(`Excluir definitivamente a encomenda de ${order.customer}?\n\nUse esta opção somente quando o cliente desistir ou o pedido tiver sido criado por engano.`))return;try{if(window.electronAPI?.deleteOrder)await window.electronAPI.deleteOrder(order.id);else deleteOrder(order.id);setOrders(current=>current.filter(item=>item.id!==order.id));}catch(error){alert(error instanceof Error?error.message:'Não foi possível excluir a encomenda.');} }
  async function printOrder() {
    const form = document.querySelector('form');
    if (!form?.reportValidity()) return;
    setPrintTest(false);
    setNow(new Date().toLocaleString('pt-BR'));
    if (!window.electronAPI?.printReceipt) {
      setTimeout(() => window.print(), 50);
      return;
    }
    try {
      const rawData = buildEscPosOrder(new FormData(form), items, orderType);
      await window.electronAPI.printReceipt({ ...printerConfig, rawData });
      setFeedback(printerConfig.mode === 'network' ? `Encomenda enviada para ${printerConfig.printerIp}.` : 'Encomenda enviada para a impressora USB.');
      setTimeout(() => setFeedback(''), 3000);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Não foi possível imprimir a encomenda.');
    }
  }
  function printCalibration() { setPrintTest(true); setHelpOpen(false); setTimeout(() => { window.print(); setPrintTest(false); },100); }
  function newOrder() { document.querySelector('form')?.reset(); setItems([emptyItem(Date.now())]); setOrderType('Retirada'); setFeedback('Nova ficha pronta.'); }
  async function savePrinterConfig(config:PrinterConfig) {
    try {
      if (config.mode === 'network') await window.electronAPI?.checkNetworkPrinter({ printerIp:config.printerIp, printerPort:config.printerPort });
      setPrinterConfig(config);
      localStorage.setItem('araujo-printer-config', JSON.stringify(config));
      setHelpOpen(false);
      setFeedback(config.mode === 'network' ? 'Impressora localizada na rede e configuração salva.' : 'Configuração da impressora salva.');
      setTimeout(()=>setFeedback(''),3000);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Não foi possível localizar a impressora na rede.');
    }
  }
  async function saveNetworkConfig(config:Omit<NetworkConfig,'localIps'>) {
    try { const saved=await window.electronAPI?.saveNetworkConfig(config);if(saved)setNetworkConfig(saved);setNetworkOpen(false);setFeedback(config.mode==='local'?'Modo somente neste computador ativado.':'Sincronização entre computadores ativada.');setTimeout(()=>setFeedback(''),3000); }
    catch(error){alert(error instanceof Error?error.message:'Não foi possível conectar os computadores.');}
  }
  const today = new Date().toISOString().slice(0,10);

  return <main>
    <header className="topbar no-print"><div className="brand"><div className="brand-mark">A</div><div><strong>Araújo</strong><span>Padaria & Pizzaria</span></div></div><div className="top-actions"><button className="ghost" type="button" onClick={()=>setNetworkOpen(true)}>⌁ Rede</button><button className="ghost" type="button" onClick={()=>setManagerOpen(true)}>▤ Encomendas</button><button className="ghost" type="button" onClick={newOrder}>＋ Nova encomenda</button><button className="print-button" type="button" onClick={printOrder}>▣ Imprimir pedido</button></div></header>
    <form onSubmit={saveOrder}>
      <section className="intro no-print"><div><p className="eyebrow">Gerenciador de encomendas</p><h1>Nova encomenda</h1><p>Preencha os dados abaixo. A ficha será preparada para impressão em bobina de 80 mm.</p></div><button type="button" className="status-dot" onClick={()=>setHelpOpen(true)}><span /> {printerConfig.mode==='network'?`Rede · ${printerConfig.printerIp}`:(printerConfig.printerName||'USB · seleção automática')}</button></section>
      <div className="workspace no-print"><div className="form-column">
        <section className="card"><Title n="1" title="Cliente" subtitle="Quem fez a encomenda?"/><div className="grid two"><label>Nome do cliente *<input name="customer" placeholder="Ex.: Katharine" required autoFocus /></label><label>Telefone / WhatsApp *<input name="phone" type="tel" placeholder="(00) 00000-0000" required /></label></div></section>
        <section className="card"><Title n="2" title="Entrega" subtitle="Quando e como o pedido será recebido?"/><div className="grid three"><label>Data *<input name="deliveryDate" type="date" min={today} required /></label><label>Horário *<input name="deliveryTime" type="time" required /></label><fieldset><legend>Tipo *</legend><div className="segmented"><button type="button" className={orderType==='Retirada'?'active':''} onClick={()=>setOrderType('Retirada')}>Retirada</button><button type="button" className={orderType==='Entrega'?'active':''} onClick={()=>setOrderType('Entrega')}>Entrega</button></div></fieldset></div>{orderType==='Entrega'&&<label className="full">Endereço para entrega *<input name="address" placeholder="Rua, número e referência" required /></label>}</section>
        <section className="card"><Title n="3" title="Itens do pedido" subtitle="Informe a quantidade e a descrição para a produção."/><div className="item-labels"><span>Qtd.</span><span>Descrição</span><span /></div><div className="items">{items.map((item,index)=><div className="item-row" key={item.id}><input aria-label={`Quantidade do item ${index+1}`} value={item.quantity} onChange={e=>updateItem(item.id,'quantity',e.target.value)} required/><input aria-label={`Descrição do item ${index+1}`} value={item.description} onChange={e=>updateItem(item.id,'description',e.target.value)} placeholder="Ex.: Mini salgados variados" required/><button type="button" aria-label="Remover item" className="remove" onClick={()=>removeItem(item.id)}>×</button></div>)}</div><button type="button" className="add-item" onClick={addItem}>＋ Adicionar outro item</button></section>
        <section className="card"><Title n="4" title="Detalhes finais" subtitle="Sinal recebido e informações importantes para a produção."/><label>Observações<textarea name="notes" rows={4} placeholder="Ex.: separar sabores, embalagem especial, ponto de referência..." /></label><div className="grid three final-fields"><label>Forma de pagamento do sinal *<select name="signalPayment" defaultValue="" required><option value="" disabled>Selecione</option><option>Dinheiro</option><option>Pix</option><option>Débito</option><option>Crédito</option><option>Voucher</option></select></label><label>Valor pago de sinal *<div className="signal-input"><span>R$</span><input name="signalValue" inputMode="decimal" placeholder="0,00" required /></div></label><label>Responsável pelo atendimento<input name="attendant" placeholder="Nome do atendente" /></label></div></section>
      </div><aside className="side-column"><div className="summary-card"><p className="eyebrow">Resumo</p><h3>{filledItems.length} {filledItems.length===1?'item':'itens'}</h3><div><span>Tipo</span><strong>{orderType}</strong></div><button className="save-button" type="submit">Salvar encomenda</button><button className="outline-button" type="button" onClick={printOrder}>Imprimir em 80 mm</button>{feedback&&<p className="feedback">✓ {feedback}</p>}</div><div className="tip"><strong>Impressora</strong><p>{printerConfig.mode==='network'?`Conexão direta: ${printerConfig.printerIp}:${printerConfig.printerPort}`:`Fila USB: ${printerConfig.printerName||'seleção automática'}`}</p><button type="button" onClick={()=>setHelpOpen(true)}>Configurar impressora →</button></div><div className="recent"><h3>Recentes neste computador</h3>{orders.slice(0,3).map(order=><div key={order.id}><strong>{order.customer}</strong><span>{formatDate(order.deliveryDate)}</span></div>)}{orders.length===0&&<p>Nenhuma encomenda salva.</p>}<button type="button" onClick={()=>setManagerOpen(true)}>Ver e gerenciar todas →</button></div></aside></div>
      {!printTest&&<Receipt items={filledItems} orderType={orderType} now={now}/>} {printTest&&<CalibrationReceipt/>}
    </form><ReceiptSync orderType={orderType}/>
    {helpOpen&&<PrinterPanel config={printerConfig} printers={printers} onClose={()=>setHelpOpen(false)} onSave={savePrinterConfig} onTest={printCalibration}/>}
    {managerOpen&&<ManagerPanel orders={orders} onClose={()=>setManagerOpen(false)} onStatus={changeStatus} onDelete={removeSavedOrder}/>}
    {networkOpen&&<NetworkPanel config={networkConfig} onClose={()=>setNetworkOpen(false)} onSave={saveNetworkConfig}/>}
  </main>;
}

function localDateKey() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function formatDate(value:string) { if(!value)return 'Sem data'; return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR'); }
function ManagerPanel({orders,onClose,onStatus,onDelete}:{orders:SavedOrder[],onClose:()=>void,onStatus:(id:string,status:OrderStatus)=>void,onDelete:(order:SavedOrder)=>void}) {
  const [filter,setFilter]=useState<'today'|'upcoming'|'all'>('today'); const [search,setSearch]=useState(''); const today=localDateKey();
  const filtered=orders.filter(order=>{const matchesFilter=filter==='today'?order.deliveryDate===today:filter==='upcoming'?order.deliveryDate>=today&&order.status!=='delivered':true;const term=search.toLocaleLowerCase('pt-BR');return matchesFilter&&(!term||order.customer.toLocaleLowerCase('pt-BR').includes(term)||order.phone.includes(term));}).sort((a,b)=>`${a.deliveryDate}${a.deliveryTime}`.localeCompare(`${b.deliveryDate}${b.deliveryTime}`));
  const todayCount=orders.filter(o=>o.deliveryDate===today&&o.status!=='delivered').length; const production=orders.filter(o=>o.status==='production').length; const ready=orders.filter(o=>o.status==='ready').length;
  return <div className="manager-overlay no-print" role="dialog" aria-modal="true"><section className="manager-panel"><header><div><p className="eyebrow">Painel de produção</p><h2>Encomendas</h2><p>Armazenadas somente neste computador</p></div><div><button className="close-manager" onClick={onClose} aria-label="Fechar">×</button></div></header><div className="manager-stats"><div><span>Para hoje</span><b>{todayCount}</b></div><div><span>Em produção</span><b>{production}</b></div><div><span>Prontas</span><b>{ready}</b></div></div><div className="manager-tools"><div className="filter-tabs"><button className={filter==='today'?'active':''} onClick={()=>setFilter('today')}>Hoje</button><button className={filter==='upcoming'?'active':''} onClick={()=>setFilter('upcoming')}>Próximas</button><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Todas</button></div><input aria-label="Buscar encomendas" placeholder="Buscar cliente ou telefone" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="order-list">{filtered.map(order=><article className="order-card" key={order.id}><div className="order-when"><b>{order.deliveryTime.slice(0,5)}</b><span>{formatDate(order.deliveryDate)}</span><em>{order.orderType}</em></div><div className="order-main"><h3>{order.customer}</h3><p>{order.phone}</p><ul>{order.items.map(item=><li key={item.id}><b>{item.quantity}x</b> {item.description}</li>)}</ul>{order.notes&&<p className="order-note">Obs.: {order.notes}</p>}</div><div className="order-status"><label>Status<select value={order.status} onChange={e=>onStatus(order.id,e.target.value as OrderStatus)} className={`status-${order.status}`}><option value="pending">Pendente</option><option value="production">Em produção</option><option value="ready">Pronto</option><option value="delivered">Entregue</option></select></label><span>Sinal: {order.signalPayment}<br/>R$ {order.signalValue}</span><button className="delete-order" type="button" onClick={()=>onDelete(order)}>Excluir encomenda</button></div></article>)}{filtered.length===0&&<div className="empty-orders"><b>Nenhuma encomenda aqui.</b><p>Tente outro filtro ou registre um novo pedido.</p></div>}</div></section></div>;
}

function Title({n,title,subtitle}:{n:string,title:string,subtitle:string}) { return <div className="section-title"><span>{n}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>; }
function NetworkPanel({config,onClose,onSave}:{config:NetworkConfig;onClose:()=>void;onSave:(config:Omit<NetworkConfig,'localIps'>)=>void|Promise<void>}) {
  const [draft,setDraft]=useState({mode:config.mode,serverIp:config.serverIp,port:config.port});
  const principalIp=config.localIps.find(ip=>ip.startsWith('192.168.50.'))||config.localIps[0]||'IP não identificado';
  return <div className="help-overlay no-print" role="dialog" aria-modal="true" aria-labelledby="network-title" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="help-panel"><header><div><p className="eyebrow">Dados compartilhados</p><h2 id="network-title">Sincronização entre computadores</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><div className="printer-mode network-modes"><button type="button" className={draft.mode==='local'?'active':''} onClick={()=>setDraft({...draft,mode:'local'})}>Somente este PC</button><button type="button" className={draft.mode==='host'?'active':''} onClick={()=>setDraft({...draft,mode:'host'})}>PC principal</button><button type="button" className={draft.mode==='client'?'active':''} onClick={()=>setDraft({...draft,mode:'client'})}>PC secundário</button></div>{draft.mode==='host'&&<div className="network-guide"><strong>Endereço deste computador</strong><b>{principalIp}</b><p>Deixe este computador ligado e com o aplicativo aberto. No outro computador, informe este endereço.</p></div>}{draft.mode==='client'&&<div className="printer-network"><label>IP do computador principal<input value={draft.serverIp} onChange={e=>setDraft({...draft,serverIp:e.target.value.trim()})} placeholder="192.168.50.135"/></label><label>Porta<input type="number" value={draft.port} onChange={e=>setDraft({...draft,port:Number(e.target.value)})}/></label><small>Ao salvar, o aplicativo testa a conexão antes de ativar a sincronização.</small></div>}{draft.mode==='local'&&<div className="printer-badge"><strong>Dados separados</strong><span>As encomendas serão guardadas apenas nesta máquina.</span></div>}<h3>Como configurar</h3><ol><li>No computador que ficará sempre ligado, escolha <b>PC principal</b>.</li><li>No segundo computador, escolha <b>PC secundário</b> e digite o IP mostrado pelo principal.</li><li>As listas serão atualizadas automaticamente a cada poucos segundos.</li></ol><div className="help-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button type="button" className="save-button" onClick={()=>onSave(draft)}>Salvar e testar</button></div></section></div>;
}
function PrinterPanel({config,printers,onClose,onSave,onTest}:{config:PrinterConfig;printers:PrinterInfo[];onClose:()=>void;onSave:(config:PrinterConfig)=>void|Promise<void>;onTest:()=>void}) {
  const [draft,setDraft]=useState(config);
  return <div className="help-overlay no-print" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="help-panel"><header><div><p className="eyebrow">Configuração da impressora</p><h2 id="help-title">Impressora térmica · 80 mm</h2></div><button type="button" onClick={onClose} aria-label="Fechar ajuda">×</button></header><div className="printer-badge"><strong>Compatível com USB e Ethernet</strong><span>Escolha como esta impressora está ligada ao computador ou à rede.</span></div><div className="printer-mode"><button type="button" className={draft.mode==='windows'?'active':''} onClick={()=>setDraft({...draft,mode:'windows'})}>USB / Windows</button><button type="button" className={draft.mode==='network'?'active':''} onClick={()=>setDraft({...draft,mode:'network'})}>Rede / IP</button></div>{draft.mode==='windows'?<label className="printer-field">Fila da impressora no Windows<select value={draft.printerName} onChange={e=>setDraft({...draft,printerName:e.target.value})}><option value="">Detectar automaticamente</option>{printers.map(printer=><option value={printer.name} key={printer.name}>{printer.displayName}{printer.isDefault?' (padrão)':''}</option>)}</select><small>Use este modo quando o cabo USB estiver conectado neste computador.</small></label>:<div className="printer-network"><label>IP da impressora<input value={draft.printerIp} onChange={e=>setDraft({...draft,printerIp:e.target.value.trim()})} placeholder="192.168.50.217"/></label><label>Porta<input type="number" value={draft.printerPort} onChange={e=>setDraft({...draft,printerPort:Number(e.target.value)})}/></label><small>A impressora precisa estar ligada ao roteador por cabo de rede e no mesmo endereço de rede dos computadores. Porta padrão ESC/POS: 9100.</small></div>}<h3>Importante</h3><ol><li>No modo USB, instale o <b>driver USB</b>; o driver de rede não substitui essa fila.</li><li>No modo Rede, conecte também o cabo Ethernet e dê à impressora um IP da mesma faixa do computador.</li><li>O aplicativo envia a ficha diretamente, sem abrir a janela de confirmação.</li></ol><div className="help-actions"><button type="button" className="outline-button" onClick={onTest}>Teste visual</button><button type="button" className="save-button" onClick={()=>onSave(draft)}>Salvar configuração</button></div><p className="help-note">Dica: pressione F1 a qualquer momento para abrir este painel.</p></section></div>;
}
function CalibrationReceipt() { return <section className="receipt calibration print-only"><header><div className="receipt-logo">TESTE 80 MM</div><strong>ELGIN i8 · ÁREA ÚTIL 72 MM</strong></header><div className="edge-line"><span>← BORDA ESQUERDA</span><span>BORDA DIREITA →</span></div><div className="calibration-box"><b>Se este retângulo sair inteiro, sem cortar as laterais, a largura está correta.</b><p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p><p>0123456789 · 0123456789</p></div><h2>CONFIGURAÇÃO ESPERADA</h2><div className="receipt-row"><span>Papel</span><b>80 mm</b></div><div className="receipt-row"><span>Escala</span><b>100%</b></div><div className="receipt-row"><span>Margens</span><b>Nenhuma</b></div><div className="receipt-row"><span>Orientação</span><b>Retrato</b></div><div className="receipt-rule"/><p className="calibration-tip">Se alguma lateral for cortada, tente escala 95% na janela de impressão.</p></section>; }
function Receipt({items,orderType,now}:{items:Item[],orderType:string,now:string}) { return <section className="receipt print-only"><header><div className="receipt-logo">ARAÚJO</div><strong>PADARIA & PIZZARIA</strong><p>PEDIDO DE PRODUÇÃO</p></header><div className="receipt-rule"/><div className="receipt-row"><span>Emissão:</span><b>{now}</b></div><div className="receipt-highlight"><span>CLIENTE</span><b data-field="customer"/></div><div className="receipt-row"><span>Telefone:</span><b data-field="phone"/></div><div className="receipt-highlight schedule"><span>{orderType.toUpperCase()}</span><b><i data-date/> às <i data-time/></b></div>{orderType==='Entrega'&&<div className="receipt-block"><span>ENDEREÇO</span><b data-field="address"/></div>}<div className="receipt-rule solid"/><h2 className="items-title">ITENS DO PEDIDO</h2><div className="receipt-items">{items.map(item=><div key={item.id}><span><b>{item.quantity}x</b> {item.description}</span></div>)}</div><div className="receipt-block"><span>OBSERVAÇÕES</span><b data-field="notes">—</b></div><div className="receipt-rule"/><div className="receipt-row"><span>Sinal:</span><b><i data-field="signalPayment"/> — R$ <i data-field="signalValue"/></b></div><div className="signature">Responsável: <b data-field="attendant"/></div></section>; }
function ReceiptSync({orderType}:{orderType:string}) { useEffect(()=>{ const sync=()=>{ const form=document.querySelector('form'); if(!form)return; const data=new FormData(form); document.querySelectorAll<HTMLElement>('[data-field]').forEach(el=>{const key=el.dataset.field||'';const value=String(data.get(key)||'');el.textContent=value||(key==='notes'?'—':'');}); const raw=String(data.get('deliveryDate')||''); const d=document.querySelector<HTMLElement>('[data-date]');if(d)d.textContent=raw?new Date(`${raw}T12:00:00`).toLocaleDateString('pt-BR'):'';const t=document.querySelector<HTMLElement>('[data-time]');if(t)t.textContent=String(data.get('deliveryTime')||'');};document.addEventListener('input',sync);document.addEventListener('change',sync);sync();return()=>{document.removeEventListener('input',sync);document.removeEventListener('change',sync);};},[orderType]);return null; }

