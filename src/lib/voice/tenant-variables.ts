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
import { compileKnowledgeBase } from './knowledge-compiler';
import { nicheById } from './niches';

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
  // v3: knowledge_base now comes from the structured compiler (auto-derived
  // hours/policies/team + voiceFaq + legacy freeform) instead of the raw
  // textarea — see knowledge-compiler.ts.
  const [knowledgeBase, servicesSnap] = await Promise.all([
    compileKnowledgeBase(db, tenantId, tenant),
    db.collection(`tenants/${tenantId}/services`).get(),
  ]);
  const services = servicesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  const va = tenant?.voiceAgent || {};
  const transferNumber = (va.transferNumber || '').trim();
  const consultationService = va.consultationServiceId
    ? services.find((s: any) => s.id === va.consultationServiceId)
    : null;

  // Niche: preset id resolves to its spoken phrase; freeform text still wins
  // for tenants who typed their own.
  const niche = nicheById(va.businessNicheId);
  const businessNiche =
    (va.businessNiche || '').trim() || niche?.spoken || '';

  // Consultation guide, three sources in priority order:
  //   1. a consent/intake form from the form builder (consultationFormId) —
  //      question-type fields become the script, options offered verbally
  //   2. the structured question list (consultationQuestions: string[])
  //   3. the legacy freeform consultationGuide text
  let consultationGuide = '';
  if (va.consultationSource === 'form' && va.consultationFormId) {
    try {
      const formSnap = await db
        .doc(`tenants/${tenantId}/consentForms/${va.consultationFormId}`)
        .get();
      if (formSnap.exists) {
        const form = formSnap.data() as any;
        const questionTypes = ['short-text', 'long-text', 'multiple-choice', 'checkboxes'];
        const lines = (form.fields || [])
          .filter((f: any) => questionTypes.includes(f.type) && (f.label || '').trim())
          .map((f: any, i: number) => {
            const opts =
              Array.isArray(f.options) && f.options.length > 0
                ? ` (offer these options: ${f.options.join(', ')})`
                : '';
            return `${i + 1}. ${f.label.trim()}${opts}`;
          });
        consultationGuide = lines.join('\n');
      }
    } catch { /* fall through */ }
  }
  if (!consultationGuide && Array.isArray(va.consultationQuestions)) {
    consultationGuide = va.consultationQuestions
      .filter((q: any) => typeof q === 'string' && q.trim())
      .map((q: string, i: number) => `${i + 1}. ${q.trim()}`)
      .join('\n');
  }
  if (!consultationGuide) consultationGuide = (va.consultationGuide || '').trim();

  return {
    tenant_id: tenantId,
    agent_name: (va.agentName || '').trim() || DEFAULT_AGENT_NAME,
    studio_name: tenant?.name || tenant?.locationName || 'the studio',
    business_niche: businessNiche,
    knowledge_base: knowledgeBase,
    consultation_guide: consultationGuide,
    paid_consultation_service: consultationService?.name || '',
    has_transfer: transferNumber ? 'true' : 'false',
    transfer_number: transferNumber,
  };
}
