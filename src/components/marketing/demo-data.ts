// src/components/marketing/demo-data.ts
//
// THE SAMPLE BUSINESSES IN THE LIVE DEMO (/demo).
//
// One per niche, sized so the demo feels real in two minutes: a handful of
// services, today's schedule, a couple of requests waiting, an offer, and the
// "people" that make each business different (renters / members / stock).
// Everything here lives in the visitor's browser only — nothing is saved.

import type { NicheKey } from './niches';

export type DemoStatus = 'confirmed' | 'requested' | 'arrived' | 'in_service' | 'ready' | 'paid';
export interface DemoAppt { id: string; time: string; client: string; service: string; price: number; with: string; status: DemoStatus }
export interface DemoService { name: string; mins: number; price: number }
export interface DemoPerson { id: string; name: string; detail: string; status: 'ok' | 'due'; okLabel: string; dueLabel: string; amount: number; action: string }
export interface DemoBiz {
  biz: string; team: string[]; services: DemoService[]; slots: string[];
  day: DemoAppt[]; offer: { code: string; pct: number };
  peopleTitle: string; peopleTab: string; people: DemoPerson[];
  winBack: { audience: string; count: number; message: string };
  clientWord: string; tipLabel: string;
}

export const DEMO: Record<NicheKey, DemoBiz> = {
  salon: {
    biz: 'Opal Studio', team: ['Kylie', 'Jess', 'Sam'], clientWord: 'client', tipLabel: 'Tip',
    services: [{ name: 'Soft gel overlay', mins: 45, price: 160 }, { name: 'Balayage', mins: 150, price: 240 }, { name: 'Brow shape', mins: 20, price: 35 }, { name: 'Pedicure', mins: 50, price: 65 }],
    slots: ['9:45', '11:15', '1:00', '2:30', '4:00'],
    day: [
      { id: 'a1', time: '9:00', client: 'Ana Lopez', service: 'Soft gel overlay', price: 160, with: 'Kylie', status: 'arrived' },
      { id: 'a2', time: '10:30', client: 'Mia Reyes', service: 'Balayage', price: 240, with: 'Jess', status: 'requested' },
      { id: 'a3', time: '12:00', client: 'Jo Tran', service: 'Brow shape', price: 35, with: 'Kylie', status: 'confirmed' },
      { id: 'a4', time: '1:30', client: 'Priya Shah', service: 'Pedicure', price: 65, with: 'Sam', status: 'requested' },
    ],
    offer: { code: 'WELCOME15', pct: 15 },
    peopleTitle: 'Renters', peopleTab: 'Renters',
    people: [
      { id: 'p1', name: 'Jess T.', detail: 'Suite 2 · weekly', status: 'ok', okLabel: 'rent paid', dueLabel: 'rent due', amount: 350, action: 'Collect on autopay' },
      { id: 'p2', name: 'Kai M.', detail: 'Chair 3 · weekly', status: 'ok', okLabel: 'rent paid', dueLabel: 'rent due', amount: 225, action: 'Collect on autopay' },
      { id: 'p3', name: 'Sam P.', detail: 'Chair 4 · weekly', status: 'due', okLabel: 'rent paid', dueLabel: 'rent due Fri', amount: 225, action: 'Collect on autopay' },
    ],
    winBack: { audience: 'Haven’t been in for 90 days', count: 84, message: 'Hi {first}, it’s been a while — we’d love to see you again. 15% off with code WELCOME15 💛' },
  },
  spa: {
    biz: 'Stillwater Spa', team: ['Nora', 'Eli', 'June'], clientWord: 'guest', tipLabel: 'Gratuity',
    services: [{ name: 'Deep tissue 60', mins: 60, price: 120 }, { name: 'Hydrafacial', mins: 50, price: 185 }, { name: 'Couples massage', mins: 60, price: 260 }, { name: 'Body wrap', mins: 45, price: 95 }],
    slots: ['10:00', '11:30', '1:00', '3:15', '4:45'],
    day: [
      { id: 'a1', time: '9:00', client: 'Maya Chen', service: 'Deep tissue 60', price: 120, with: 'Nora', status: 'arrived' },
      { id: 'a2', time: '10:30', client: 'New guest · Tess B.', service: 'Hydrafacial', price: 185, with: 'June', status: 'requested' },
      { id: 'a3', time: '12:00', client: 'Lena Kim', service: 'Couples massage', price: 260, with: 'Eli', status: 'confirmed' },
      { id: 'a4', time: '2:00', client: 'Priya Shah', service: 'Body wrap', price: 95, with: 'Nora', status: 'requested' },
    ],
    offer: { code: 'GLOW20', pct: 20 },
    peopleTitle: 'Members', peopleTab: 'Members',
    people: [
      { id: 'p1', name: 'Maya C.', detail: 'Monthly massage', status: 'ok', okLabel: 'renewed', dueLabel: 'renews today', amount: 99, action: 'Renew now' },
      { id: 'p2', name: 'Lena K.', detail: 'Glow club', status: 'ok', okLabel: 'renewed', dueLabel: 'renews today', amount: 149, action: 'Renew now' },
      { id: 'p3', name: 'Priya S.', detail: 'Monthly facial', status: 'due', okLabel: 'renewed', dueLabel: 'renews today', amount: 129, action: 'Renew now' },
    ],
    winBack: { audience: 'Due for a visit', count: 62, message: '{first}, your next treatment is waiting 🌿 20% off this month with GLOW20.' },
  },
  fitness: {
    biz: 'North Loop Pilates', team: ['Coach Dani', 'Coach Ro'], clientWord: 'member', tipLabel: 'Tip',
    services: [{ name: 'Reformer class', mins: 50, price: 32 }, { name: 'Mat Pilates', mins: 45, price: 22 }, { name: 'Intro private', mins: 55, price: 75 }, { name: '10-class pack', mins: 0, price: 180 }],
    slots: ['7:00', '9:30', '12:00', '5:00', '6:00'],
    day: [
      { id: 'a1', time: '7:00', client: 'Leo Park', service: 'Reformer class', price: 32, with: 'Coach Dani', status: 'arrived' },
      { id: 'a2', time: '9:30', client: 'Ava Reed', service: 'Intro private', price: 75, with: 'Coach Ro', status: 'requested' },
      { id: 'a3', time: '12:00', client: 'Jon Diaz', service: 'Mat Pilates', price: 22, with: 'Coach Dani', status: 'confirmed' },
      { id: 'a4', time: '6:00', client: 'Sara Lin', service: 'Intro private', price: 75, with: 'Coach Ro', status: 'requested' },
    ],
    offer: { code: 'NEWYOU10', pct: 10 },
    peopleTitle: 'Members', peopleTab: 'Members',
    people: [
      { id: 'p1', name: 'Leo P.', detail: 'Unlimited', status: 'ok', okLabel: 'renewed', dueLabel: 'renews today', amount: 159, action: 'Renew now' },
      { id: 'p2', name: 'Ava R.', detail: '8 classes / month', status: 'ok', okLabel: 'renewed', dueLabel: 'renews today', amount: 119, action: 'Renew now' },
      { id: 'p3', name: 'Jon D.', detail: 'Unlimited', status: 'due', okLabel: 'renewed', dueLabel: 'renews today', amount: 159, action: 'Renew now' },
    ],
    winBack: { audience: 'Haven’t been to class in 3 weeks', count: 140, message: '{first}, the reformer misses you 😉 Come back this week — 10% off with NEWYOU10.' },
  },
  shop: {
    biz: 'Fern & Clay', team: ['Ivy', 'Theo'], clientWord: 'customer', tipLabel: 'Tip',
    services: [{ name: 'Wheel-throwing workshop', mins: 120, price: 85 }, { name: 'Glaze night', mins: 90, price: 45 }, { name: 'Speckled mug', mins: 0, price: 28 }, { name: 'Linen towel', mins: 0, price: 18 }],
    slots: ['10:00', '1:00', '3:00', '6:00', '7:30'],
    day: [
      { id: 'a1', time: '10:00', client: 'Order #1042 · Ruth A.', service: 'Speckled mug × 2', price: 56, with: 'Ivy', status: 'arrived' },
      { id: 'a2', time: '1:00', client: 'Nia Owens', service: 'Wheel-throwing workshop', price: 85, with: 'Theo', status: 'requested' },
      { id: 'a3', time: '3:00', client: 'Order #1043 · Ben C.', service: 'Linen towel × 3', price: 54, with: 'Ivy', status: 'confirmed' },
      { id: 'a4', time: '6:00', client: 'Owen Hart', service: 'Glaze night', price: 45, with: 'Theo', status: 'requested' },
    ],
    offer: { code: 'MAKER10', pct: 10 },
    peopleTitle: 'Stock', peopleTab: 'Stock',
    people: [
      { id: 'p1', name: 'Speckled mug', detail: '14 on the shelf', status: 'ok', okLabel: 'in stock', dueLabel: 'low', amount: 0, action: 'Reorder' },
      { id: 'p2', name: 'Linen towel', detail: '22 on the shelf', status: 'ok', okLabel: 'in stock', dueLabel: 'low', amount: 0, action: 'Reorder' },
      { id: 'p3', name: 'Bud vase', detail: '3 on the shelf', status: 'due', okLabel: 'reordered', dueLabel: 'low — 3 left', amount: 0, action: 'Reorder' },
    ],
    winBack: { audience: 'Bought in the last 6 months', count: 310, message: '{first}, the autumn glazes are in 🍂 First pick for regulars — 10% off with MAKER10.' },
  },
};
