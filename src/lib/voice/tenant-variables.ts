/**
 * tenant-variables — shared builder for the per-call dynamic variables that
 * define which business the AI assistant "is" on any given call.
 *
 * Used by TWO routes:
 *   - /api/voice/inbound-webhook  (Retell asks who owns the ringing number)
 *   - /api/voice/outbound-call    (we place a call, so WE must inject the
 *     variables up front — outbound calls never hit the inbound webhook)
 *
 * Keeping this in one place guarantees inbound and outbound calls speak
 * with the same name, knowledge, and prices for the same tenant.
 */

import type { Firestore } from 'firebase-admin/firestore';

export const DEFAULT_AGENT_NAME = 'Chloe';

export function buildKnowledgeBase(tenant: any, services: any[]): string {
  const parts: string[] = [];

  const manual = (tenant?.voiceAgent?.knowledgeBase || '').trim();
  if (manual) parts.push(manual);

  if (tenant?.voiceAgent?.includeServicePrices !== false) {
    const lines = services
      .filter((s: any) => s.type === 'service' && s.name)
      .map((s: any) => {
        const price = Number(s.price) || 0;
        const duration = Number(s.duration) || 0;
        return `- ${s.name}: ${price > 0 ? `$${price}` : 'price varies'}${
          duration > 0 ? `, about ${duration} minutes` : ''
        }`;
      });
    if (lines.length > 0) {
      parts.push(
        `Current services and standard starting prices (specific providers may vary slightly):\n${lines.join('\n')}`,
      );
    }
  }

  return parts.join('\n\n') || 'No additional business details provided.';
}

export async function buildTenantVariables(
  db: Firestore,
  tenantId: string,
  tenant: any,
): Promise<Record<string, string>> {
  const servicesSnap = await db
    .collection(`tenants/${tenantId}/services`)
    .get();
  const services = servicesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  const va = tenant?.voiceAgent || {};
  const transferNumber = (va.transferNumber || '').trim();

  return {
    tenant_id: tenantId,
    agent_name: (va.agentName || '').trim() || DEFAULT_AGENT_NAME,
    studio_name: tenant?.name || tenant?.locationName || 'the studio',
    business_niche: (va.businessNiche || '').trim(),
    knowledge_base: buildKnowledgeBase(tenant, services),
    has_transfer: transferNumber ? 'true' : 'false',
    transfer_number: transferNumber,
  };
}
