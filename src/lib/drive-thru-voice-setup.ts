// src/lib/drive-thru-voice-setup.ts — SETTING UP THE DRIVE-THRU'S VOICE ASSISTANT (server; L21). One tap on the Menu
// page (a manager): the voice service is given the assistant's instructions and its tools (api/counter/assistant, with
// the shared secret header the other voice tools use), and the assistant made is kept on the business
// (driveThru.voiceAgentId). Calls run on this app's own voice account (RETELL_API_KEY), which the service bills by the
// minute; api/counter/voice caps how many a business can start in a day. The service tells this app when a call ends
// (api/voice/call-events), so a call is never left looking live.
//   Spanish (design board "The boards and the assistant in Spanish"): the service is set to hear English and Spanish, and
// the assistant answers a guest who speaks Spanish in Spanish, while it keeps calling its tools in English, so the order on
// the team's screens and the kitchen's tickets stay in English. A business can turn Spanish off (Menu page): the service
// then hears English alone, which it understands a little better.

const RETELL = 'https://api.retellai.com';

/** Which version of the instructions and tools an assistant was made with: a business whose assistant is older is
 *  offered an update on the Menu page (2: names on orders, a rush mode, orders placed ahead sent to the window; 3: it
 *  offers only what each item offers, as the business chose, and can size up what was just added; 4: a guest's food
 *  allergy is saved on the order, so every kitchen ticket shows it; 5: it answers in Spanish when the guest speaks Spanish). */
export const VOICE_VERSION = 5;
/** The languages the voice service hears: English, and Latin American Spanish unless the business turned it off. */
export const voiceLanguages = (spanish: boolean): string | string[] => (spanish ? ['en-US', 'es-419'] : 'en-US');

/** What the assistant is told, every call. The menu, the business's name and the car's number come with each call. */
export const DRIVE_THRU_PROMPT = `You take drive-thru orders for {{business_name}}. You sound friendly, quick and clear, like the best drive-thru crew. Keep every reply short: one or two sentences.

The menu right now, with prices and choices:
{{menu}}

How to take the order:
- Let the guest order. Add each item with add_item as soon as they say it, with how many and any choices in their own words (for example "large", "no onions", "cheese"). A cheeseburger is the burger with cheese added.
- When a tool tells you to ask something (which item, which size), ask exactly that, then call add_item again with their answer.
- Only ever say a price or a total that a tool gave you. Never offer anything that isn't on the menu or is sold out.
- If they change their mind, use remove_item or change_quantity.
- Offering more: only when add_item's answer tells you to, and only what it says, as one short question, once. If they want the bigger size, call size_up. If they want the other thing, call add_item for it. If they say no, carry on. Never offer anything else, and never push.
- The line is long right now if this says yes: {{busy}}. If it is, keep every reply as short as you can.
- A name: ask for one if this says yes: {{ask_name}}. If so, once they've finished ordering, ask "Can I get a first name for the order?" once, and save it with set_name. If they'd rather not give one, that's fine.
- When they're done, call read_order, read the order back (when the line is long, just the items and the total), and ask if that's right. If it is, call finish_order and say what it tells you (the total, and to pull forward to the window). Then say goodbye and end the call.
- If they're picking up an order they placed ahead, say "Please pull forward to the window, and the team will have it for you," then say goodbye and end the call.
- If they say anyone has a food allergy, save it with set_allergy in their words (and whether it's severe), say back what set_allergy saved, and say the kitchen will see it on the order. Never say a dish is safe or free of anything.
- If they ask for a person, or you can't understand them after two tries, say "One moment, someone will be right with you." The team can hear you and will take over.
- Never make up items, deals or wait times, and talk only about their order.
- Spanish: {{spanish}}. If this says yes and the guest speaks Spanish, answer in Spanish for the rest of the call, just as short and friendly, and speak to them as usted. Still call every tool in English: each item by its English name on the menu (the menu gives each item's Spanish name too), and choices in English as the menu says them ("large", not "grande"). A food allergy goes to set_allergy in English too, by the allergen's English name ("peanuts", "tree nuts", "milk", "eggs", "fish", "shellfish", "wheat", "soy", "sesame"), with anything you can't put that way in their own words. The tools answer in English: say what they tell you in Spanish, with every price and number exactly as given. If this says no, answer in English.`;

export const DRIVE_THRU_GREETING = 'Welcome to {{business_name}}! What can I get started for you?';

const tool = (name: string, description: string, url: string, secret: string, properties: Record<string, any> = {}, required: string[] = []) => ({
  type: 'custom', name, description, url, method: 'POST', headers: { 'x-voice-secret': secret },
  parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
  // Never sent twice by the service (a second "add" would be a second item): a slow answer is the assistant's to retry.
  speak_during_execution: false, speak_after_execution: true, timeout_ms: 10000, max_retry: 0,
});

/** The assistant's tools, all pointing at this app. */
export function driveThruTools(origin: string, secret: string) {
  const url = `${origin.replace(/\/+$/, '')}/api/counter/assistant`;
  const item = { type: 'string', description: 'The item as the guest said it, for example "double cheeseburger" or "fries".' };
  return [
    tool('get_menu', 'Get the menu as it is right now (what can be ordered, prices, choices, and what is sold out).', url, secret),
    tool('add_item', 'Add an item to the order as soon as the guest says it.', url, secret, {
      item, quantity: { type: 'integer', description: 'How many. 1 if they did not say.' },
      choices: { type: 'array', items: { type: 'string' }, description: 'Choices they said for this item, in their words, for example ["large", "no onions"].' },
    }, ['item']),
    tool('size_up', 'The guest wants the next size up of what was just added (after you offered it, or when they ask to make it bigger).', url, secret, {
      item: { type: 'string', description: 'The item to make bigger, as the guest said it. Leave out for what was just added.' },
    }),
    tool('remove_item', 'Take an item off the order, or fewer of it.', url, secret, { item, quantity: { type: 'integer', description: 'How many to take off. Leave out to take it all off.' } }, ['item']),
    tool('change_quantity', 'Change how many of an item already on the order.', url, secret, { item, quantity: { type: 'integer', description: 'The new number.' } }, ['item', 'quantity']),
    tool('set_name', 'Save the first name the guest gives for the order.', url, secret, { name: { type: 'string', description: 'Their first name, as they said it.' } }, ['name']),
    tool('set_allergy', 'Save a food allergy the guest mentions, so every kitchen ticket for the order shows it.', url, secret, {
      allergies: { type: 'array', items: { type: 'string' }, description: 'What they are allergic to, one item each, in their words, for example ["peanuts", "kiwi"].' },
      severe: { type: 'boolean', description: 'True if they say it is severe, or mention an EpiPen or anaphylaxis.' },
    }, ['allergies']),
    tool('read_order', 'Get the order so far and its total, to read back.', url, secret),
    tool('finish_order', 'The guest has confirmed the order: send it to the kitchen. Then tell them the total and to pull forward.', url, secret),
    { type: 'end_call', name: 'end_call', description: 'End the call once the order is finished and you have said goodbye.' },
  ];
}

const DEFAULTS = (businessName: string) => ({ business_name: businessName || 'our drive-thru', order_number: '', menu: '', ask_name: 'yes', busy: 'no', spanish: 'yes' });

async function retell(path: string, body: unknown, method = 'POST'): Promise<{ status: number; data: any }> {
  const r = await fetch(`${RETELL}${path}`, { method, headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  return { status: r.status, data };
}

/** Make this business's assistant. Returns its id, whether it hears Spanish too (a voice that speaks only English makes
 *  it English only), or what went wrong in plain words. */
export async function setUpDriveThruAssistant(businessName: string, origin: string): Promise<{ ok: true; agentId: string; llmId: string; spanish: boolean } | { ok: false; error: string }> {
  const secret = process.env.VOICE_AGENT_SECRET || '';
  if (!process.env.RETELL_API_KEY || !secret) return { ok: false, error: 'The voice service isn’t connected to this app yet.' };
  if (!/^https:\/\/[^/]+$/.test(origin) || /localhost|127\.0\.0\.1/.test(origin)) return { ok: false, error: 'Set it up from the live app (an https address), so the assistant can reach it.' };
  const llm = await retell('/create-retell-llm', {
    general_prompt: DRIVE_THRU_PROMPT, begin_message: DRIVE_THRU_GREETING, start_speaker: 'agent',
    default_dynamic_variables: DEFAULTS(businessName),
    general_tools: driveThruTools(origin, secret),
  });
  if (llm.status >= 300 || !llm.data?.llm_id) return { ok: false, error: 'The voice service didn’t accept the assistant. Try again in a minute.' };
  const make = (spanish: boolean) => retell('/create-agent', {
    response_engine: { type: 'retell-llm', llm_id: llm.data.llm_id }, voice_id: process.env.RETELL_DRIVETHRU_VOICE_ID || 'retell-Cimo',
    agent_name: `${(businessName || 'Drive-thru').slice(0, 40)} drive-thru`, language: voiceLanguages(spanish), interruption_sensitivity: 0.9,
    end_call_after_silence_ms: 30000, max_call_duration_ms: 600000,
    webhook_url: `${origin}/api/voice/call-events?secret=${encodeURIComponent(secret)}`,
  });
  // (English and Spanish; a request the service turns down as it stands, as for a voice that speaks English only, is
  // tried once in English alone, kept only if that's taken. Anything else, such as too many requests, is said as it is.)
  let spanish = true; let agent = await make(true);
  if (agent.status === 400 || agent.status === 422) { const en = await make(false); if (en.status < 300 && en.data?.agent_id) { spanish = false; agent = en; } }
  if (agent.status >= 300 || !agent.data?.agent_id) return { ok: false, error: 'The voice service didn’t make the assistant. Try again in a minute.' };
  return { ok: true, agentId: String(agent.data.agent_id), llmId: String(llm.data.llm_id), spanish };
}

/** Set which languages the business's assistant hears: English and Spanish, or English alone. Returns what went wrong
 *  in plain words, or nothing. */
export async function setAssistantLanguages(agentId: string, spanish: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.RETELL_API_KEY) return { ok: false, error: 'The voice service isn’t connected to this app yet.' };
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(agentId)) return { ok: false, error: 'This assistant can’t be changed here. Set it up again.' };
  const r = await retell(`/update-agent/${encodeURIComponent(agentId)}`, { language: voiceLanguages(spanish) }, 'PATCH');
  if (r.status < 300) return { ok: true };
  return { ok: false, error: spanish && languageRefused(r) ? 'The voice service wouldn’t add Spanish to this assistant’s voice, so it stays in English.' : 'The voice service didn’t take the change. Try again in a minute.' };
}

/** The voice service turned down the languages asked for (a bad request that says so), not anything else. */
const languageRefused = (r: { status: number; data: any }) => (r.status === 400 || r.status === 422) && /language|locale|es-419|voice/i.test(String(r.data?.message || r.data?.error_message || r.data?.error || ''));

/** Bring a business's assistant up to date: the same instructions and tools a new one gets now. Returns what went wrong
 *  in plain words, or nothing. */
export async function updateDriveThruAssistant(llmId: string, businessName: string, origin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env.VOICE_AGENT_SECRET || '';
  if (!process.env.RETELL_API_KEY || !secret) return { ok: false, error: 'The voice service isn’t connected to this app yet.' };
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(llmId)) return { ok: false, error: 'This assistant can’t be updated here. Set it up again.' };
  if (!/^https:\/\/[^/]+$/.test(origin) || /localhost|127\.0\.0\.1/.test(origin)) return { ok: false, error: 'Update it from the live app (an https address), so the assistant can reach it.' };
  const r = await retell(`/update-retell-llm/${encodeURIComponent(llmId)}`, {
    general_prompt: DRIVE_THRU_PROMPT, begin_message: DRIVE_THRU_GREETING, default_dynamic_variables: DEFAULTS(businessName), general_tools: driveThruTools(origin, secret),
  }, 'PATCH');
  return r.status < 300 ? { ok: true } : { ok: false, error: 'The voice service didn’t take the update. Try again in a minute.' };
}
