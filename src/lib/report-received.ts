// src/lib/report-received.ts — "WE HAVE YOUR REPORT": the email a customer gets when their report (damaged, missing,
// wrong, never arrived) waits for the shop to decide (api/retail/claims). It's the Report received message in Client
// messages and the replies playbook (lib/replies AUTOMATIC_KINDS): on unless the shop turns it off, in the shop's own
// words when it wrote some. An approval made on the spot doesn't send it: its decision email says everything.
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';
import { gateMessage, renderMessage, MESSAGE_KIND_BY_ID } from '@/lib/message-policy';
import { sendNotification } from '@/lib/notify';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function tellReportReceived(db: any, tenantId: string, claim: any, origin?: string | null): Promise<{ sent: boolean; why?: string }> {
  const to = String(claim?.customerEmail || '').trim();
  if (!to.includes('@')) return { sent: false, why: 'no_email' };
  const brand = await getEmailBrand(db, tenantId);
  const first = String(claim?.customerName || '').trim().split(/\s+/)[0] || 'there';
  const num = String(claim?.orderNumber ?? '').padStart(4, '0');
  const item = String(claim?.lineName || '').trim() || 'your order';
  const base = String(origin || '').replace(/\/+$/, '');
  const link = /^https?:\/\//.test(base) && claim?.orderId ? `${base}/shop/${encodeURIComponent(tenantId)}/order/${encodeURIComponent(String(claim.orderId))}` : '';
  // On unless the shop turned it off. The shop's own wording, when it wrote some, is put in by the email sender
  // (lib/notify) with these details; {{link}} there becomes the button.
  const tokens = { client_first: first, order_number: num, item, link, studio: brand.shopName };
  const g = await gateMessage(db, tenantId, 'claim_received', { tokens });
  if (!g.send) return { sent: false, why: 'off' };
  const def = MESSAGE_KIND_BY_ID.claim_received;
  const builtIn = { ...tokens, link: '' };
  const body = renderMessage(def.defaultBody, builtIn);
  const subject = renderMessage(def.defaultSubject || '', builtIn) || `We have your report about order ${num}`;
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 10px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = brandedEmail(brand, `${paras}${link ? emailButton(link, 'View my order', brand) : ''}<p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${esc(brand.shopName)}</p>`,
    { preheader: 'We have your report and will look at it with the packing record.', title: 'We have your report', tag: `#${num}` });
  const r: any = await sendNotification(db, {
    tenantId, channel: 'email', to, subject, html, text: [body, link].filter(Boolean).join('\n\n'), tokens,
    kind: 'claim_received', recipientType: 'client', recipientId: claim?.orderId || null, recipientName: claim?.customerName || null,
  } as any);
  return { sent: !!r?.ok, why: r?.ok ? undefined : String(r?.error || r?.status || 'not sent') };
}
