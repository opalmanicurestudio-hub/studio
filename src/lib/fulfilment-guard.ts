// src/lib/fulfilment-guard.ts — THE SAME ONLINE-ORDER JOBS ON THE SERVER AS ON SCREEN. Buying or voiding a label
// spends money, so the server checks the person's fulfilment role (lib/fulfilment-access) rather than trusting the
// screen to hide the button. The owner and managers can always.
import { permissionsFor } from './fulfilment-access';

export function mayShip(actor: { role?: string; fulfilmentRole?: string | null; isTenantOwner?: boolean; isManager?: boolean }): boolean {
  if (actor.isTenantOwner || actor.isManager) return true;
  return permissionsFor({ role: actor.role as any, fulfilmentRole: actor.fulfilmentRole || undefined }).canShip;
}

export const SHIP_DENIED = 'Buying labels isn’t part of your role. Ask a manager to make you a shipper.';
