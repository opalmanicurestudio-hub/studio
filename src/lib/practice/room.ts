'use client';
// Practice a shift: two players. The desk device and a client-screen device (an iPad is perfect)
// share one short-lived room. Practice data only (made-up clients); nothing real is stored.
import { doc, onSnapshot, setDoc, updateDoc, getDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { signInAnonymously, type Auth } from 'firebase/auth';

export type Choice = { value: string | number; label: string; sub?: string };
export type DeskView = {
  stage: 'idle' | 'cart' | 'method' | 'tip' | 'card' | 'declined' | 'keep' | 'receipt' | 'rebook' | 'offer' | 'thanks' | 'details' | 'consent';
  seq: number; currency: string; who?: string; title?: string; note?: string;
  lines?: { label: string; price: number }[]; total?: number; amount?: number; choices?: Choice[];
  /** details: what's on file now (the client checks or updates it). consent: the form to read and sign. */
  prefill?: { name: string; phone: string; email: string }; text?: string;
};
export type ClientMsg = { seq: number; choice: string | number; at: number };
export type Room = { host: string; v: number; desk: DeskView; client: ClientMsg | null };

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
export const cleanCode = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[IO01L]/g, '').slice(0, 6);

export async function ensureUser(auth: Auth) { if (auth.currentUser) return auth.currentUser; return (await signInAnonymously(auth)).user; }
const ref = (db: Firestore, id: string) => doc(db, 'practiceRooms', id);

export async function createRoom(db: Firestore, auth: Auth, currency: string) {
  const u = await ensureUser(auth); const id = newCode();
  await setDoc(ref(db, id), { host: u.uid, v: 1, desk: { stage: 'idle', seq: 0, currency }, client: null, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 12 * 3600e3) });
  return id;
}
export async function joinRoom(db: Firestore, auth: Auth, id: string) {
  await ensureUser(auth); const snap = await getDoc(ref(db, id));
  if (!snap.exists()) throw new Error('No room with that code. Check the code on the desk screen.');
  await updateDoc(ref(db, id), { client: { seq: -1, choice: 'joined', at: Date.now() } });
  return snap.data() as Room;
}
export const pushDesk = (db: Firestore, id: string, desk: DeskView) => updateDoc(ref(db, id), { desk: JSON.parse(JSON.stringify(desk)) });
export const sendClient = (db: Firestore, id: string, msg: ClientMsg) => updateDoc(ref(db, id), { client: msg });
export const watchRoom = (db: Firestore, id: string, cb: (r: Room | null) => void) => onSnapshot(ref(db, id), (snap) => cb(snap.exists() ? (snap.data() as Room) : null), () => cb(null));

// ── Transports: the live database (two devices), or local (two tabs on one computer, also used for testing) ──
export type Transport = {
  create: (currency: string) => Promise<string>;
  join: (id: string) => Promise<void>;
  push: (id: string, desk: DeskView) => Promise<void>;
  send: (id: string, msg: ClientMsg) => Promise<void>;
  watch: (id: string, cb: (r: Room | null) => void) => () => void;
};
export function cloudTransport(db: Firestore, auth: Auth): Transport {
  return { create: (c) => createRoom(db, auth, c), join: async (id) => { await joinRoom(db, auth, id); }, push: (id, d) => pushDesk(db, id, d), send: (id, m) => sendClient(db, id, m), watch: (id, cb) => watchRoom(db, id, cb) };
}
export function localTransport(): Transport {
  const key = (id: string) => `cf_room_${id}`;
  const read = (id: string): Room | null => { try { const v = localStorage.getItem(key(id)); return v ? JSON.parse(v) : null; } catch { return null; } };
  const write = (id: string, r: Room) => { localStorage.setItem(key(id), JSON.stringify(r)); new BroadcastChannel(key(id)).postMessage(r); };
  return {
    create: async (currency) => { const id = newCode(); write(id, { host: 'local', v: 1, desk: { stage: 'idle', seq: 0, currency }, client: null }); return id; },
    join: async (id) => { const r = read(id); if (!r) throw new Error('No room with that code on this computer.'); write(id, { ...r, client: { seq: -1, choice: 'joined', at: Date.now() } }); },
    push: async (id, d) => { const r = read(id); if (r) write(id, { ...r, desk: d }); },
    send: async (id, m) => { const r = read(id); if (r) write(id, { ...r, client: m }); },
    watch: (id, cb) => { const ch = new BroadcastChannel(key(id)); ch.onmessage = (e) => cb(e.data as Room); cb(read(id)); return () => ch.close(); },
  };
}
