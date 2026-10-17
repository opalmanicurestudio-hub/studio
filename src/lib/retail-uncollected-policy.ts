// src/lib/retail-uncollected-policy.ts — THE RULES FOR PICKUPS NOBODY COLLECTED: when each reminder is due and what
// it says. Pure and safe to use on any screen; the sending lives in lib/retail-uncollected (server only).

export interface UncollectedPolicy { firstHours: number; secondHours: number; holdDays: number; after: 'refund' | 'credit' | 'keep' }
export const uncollectedPolicy = (rs: any): UncollectedPolicy => {
  const u = rs?.policies?.uncollected || {};
  const firstHours = Math.max(1, Number(u.firstHours) || 24);
  return { firstHours, secondHours: Math.max(firstHours + 1, Number(u.secondHours) || 72), holdDays: Math.max(1, Number(u.holdDays) || 7), after: u.after === 'credit' || u.after === 'keep' ? u.after : 'refund' };
};

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };

/** Which notice is due now: 0 none, 1 reminder, 2 second reminder, 3 last day. */
export function noticeDue(o: any, pol: UncollectedPolicy, now = Date.now()): 0 | 1 | 2 | 3 {
  if (o.stage !== 'ready' || o.method === 'ship' || o.isTest) return 0;
  const ready = ms(o.readyAt); if (!ready) return 0;
  const h = (now - ready) / 3600e3; const sent = Number(o.uncollectedNotices) || 0;
  const due = h >= (pol.holdDays * 24 - 24) && pol.holdDays * 24 - 24 > pol.secondHours ? 3 : h >= pol.secondHours ? 2 : h >= pol.firstHours ? 1 : 0;
  return (due > sent ? due : 0) as 0 | 1 | 2 | 3;
}

export function holdUntil(o: any, pol: UncollectedPolicy): Date { return new Date(ms(o.readyAt) + pol.holdDays * 86400e3); }

export function noticeText(step: 1 | 2 | 3, o: any, pol: UncollectedPolicy, shop: string): { sms: string; subject: string; title: string; body: string[] } {
  const first = String(o.customerName || '').split(' ')[0] || 'there';
  const until = holdUntil(o, pol).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const after = pol.after === 'credit' ? 'goes back on the shelf and we’ll give you store credit for it' : pol.after === 'refund' ? 'goes back on the shelf and we’ll refund you' : 'stays with us; reply if you’d like us to cancel it';
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  if (step === 1) return { sms: `your order ${num} is ready and waiting for you.`, subject: `${shop}: your order is waiting for you`, title: 'Your order is waiting for you', body: [`Hi ${first},`, `Just a reminder that your order ${num} is ready to collect.`, 'Bring the code from your order page, or just give your name at the counter.'] };
  if (step === 2) return { sms: `your order ${num} is still waiting. We’ll hold it until ${until}.`, subject: `${shop}: we’re holding your order until ${until}`, title: `We’re holding your order until ${until}`, body: [`Hi ${first},`, `Your order ${num} is still waiting for you. We’ll keep it safe until ${until}.`, 'If you can’t make it, reply and we’ll sort something out.'] };
  return { sms: `last day to collect order ${num}. After today it ${after}.`, subject: `${shop}: last day to collect your order`, title: 'Last day to collect your order', body: [`Hi ${first},`, `Today is the last day to collect your order ${num}. After today it ${after}.`, 'If you need a little longer, reply and let us know.'] };
}

