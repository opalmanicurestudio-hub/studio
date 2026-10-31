// src/lib/replies.ts — THE REPLIES PLAYBOOK (mockup 10G): one set of wording for the whole team, so a customer hears the
// same thing whoever answers. Ready replies are picked by a person, filled in from the order and editable before they
// go; nothing here sends on its own. (What does send on its own, the acknowledgments and updates, is the shop messages
// in lib/message-policy, with the business's own wording when it wrote some.)
//
// The built-in replies below are where every business starts. A business can reword one, hide one, or add its own;
// those are kept in tenants/{id}/replies, written only by the server (api/replies).

export type ReplySituation = 'claim_ask' | 'claim_decline' | 'message';
export type Reply = { id: string; situation: ReplySituation; name: string; text: string; builtIn: boolean; changed?: boolean; hidden?: boolean };

export const SITUATIONS: { id: ReplySituation; label: string; short: string }[] = [
  { id: 'claim_ask', label: 'Asking for something on a claim', short: 'Claims · ask' },
  { id: 'claim_decline', label: 'Declining a claim', short: 'Claims · decline' },
  { id: 'message', label: 'Replying to a message', short: 'Messages' },
];
export const isSituation = (v: unknown): v is ReplySituation => SITUATIONS.some((s) => s.id === v);

/** The details a reply can carry, in the same {{token}} form as the shop messages. */
export const REPLY_TOKENS: { token: string; key: string; label: string }[] = [
  { token: '{{client_first}}', key: 'client_first', label: 'first name' },
  { token: '{{order_number}}', key: 'order_number', label: 'order number' },
  { token: '{{item}}', key: 'item', label: 'item' },
  { token: '{{amount}}', key: 'amount', label: 'amount' },
  { token: '{{studio}}', key: 'studio', label: 'shop name' },
];
export type ReplyContext = Partial<Record<'client_first' | 'order_number' | 'item' | 'amount' | 'studio', string | null | undefined>>;
/** The details a reply of this kind can have: the amount only on a claim, where there is one. */
export const tokensFor = (situation: ReplySituation) => REPLY_TOKENS.filter((t) => t.key !== 'amount' || situation !== 'message');

export const REPLY_NAME_MAX = 60;
export const REPLY_TEXT_MAX = 800;
export const CUSTOM_REPLY_MAX = 60;
/** What one request for more on a claim can carry (api/retail/fulfil requestClaimInfo). */
export const ASK_TEXT_MAX = 400;

export const BUILT_IN_REPLIES: Omit<Reply, 'builtIn'>[] = [
  { id: 'b_photo_damage', situation: 'claim_ask', name: 'A photo of the damage', text: 'Could you send a close-up photo of the damage to {{item}}? You can add it on your order page.' },
  { id: 'b_photo_bag', situation: 'claim_ask', name: 'A photo of the bag it came in', text: 'Could you send a photo of everything that came in the bag, and the bag itself? You can add it on your order page.' },
  { id: 'b_batch_code', situation: 'claim_ask', name: 'The batch code', text: 'Could you send a photo of the batch code on {{item}}? It’s usually printed on the bottom or the back.' },
  { id: 'b_packing_photo', situation: 'claim_decline', name: 'Packing photo shows it', text: 'Our packing photo shows {{item}} in your bag, sealed. If you find it wasn’t there, reply with a photo of everything that came and we’ll look again.' },
  { id: 'b_past_window', situation: 'claim_decline', name: 'Past the claim window', text: 'Reports need to reach us within our claim window, and this one came in after it closed. If something else is wrong with your order, reply and we’ll help.' },
  { id: 'b_not_covered', situation: 'claim_decline', name: 'Not covered', text: 'This isn’t something our policy covers, so we can’t refund it. If you think we’ve got it wrong, you can ask us to look again from your order page.' },
  { id: 'b_looking', situation: 'message', name: 'Looking into it', text: 'Thanks, {{client_first}}. We’re looking into this now and will reply here.' },
  { id: 'b_someone_else', situation: 'message', name: 'Someone else picking up', text: 'Of course. Anyone with the code on your order page can collect order {{order_number}}, or you can add their name there.' },
  { id: 'b_running_late', situation: 'message', name: 'Running late', text: 'Sorry, order {{order_number}} is taking longer than we said. We’ll message you here as soon as it’s ready.' },
];
const BUILT_IN_BY_ID = new Map(BUILT_IN_REPLIES.map((r) => [r.id, r]));
export const isBuiltIn = (id: string) => BUILT_IN_BY_ID.has(id);

/** The playbook as the business has it: the built-in replies (reworded or hidden where it chose) and its own, in that
 *  order. `stored` is the replies collection. Hidden ones are left out unless asked for (the settings page shows them). */
export function playbook(stored: any[], o: { withHidden?: boolean } = {}): Reply[] {
  const byId = new Map<string, any>((Array.isArray(stored) ? stored : []).filter((d) => d && d.id).map((d) => [String(d.id), d]));
  const out: Reply[] = [];
  for (const b of BUILT_IN_REPLIES) {
    const s = byId.get(b.id);
    const name = s && typeof s.name === 'string' && s.name.trim() ? s.name.trim() : b.name;
    const text = s && typeof s.text === 'string' && s.text.trim() ? s.text.trim() : b.text;
    const r: Reply = { ...b, name, text, builtIn: true, changed: !!s && (name !== b.name || text !== b.text), hidden: s?.hidden === true };
    if (!r.hidden || o.withHidden) out.push(r);
  }
  const own = [...byId.values()].filter((d) => !isBuiltIn(String(d.id)) && isSituation(d.situation) && String(d.name || '').trim() && String(d.text || '').trim())
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const d of own) out.push({ id: String(d.id), situation: d.situation, name: String(d.name).trim(), text: String(d.text).trim(), builtIn: false });
  return out;
}
export const repliesFor = (stored: any[], situation: ReplySituation) => playbook(stored).filter((r) => r.situation === situation);

/** A reply filled in from the order. A detail the order doesn't have stays as [label], so the person sending sees the
 *  gap in the box before it goes. */
export function fillReply(text: string, ctx: ReplyContext): string {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => {
    const t = REPLY_TOKENS.find((x) => x.key === String(k).toLowerCase());
    if (!t) return '';
    const v = (ctx as any)[t.key];
    return v === null || v === undefined || String(v).trim() === '' ? `[${t.label}]` : String(v).trim();
  }).replace(/[ \t]{2,}/g, ' ').trim();
}
/** A filled reply that still has a gap to fill. */
export const hasGap = (text: string) => REPLY_TOKENS.some((t) => String(text || '').includes(`[${t.label}]`));

/** Checked when a reply is saved (api/replies). */
export function checkReply(r: { situation?: unknown; name?: unknown; text?: unknown }): { ok: true; situation: ReplySituation; name: string; text: string } | { ok: false; error: string } {
  if (!isSituation(r.situation)) return { ok: false, error: 'Pick when the reply is offered.' };
  const name = String(r.name ?? '').replace(/\s+/g, ' ').trim();
  const text = String(r.text ?? '').replace(/\r\n/g, '\n').trim();
  if (!name) return { ok: false, error: 'Give the reply a short name.' };
  if (name.length > REPLY_NAME_MAX) return { ok: false, error: `Keep the name under ${REPLY_NAME_MAX} characters.` };
  if (!text) return { ok: false, error: 'Write the reply.' };
  if (text.length > REPLY_TEXT_MAX) return { ok: false, error: `Keep the reply under ${REPLY_TEXT_MAX} characters.` };
  if (r.situation === 'claim_ask' && text.length > ASK_TEXT_MAX) return { ok: false, error: `Keep a question under ${ASK_TEXT_MAX} characters, what a request for more can carry.` };
  const unknown = (text.match(/\{\{\s*[a-z0-9_]+\s*\}\}/gi) || []).map((t) => t.replace(/\s/g, '')).find((t) => !REPLY_TOKENS.some((x) => x.token === t));
  if (unknown) return { ok: false, error: `${unknown} isn’t a detail a reply can fill in.` };
  if (r.situation === 'message' && /\{\{\s*amount\s*\}\}/i.test(text)) return { ok: false, error: 'A reply to a message has no amount to fill in. Use it in a claim reply.' };
  return { ok: true, situation: r.situation, name, text };
}

/** The reply as the settings page shows it: details by name, not as tokens. */
export const readable = (text: string) => String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => {
  const t = REPLY_TOKENS.find((x) => x.key === String(k).toLowerCase());
  return t ? `[${t.label}]` : m;
});

/** The shop messages that send on their own, shown at the top of the playbook (their wording lives in lib/message-policy). */
// (Message received isn't here: a customer's message shows on their order page as they send it, and nothing is emailed.)
export const AUTOMATIC_KINDS = ['claim_received', 'claim_decision', 'return_update'] as const;
