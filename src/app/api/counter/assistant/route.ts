// src/app/api/counter/assistant/route.ts — THE VOICE ASSISTANT'S TOOLS (L21). While it talks with a car at the speaker,
// the drive-thru's voice assistant calls these to build the order, the same way the lane screen does (lib/counter-
// server): every line priced from the menu, every choice checked, nothing guessed (lib/voice-order). Whatever it adds
// shows on the lane screen and the order board straight away, so the team can see it and take over at any moment.
//   The voice service posts { call: { call_id, ... }, name, args } with the shared secret header (x-voice-secret, as the
//   other voice tools). The order is found from the call itself (driveThruCalls/{call_id}, made when the call started),
//   never from anything the assistant says, so it can only ever change the order of the car it's talking to.
//   get_menu            → what can be ordered right now, with prices and choices
//   add_item            { item, quantity?, choices?[] } → added, or a question back ("Which size: ...?")
//   remove_item         { item, quantity? } → taken off (or fewer of it)
//   change_quantity     { item, quantity } → how many of something already on the order
//   set_name            { name } → the guest's first name on the order (lib/counter-server setOrderName)
//   read_order          → the order so far and its total, to read back
//   finish_order        → sent to the kitchen: the total, and "please pull forward"
// Every answer carries the order so far and the total, so the assistant always reads back what's really on it.
import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, parseVoiceToolRequest } from '@/lib/voice/voice-utils';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { readMenu } from '@/lib/menu-server';
import { editOrder, sendOrder, setOrderName, cleanName } from '@/lib/counter-server';
import { readBack } from '@/lib/counter-orders';
import { askFor, matchChoices, matchItem, menuForVoice, words } from '@/lib/voice-order';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const CALL = /^[A-Za-z0-9_-]{6,128}$/;
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const reply = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const ASSISTANT = { id: null, name: 'Voice assistant' };
/** The same arguments in any key order compare the same. */
const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;

/** What every answer says about the order: the words to read back, how many things, and the total. */
const summary = (o: any) => ({ order_so_far: (o?.lines || []).length ? readBack(o.lines) : 'Nothing yet.', items: (o?.lines || []).reduce((n: number, l: any) => n + (Number(l.quantity) || 0), 0), total: money(Number(o?.total) || 0) });

export async function POST(req: NextRequest) {
  try {
    if (!verifyVoiceSecret(req)) return reply({ error: 'unauthorized' }, 401);
    const body: any = await req.json().catch(() => ({}));
    const { args, retellCallId } = parseVoiceToolRequest(body);
    const name = String(body?.name || args?.tool || '').trim();
    if (!retellCallId || !CALL.test(retellCallId)) return reply({ result: 'I can’t find this order. Please ask the guest to pull forward to the window.' });
    const db = getAdminDb();
    const call: any = (await db.doc(`driveThruCalls/${retellCallId}`).get()).data();
    if (!call || !ID.test(String(call.tenantId || '')) || !ID.test(String(call.orderId || ''))) return reply({ result: 'I can’t find this order. Please ask the guest to pull forward to the window.' });
    const tenantId = String(call.tenantId); const orderId = String(call.orderId); const T = `tenants/${tenantId}`;
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked || toolLocked(tenant, ['hospitality'])) return reply({ result: 'We can’t take orders right now. Please apologize and let the guest know.' });
    // Taken over by the team, or the call is over: the assistant is out of the conversation, and changes nothing.
    if (call.status === 'taken_over') return reply({ result: 'A team member has taken over this order. Say nothing more.' });
    // (While someone is taking over, for the second it takes, the assistant carries on as it was.)
    if (call.status !== 'live' && call.status !== 'taking_over') return reply({ result: 'This call has ended. Say goodbye.' });
    const order: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data();
    if (!order) return reply({ result: 'I can’t find this order. Please ask the guest to pull forward to the window.' });
    if (order.status !== 'building' && name !== 'read_order' && name !== 'set_name') return reply({ result: 'This order has already gone to the kitchen. Ask them to pull forward to the window.', ...summary(order) });

    // One tool call is one change, even if it's sent again. The service gives each tool call its own id, and the call
    // so far lists them: this request is the one invocation of this tool, with these same arguments, still waiting for
    // its answer. If none is waiting (the list may not show this one yet), it's the last one like it at this point in
    // the conversation: a copy sent again is still one change, and the same thing asked for again after the guest
    // spoke ("another fries") is made. Two identical ones waiting at once ("fries", "fries" in one breath) can't be told
    // apart, so each is simply made: a double shows in the read-back, where a dropped item wouldn't be noticed. Without
    // ids, it's named by the call, the tool, what was asked, and how far the conversation had got.
    const steps: any[] = Array.isArray(body?.call?.transcript_with_tool_calls) ? body.call.transcript_with_tool_calls : [];
    const answered = new Set(steps.filter((x: any) => x?.role === 'tool_call_result' && x?.tool_call_id).map((x: any) => String(x.tool_call_id)));
    const argsOf = (x: any) => { try { return typeof x?.arguments === 'string' ? JSON.parse(x.arguments) : x?.arguments; } catch { return undefined; } };
    const sameArgs = (a: any, b: any) => JSON.stringify(sorted(a ?? {})) === JSON.stringify(sorted(b ?? {}));
    const fits = steps.filter((x: any) => x?.role === 'tool_call_invocation' && String(x?.name || '') === name && x?.tool_call_id && sameArgs(argsOf(x), args));
    const waiting = fits.filter((x: any) => !answered.has(String(x.tool_call_id)));
    const turn = Array.isArray(body?.call?.transcript_object) ? body.call.transcript_object.length : String(body?.call?.transcript || '').length;
    const named = waiting.length === 1 ? `tool|${String(waiting[0].tool_call_id)}`
      : waiting.length > 1 ? `each|${randomUUID()}`
      : fits.length ? `tool|${String(fits[fits.length - 1].tool_call_id)}|${turn}`
      : `${name}|${JSON.stringify(sorted(args ?? {}))}|${turn}`;
    const tapKey = `v${createHash('sha256').update(`${retellCallId}|${named}`).digest('hex').slice(0, 30)}`;
    const menu = await readMenu(db, tenantId);
    const said = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const lineFor = (spoken: string) => {
      const lines: any[] = Array.isArray(order.lines) ? order.lines : [];
      const m: any = matchItem(menu, spoken);
      const byItem = m.item ? lines.filter((l) => l.itemId === m.item.id) : [];
      if (byItem.length) return byItem;
      const w = new Set(words(spoken));
      return lines.filter((l) => words(l.name).every((x) => w.has(x)) || words(`${l.name} ${l.choicesText || ''}`).some((x) => w.has(x) && x.length > 3));
    };

    if (name === 'get_menu') return reply({ result: menuForVoice(menu), ...summary(order) });

    if (name === 'set_name') {
      const given = cleanName(args?.name);
      if (!given) return reply({ result: 'That didn’t sound like a name. Carry on without one.', ...summary(order) });
      const r: any = await setOrderName(db, tenantId, orderId, given);
      if (r.error) return reply({ result: 'Carry on without the name.', ...summary(order) });
      return reply({ result: `Saved the name ${r.name}. Now read the order back.`, name: r.name, ...summary(order) });
    }

    if (name === 'read_order') return reply({ result: (order.lines || []).length ? `So far: ${readBack(order.lines)} That’s ${money(order.total)}${Number(order.tax) > 0 ? ' with tax' : ''}.` : 'Nothing on the order yet.', ...summary(order) });

    if (name === 'add_item') {
      const spoken = said(args?.item); if (!spoken) return reply({ result: 'Ask what they would like.', ...summary(order) });
      const m: any = matchItem(menu, spoken);
      if (m.ambiguous) return reply({ result: `Ask which they meant: ${m.ambiguous.map((x: any) => x.name).join(', or ')}.`, ask: true, ...summary(order) });
      if (m.none) return reply({ result: m.soldOut ? `Sorry, the ${m.soldOut.name} is sold out right now. Offer something else.` : `We don’t have “${spoken}”. Offer something from the menu.`, ...summary(order) });
      const choices: string[] = Array.isArray(args?.choices) ? args.choices.map(said).filter(Boolean).slice(0, 12) : typeof args?.choices === 'string' ? String(args.choices).split(/,| and /).map(said).filter(Boolean) : [];
      const c = matchChoices(m.item, choices);
      if (c.unsure.length) return reply({ result: `Ask which they meant for “${c.unsure[0].said}”: ${c.unsure[0].options.join(', or ')}. Then add it again with their answer.`, ask: true, ...summary(order) });
      if (c.soldOut.length) return reply({ result: `Sorry, ${c.soldOut.join(' and ')} ${c.soldOut.length === 1 ? 'is' : 'are'} sold out right now. Ask what they’d like instead.`, ask: true, ...summary(order) });
      if (c.unknown.length) {
        const groups = (m.item.choices || []).map((g: any) => `${g.name}: ${g.options.filter((o: any) => !o.soldOut).map((o: any) => o.name).join(', ')}`).join('; ');
        return reply({ result: `The ${m.item.name} doesn’t come with ${c.unknown.join(' or ')}.${groups ? ` Its choices are ${groups}.` : ' It has no choices.'} Ask again.`, ask: true, ...summary(order) });
      }
      if (c.ask) return reply({ result: `Ask: ${askFor(c.ask)} Then add it again with their answer.`, ask: true, ...summary(order) });
      const q = Math.max(1, Math.min(20, Math.floor(Number(args?.quantity) || 1)));
      const r: any = await editOrder(db, tenantId, tenant, orderId, { action: 'add', itemId: m.item.id, quantity: q, choices: c.picks, tapKey });
      if (r.error) return reply({ result: `${r.error} Tell the guest.`, ...summary(order) });
      return reply({ result: `Added ${q > 1 ? `${q} ` : ''}${r.line?.name || m.item.name}${r.line?.choicesText ? `, ${r.line.choicesText}` : ''}. Ask if there’s anything else.`, ...summary(r.order) });
    }

    if (name === 'remove_item' || name === 'change_quantity') {
      const spoken = said(args?.item); const found = spoken ? lineFor(spoken) : [];
      if (!found.length) return reply({ result: `There’s no “${spoken}” on the order. Read the order back to check.`, ...summary(order) });
      if (found.length > 1) return reply({ result: `Ask which one: ${found.map((l: any) => `${l.name}${l.choicesText ? `, ${l.choicesText}` : ''}`).join(', or ')}.`, ask: true, ...summary(order) });
      const l = found[0];
      let next = name === 'change_quantity' ? Math.floor(Number(args?.quantity)) : l.quantity - Math.max(1, Math.floor(Number(args?.quantity) || l.quantity));
      if (name === 'change_quantity' && !(next >= 0 && next <= 20)) return reply({ result: 'Ask how many they want, up to 20.', ask: true, ...summary(order) });
      next = Math.max(0, next);
      const r: any = await editOrder(db, tenantId, tenant, orderId, next === 0 ? { action: 'remove', lineId: l.lineId, tapKey } : { action: 'qty', lineId: l.lineId, quantity: next, tapKey });
      if (r.error) return reply({ result: `${r.error} Tell the guest.`, ...summary(order) });
      return reply({ result: next === 0 ? `Took off the ${l.name}.` : `Changed it to ${next} ${l.name}.`, ...summary(r.order) });
    }

    if (name === 'finish_order') {
      if (!(order.lines || []).length) return reply({ result: 'Nothing is on the order yet. Ask what they would like.', ...summary(order) });
      const r: any = await sendOrder(db, tenantId, tenant, orderId, ASSISTANT);
      if (r.error) return reply({ result: `${r.error} Tell the guest, and fix the order with them.`, ...summary(order) });
      await db.doc(`driveThruCalls/${retellCallId}`).set({ orderSentAt: new Date().toISOString() }, { merge: true });
      // The order as it went to the kitchen (the team may have changed it on the lane meanwhile): that's the total said.
      const sent: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data() || order;
      return reply({ result: `Sent to the kitchen. Tell them: your total is ${money(sent.total)}${Number(sent.tax) > 0 ? ' with tax' : ''}. Please pull forward to the window. Then say goodbye and end the call.`, sent: true, ...summary(sent) });
    }

    return reply({ result: 'That isn’t something I can do. Keep taking the order.', ...summary(order) });
  } catch (e: any) {
    console.error('[counter/assistant] failed', e?.message || e);
    return reply({ result: 'Something went wrong on our side. Apologize and ask them to pull forward to the window, where the team will take the order.' });
  }
}
