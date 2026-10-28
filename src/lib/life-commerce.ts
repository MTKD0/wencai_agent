export type LifeDelivery = { recipient: string; phone: string; address: string; mode: 'immediate' | 'scheduled'; arriveAt?: string }
export type LifeOrder = {
  id:string; productId:string; productName:string; quantity:number; amount:number; status:'paid'|'shipped'|'delivered'|'return_requested'|'refunded';
  cardLast4:string; delivery:LifeDelivery; createdAt:string; dispatchAt:string; deliveryAt:string; refundDeadline:string;
  refundDueAt:string|null; refundedAt:string|null; refundReason:string|null; canRefund:boolean; logistics:string;
}
export type LifeSubscription = { id:string; merchant:string; amount:number; cycle:'monthly'|'yearly'; status:'active'|'cancelled'; productId?:string; cardLast4?:string; periodEnd?:string; nextChargeAt?:string|null; renewalsLeft?:number; renewalStatus?:string; serviceStatus?:'active'|'expired' }
/** 常用收货地址（本人可见完整手机号；交给模型时手机号脱敏） */
export type SavedAddress = { id:string; label:string; recipient:string; phone:string; address:string; isDefault:boolean }
export type LifeCommerceData = { orders:LifeOrder[]; subscriptions:LifeSubscription[]; addresses:SavedAddress[]; serverNow:string }
export const LIFE_ORDER_STATUS = { paid:'已付款 · 待发货', shipped:'运输中', delivered:'已签收', return_requested:'退货处理中', refunded:'已退款' }
export const lifeTime = (value:string) => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
