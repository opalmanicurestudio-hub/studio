// src/lib/klair-menu-server.ts — the menu Klair answers guests from (lib/klair-menu): read at most every five seconds a
// business, however many guests ask, and afresh after the menu is saved here (an allergen just marked counts at once).
import { readMenu } from '@/lib/menu-server';
import { menuAnswer, menuFacts, type MenuAnswer, type MenuFact, type Who } from '@/lib/klair-menu';

const MS = 5000;
const cache = new Map<string, { at: number; v: MenuFact[] }>();
export const forgetMenuFacts = (tenantId: string) => { cache.delete(tenantId); };
export async function factsFor(db: any, tenantId: string): Promise<MenuFact[]> {
  const hit = cache.get(tenantId); if (hit && Date.now() - hit.at < MS) return hit.v;
  const v = menuFacts(await readMenu(db, tenantId));
  cache.set(tenantId, { at: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return v;
}
export async function answerGuest(db: any, tenantId: string, question: string, who: Who = 'server'): Promise<MenuAnswer> {
  return menuAnswer(question, await factsFor(db, tenantId), who);
}
