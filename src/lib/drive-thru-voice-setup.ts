// src/lib/drive-thru-voice-setup.ts — SETTING UP THE DRIVE-THRU'S VOICE ASSISTANT (server; L21). One tap on the Menu
// page (a manager): the voice service is given the assistant's instructions and its tools (api/counter/assistant, with
// the shared secret header the other voice tools use), and the assistant made is kept on the business
// (driveThru.voiceAgentId). Calls run on this app's own voice account (RETELL_API_KEY), which the service bills by the
// minute; api/counter/voice caps how many a business can start in a day. The service tells this app when a call ends
// (api/voice/call-events), so a call is never left looking live.

const RETELL = 'https://api.retellai.com';

/** What the assistant is told, every call. The menu, the business's name and the car's number come with each call. */
export const DRIVE_THRU_PROMPT = `You take drive-thru orders for {{business_name}}. You sound friendly, quick and clear, like the best drive-thru crew. Keep every reply short: one or two sentences.

The menu right now, with prices and choices:
{{menu}}

How to take the order:
- Let the guest order. Add each item with add_item as soon as they say it, with how many and any choices in their own words (for example "large", "no onions", "cheese"). A cheeseburger is the burger with cheese added.
- When a tool tells you to ask something (which item, which size), ask exactly that, then call add_item again with their answer.
- Only ever say a price or a total that a tool gave you. Never offer anything that isn't on the menu or is sold out.
- If they change their mind, use remove_item or change_quantity.
- You may offer one drink or side once, only if they haven't ordered one. Never push.
- When they're done, call read_order, read the order back, and ask if that's right. If it is, call finish_order and say what it tells you (the total, and to pull forward to the window). Then say goodbye and end the call.
- If they ask for a person, or you can't understand them after two tries, say "One moment, someone will be right with you." The team can hear you and will take over.
- Never make up items, deals or wait times, and talk only about their order.`;

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
    tool('remove_item', 'Take an item off the order, or fewer of it.', url, secret, { item, quantity: { type: 'integer', description: 'How many to take off. Leave out to take it all off.' } }, ['item']),
    tool('change_quantity', 'Change how many of an item already on the order.', url, secret, { item, quantity: { type: 'integer', description: 'The new number.' } }, ['item', 'quantity']),
    tool('read_order', 'Get the order so far and its total, to read back.', url, secret),
    tool('finish_order', 'The guest has confirmed the order: send it to the kitchen. Then tell them the total and to pull forward.', url, secret),
    { type: 'end_call', name: 'end_call', description: 'End the call once the order is finished and you have said goodbye.' },
  ];
}

async function retell(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(`${RETELL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  return { status: r.status, data };
}

/** Make this business's assistant. Returns its id, or what went wrong in plain words. */
export async function setUpDriveThruAssistant(businessName: string, origin: string): Promise<{ ok: true; agentId: string; llmId: string } | { ok: false; error: string }> {
  const secret = process.env.VOICE_AGENT_SECRET || '';
  if (!process.env.RETELL_API_KEY || !secret) return { ok: false, error: 'The voice service isn’t connected to this app yet.' };
  if (!/^https:\/\/[^/]+$/.test(origin) || /localhost|127\.0\.0\.1/.test(origin)) return { ok: false, error: 'Set it up from the live app (an https address), so the assistant can reach it.' };
  const llm = await retell('/create-retell-llm', {
    general_prompt: DRIVE_THRU_PROMPT, begin_message: DRIVE_THRU_GREETING, start_speaker: 'agent',
    default_dynamic_variables: { business_name: businessName || 'our drive-thru', order_number: '', menu: '' },
    general_tools: driveThruTools(origin, secret),
  });
  if (llm.status >= 300 || !llm.data?.llm_id) return { ok: false, error: 'The voice service didn’t accept the assistant. Try again in a minute.' };
  const agent = await retell('/create-agent', {
    response_engine: { type: 'retell-llm', llm_id: llm.data.llm_id }, voice_id: process.env.RETELL_DRIVETHRU_VOICE_ID || 'retell-Cimo',
    agent_name: `${(businessName || 'Drive-thru').slice(0, 40)} drive-thru`, language: 'en-US', interruption_sensitivity: 0.9,
    end_call_after_silence_ms: 30000, max_call_duration_ms: 600000,
    webhook_url: `${origin}/api/voice/call-events?secret=${encodeURIComponent(secret)}`,
  });
  if (agent.status >= 300 || !agent.data?.agent_id) return { ok: false, error: 'The voice service didn’t make the assistant. Try again in a minute.' };
  return { ok: true, agentId: String(agent.data.agent_id), llmId: String(llm.data.llm_id) };
}
