export type Item = { id:number; quantity:string; description:string };
export type OrderStatus = 'pending' | 'production' | 'ready' | 'delivered';
export type SavedOrder = {
  id:string; customer:string; phone:string; deliveryDate:string; deliveryTime:string;
  orderType:string; address:string; notes:string; attendant:string; signalPayment:string;
  signalValue:string; items:Item[]; createdAt:string; status:OrderStatus;
};

function normalize(order:Partial<SavedOrder>):SavedOrder {
  return { id:order.id||String(Date.now()), customer:order.customer||'', phone:order.phone||'', deliveryDate:order.deliveryDate||'', deliveryTime:order.deliveryTime||'', orderType:order.orderType||'Retirada', address:order.address||'', notes:order.notes||'', attendant:order.attendant||'', signalPayment:order.signalPayment||'', signalValue:order.signalValue||'', items:order.items||[], createdAt:order.createdAt||new Date().toISOString(), status:order.status||'pending' };
}

export function loadOrders():SavedOrder[] {
  try { return (JSON.parse(localStorage.getItem('encomendas')||'[]') as Partial<SavedOrder>[]).map(normalize); } catch { return []; }
}
export function persistOrder(order:SavedOrder) { const current=loadOrders();localStorage.setItem('encomendas',JSON.stringify([order,...current]));return order; }
export function updateOrderStatus(id:string,status:OrderStatus) { const current=loadOrders();localStorage.setItem('encomendas',JSON.stringify(current.map(order=>order.id===id?{...order,status}:order))); }
export function deleteOrder(id:string) { const current=loadOrders();localStorage.setItem('encomendas',JSON.stringify(current.filter(order=>order.id!==id))); }

