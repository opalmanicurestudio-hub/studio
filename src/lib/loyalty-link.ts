// The client's private rewards page link (/rewards/{tenant}/{client}?k=…), signed so only the link holds it. Server only.
import { createHmac } from 'crypto';
export function rewardsKey(tenantId: string, clientId: string) {
  const secret = process.env.LINK_SECRET || process.env.GIFT_LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'rewards';
  return createHmac('sha256', secret).update(`rewards:${tenantId}/${clientId}`).digest('base64url').slice(0, 22);
}
export const rewardsPath = (tenantId: string, clientId: string) => `/rewards/${encodeURIComponent(tenantId)}/${encodeURIComponent(clientId)}?k=${rewardsKey(tenantId, clientId)}`;
