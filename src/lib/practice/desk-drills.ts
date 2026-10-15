// src/lib/practice/desk-drills.ts — PRACTICE AT THE DESK, without real clients or money: short scenes for the moments
// new staff find hardest. Refunds (what to refund, where the money goes, the bottle, what to say) and filling a
// cancellation from the waitlist (who goes first, how long it's held, the same-day and party rules). The waitlist
// answers follow the real offer rules in lib/waitlist-engine — scripts/verify/desk-drills.verify.ts checks that they
// still agree. Checkout itself is practiced at the register (/practice/register).
import type { Look } from '@/lib/practice/register';

export type Choice = { text: string; right?: boolean; why?: string };
export type Step = { ask: string; say?: string; choices: Choice[]; why: string };
export type Paper =
  | { kind: 'receipt'; title: string; lines: { label: string; price: number }[]; paid: string; note?: string }
  | { kind: 'waitlist'; title: string; opening: string; now: string; people: { name: string; wants: string; since: string; note?: string }[] };
export type Drill = { id: string; group: 'refunds' | 'waitlist'; title: string; sub: string; who: { name: string; look: Look }; hello: string; paper: Paper; steps: Step[] };

const L = (skin: string, hair: string, top: string, style: Look['style']): Look => ({ skin, hair, top, style });

export const DESK_DRILLS: Drill[] = [
  { id: 'leak', group: 'refunds', title: 'A leaking bottle', sub: 'Refund one product, not the visit', who: { name: 'Maya', look: L('#a8714f', '#2a1a12', '#f3c6d0', 'bun') },
    hello: 'I bought this top coat yesterday and it leaked all over my bag. Can I get my money back?',
    paper: { kind: 'receipt', title: 'Yesterday · Maya Reyes', lines: [{ label: 'Gel manicure with Ana', price: 4500 }, { label: 'Non-wipe top coat', price: 1600 }], paid: 'Card ending 4242' },
    steps: [
      { ask: 'What do you refund?', choices: [{ text: 'The top coat, $16', right: true }, { text: 'The whole visit, $61', why: 'Her manicure was fine. Refund only what went wrong.' }, { text: 'Nothing, store credit only', why: 'A faulty product is a refund she’s owed, not a favor.' }], why: 'Refund exactly what went wrong. The manicure wasn’t the problem.' },
      { ask: 'Where does the money go?', choices: [{ text: 'Back to the card ending 4242', right: true }, { text: 'Cash from the drawer', why: 'She paid by card. Cash out of the drawer leaves it short at close.' }, { text: 'Onto another card she hands you', why: 'Refunds to a different card are the most common refund fraud.' }], why: 'Refunds go back the way they were paid. It protects her and the business.' },
      { ask: 'And the bottle?', choices: [{ text: 'Mark it damaged, not back on the shelf', right: true }, { text: 'Put it back on the shelf', why: 'A leaking bottle can’t be sold to the next person.' }, { text: 'Let her keep it', why: 'Take it back so it’s counted. Stock numbers stay right.' }], why: 'Marking it damaged keeps the stock count honest and shows if a batch is faulty.' },
      { ask: 'What do you tell her?', choices: [{ text: '“All done. $16 is back on your card ending 4242. It can take a few days to show, and the points from it come off too.”', right: true }, { text: '“It’s refunded.”', why: 'Say where the money went and when she’ll see it, so she doesn’t worry.' }, { text: '“Refunds take two weeks, sorry.”', why: 'Don’t guess. Card refunds usually show within a few business days.' }], why: 'Where, how long, and the points: nothing left to surprise her later.' },
    ] },
  { id: 'chipped', group: 'refunds', title: 'Chipped in two days', sub: 'A service refund is a manager’s call', who: { name: 'Keisha', look: L('#6b4430', '#120c09', '#c9dcef', 'braids') },
    hello: 'My gel manicure chipped after two days. I want a refund.',
    paper: { kind: 'receipt', title: 'Monday · Keisha Moore', lines: [{ label: 'Gel manicure with Ana', price: 4500 }], paid: 'Card ending 8817' },
    steps: [
      { ask: 'What’s your first move?', choices: [{ text: 'Say sorry and offer a free fix soon', right: true }, { text: 'Refund the $45 straight away', why: 'Most clients want nails that last. Offer to put it right first.' }, { text: 'Explain that chips are normal', why: 'Two days isn’t normal. Arguing loses the client.' }], why: 'A quick fix usually keeps the client and the visit.' },
      { ask: 'She can’t come back this week and still wants her money back.', choices: [{ text: 'Ask a manager to approve the refund', right: true }, { text: 'Refund it yourself', why: 'Service refunds need a manager. They also spot it if it keeps happening.' }, { text: 'Say no', why: 'She’s been reasonable. A manager decides, not a flat no.' }], why: 'A manager approves service refunds and sees the bigger picture.' },
      { ask: 'Anything else before she leaves?', choices: [{ text: 'Open a case in Making it right with what happened', right: true }, { text: 'Nothing, it’s handled', why: 'Without a record, nobody learns why it chipped.' }, { text: 'A note on the counter', why: 'Notes get lost. The case keeps the cost and the cause together.' }], why: 'The case tracks the cost and the cause, so the team can stop it happening again.' },
    ] },
  { id: 'nocash', group: 'refunds', title: 'Cash, no receipt', sub: 'Find the sale, refund it the way it was paid', who: { name: 'Theo', look: L('#e9c9a8', '#8a5a2b', '#dfe8d8', 'short') },
    hello: 'I paid cash for this cuticle oil pen last week. Never opened it. Can I return it? I don’t have the receipt.',
    paper: { kind: 'receipt', title: 'Found on his client record · Last Friday', lines: [{ label: 'Cuticle oil pen', price: 1800 }], paid: 'Cash', note: 'Unopened, seal intact' },
    steps: [
      { ask: 'No receipt. What do you do?', choices: [{ text: 'Look up the sale by his name or phone', right: true }, { text: 'Refuse without a receipt', why: 'The sale is on his record. The receipt is only a copy.' }, { text: 'Hand him $18 and move on', why: 'Find the sale first, so it’s refunded once and recorded.' }], why: 'His purchase is on his client record, so the sale is easy to find.' },
      { ask: 'Found it: paid cash. How does he get the money?', choices: [{ text: 'Cash from the drawer, counted out to him, recorded as a refund', right: true }, { text: 'Onto his card', why: 'Cash sale, cash back. A card refund would need a sale on that card.' }, { text: 'Store credit only', why: 'It’s unopened and within the return window. He can have his money.' }], why: 'Recording it as a refund is what makes the drawer balance at close.' },
      { ask: 'The pen?', choices: [{ text: 'Back on the shelf: it’s sealed', right: true }, { text: 'Mark it damaged', why: 'It’s sealed and perfect. Put it back so it can sell.' }], why: 'A sealed product goes back into stock.' },
    ] },
  { id: 'newcard', group: 'refunds', title: '“Put it on my new card”', sub: 'Refunds never go to a different card', who: { name: 'Lena', look: L('#f1d3bf', '#b8b2aa', '#e9d6f2', 'short') },
    hello: 'The card I paid with has been closed. Can you put the refund on this new one?',
    paper: { kind: 'receipt', title: 'Two weeks ago · Lena Fischer', lines: [{ label: 'Vitamin C serum', price: 4800 }], paid: 'Card ending 1190 (closed)', note: 'Returning it unopened' },
    steps: [
      { ask: 'What do you do?', choices: [{ text: 'Refund the original card. Her bank sends it on to her, or offer store credit.', right: true }, { text: 'Put it on the new card', why: 'Refunding to a different card is how most refund fraud works.' }, { text: 'Give her cash', why: 'She paid by card. Cash out of the drawer leaves it short.' }], why: 'Her bank passes a refund on a closed card to her new account, or sends a check.' },
      { ask: 'She’s unsure. How do you put it?', choices: [{ text: '“Your bank moves it to your new account automatically. If you’d rather, I can put it on a store credit right now.”', right: true }, { text: '“That’s our policy.”', why: 'Explain what happens to her money, not the rule.' }], why: 'People relax when they know where their money is going.' },
    ] },

  { id: 'fill', group: 'waitlist', title: 'Fill a cancellation', sub: 'Who it fits, not who waited longest', who: { name: 'Maya', look: L('#a8714f', '#2a1a12', '#f6e1c9', 'bun') },
    hello: 'My client cancelled Thursday at 2:00. Who should get my time?',
    paper: { kind: 'waitlist', title: 'The waitlist', opening: 'Thursday 2:00–3:00 with Maya · gel fill (60 min)', now: 'Wednesday, noon (26 hours away)', people: [
      { name: 'Priya', wants: 'Gel fill · with Maya · Thursday afternoons', since: 'Oct 5' },
      { name: 'Jen', wants: 'Gel fill · anyone · any time', since: 'Oct 10' },
      { name: 'Ivy', wants: 'Express fill (45 min) · any time', since: 'Oct 1' },
      { name: 'Dana', wants: 'Gel fill · Saturday mornings', since: 'Sep 28' },
      { name: 'Sam', wants: 'Already booked Oct 29 with Maya · wants sooner', since: 'Oct 12' } ] },
    steps: [
      { ask: 'Who gets the first offer?', choices: [{ text: 'Priya', right: true }, { text: 'Dana, she waited longest', why: 'She can only come Saturday mornings.' }, { text: 'Ivy', why: 'Her 45 minutes would leave 15 nobody can book.' }, { text: 'Sam', why: 'Moving him up only helps if his Oct 29 time can be filled. New bookings come first.' }], why: 'Priya asked for Maya and Thursday afternoons, and her service fills the hour.' },
      { ask: 'How is it offered to her?', choices: [{ text: 'Hers alone, held for 30 minutes', right: true }, { text: 'Texted to everyone, first to tap', why: 'With a day to go there’s time to do it fairly, one at a time.' }, { text: 'Held until she answers', why: 'Thirty minutes, then it moves on. Nobody waits on one person.' }], why: 'More than a day away: one person at a time, 30 minutes each.' },
      { ask: 'Priya doesn’t answer in 30 minutes. Next?', choices: [{ text: 'Jen gets it, the same way', right: true }, { text: 'Text all of them', why: 'Still more than a day out, so it stays one at a time.' }, { text: 'Leave it open', why: 'An empty chair is lost money. It moves on by itself.' }], why: 'Next best fit: Jen wants a gel fill with anyone, at any time.' },
    ] },
  { id: 'today', group: 'waitlist', title: 'Later today', sub: 'Same-day rules', who: { name: 'Jo', look: L('#c68c64', '#3b2416', '#cfe6dc', 'curls') },
    hello: 'My 2:00 today just cancelled. It’s noon now.',
    paper: { kind: 'waitlist', title: 'The waitlist', opening: 'Today 2:00–3:00 with Jo · blowout', now: 'Noon (2 hours away)', people: [
      { name: 'Marco', wants: 'Blowout · any time', since: 'Oct 2', note: 'Missed his last two visits' },
      { name: 'Ana', wants: 'Blowout · needs 1 hour’s notice', since: 'Oct 6' },
      { name: 'Ruth', wants: 'Blowout · needs 1 hour’s notice', since: 'Oct 8' },
      { name: 'Lee', wants: 'Blowout · needs 1 hour’s notice', since: 'Oct 9' } ] },
    steps: [
      { ask: 'How does it go out?', choices: [{ text: 'To the three best fits at once: first to tap gets it', right: true }, { text: 'One at a time, 30 minutes each', why: 'With two hours to go there isn’t time for that.' }, { text: 'Only the desk can offer it', why: 'That’s for under an hour. Two hours is time for a text.' }], why: 'Later today: the top three at once, first to confirm.' },
      { ask: 'Marco fits and has waited longest. Is he one of the three?', choices: [{ text: 'No: he gets times with more notice, not same-day', right: true }, { text: 'Yes, he waited longest', why: 'Two missed visits: a same-day time is too likely to sit empty.' }], why: 'Someone who misses visits isn’t offered same-day times, but still gets offers further ahead.' },
    ] },
  { id: 'soon', group: 'waitlist', title: '40 minutes away', sub: 'When the desk steps in', who: { name: 'Ana', look: L('#8d5a3b', '#1a120d', '#f3d2c1', 'long') },
    hello: 'My 3:00 just cancelled. It’s 2:20.',
    paper: { kind: 'waitlist', title: 'Right now', opening: 'Today 3:00–3:45 with Ana · gel manicure', now: '2:20 (40 minutes away)', people: [
      { name: 'Walk-in list', wants: 'Two people waiting in the lobby', since: 'Today' },
      { name: 'Waitlist', wants: 'Five people, most need an hour or more', since: '' } ] },
    steps: [
      { ask: 'What happens?', choices: [{ text: 'The desk offers it to someone in the studio or on the walk-in list', right: true }, { text: 'Text the waitlist', why: 'Under an hour, a text is too slow for most people to make it.' }, { text: 'Let Ana take a break', why: 'Someone is waiting right here. Ask them first.' }], why: 'Under an hour away, the app tells the desk instead of texting.' },
    ] },
  { id: 'party', group: 'waitlist', title: 'A bridal party', sub: 'Times that open together go to a party first', who: { name: 'Maya', look: L('#a8714f', '#2a1a12', '#f6e1c9', 'bun') },
    hello: 'My 3:00 tomorrow and Jo’s 3:15 both just opened.',
    paper: { kind: 'waitlist', title: 'The waitlist', opening: 'Tomorrow 3:00 with Maya and 3:15 with Jo · gel manicure', now: 'Today, 11:00', people: [
      { name: 'Bea', wants: 'Party of 2 · gel manicures · any time', since: 'Oct 10' },
      { name: 'Sol', wants: 'Gel manicure · on his own', since: 'Oct 1' } ] },
    steps: [
      { ask: 'Who are they offered to?', choices: [{ text: 'Both to Bea’s party', right: true }, { text: 'The 3:00 to Sol, he waited longer', why: 'Times for a whole party are rare. When they open together, a party gets them first.' }], why: 'Parties first when enough times open together. If they pass, the times go to people on their own.' },
      { ask: 'Bea confirms for both. Who pays the deposit?', choices: [{ text: 'Bea pays one deposit for the party', right: true }, { text: 'Each guest pays their own', why: 'The organizer confirms and pays once, so nobody is chasing a guest.' }], why: 'One link, one deposit, from the organizer.' },
    ] },
];

export type Answer = { drill: string; step: number; picked: number; right: boolean };
export function score(answers: Answer[]) {
  const firsts = new Map<string, Answer>(); for (const a of answers) { const k = `${a.drill}:${a.step}`; if (!firsts.has(k)) firsts.set(k, a); }
  const f = [...firsts.values()]; return { asked: f.length, right: f.filter((a) => a.right).length, points: f.filter((a) => a.right).length * 10 };
}
export const drillBy = (id: string) => DESK_DRILLS.find((d) => d.id === id) || null;
