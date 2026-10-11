// src/lib/doc-links.ts — WHERE A DOCUMENT SHOWS UP DURING WORK. A document can be linked to:
//   a service (optionally one step of it — a phase of the service's blueprint, e.g. "Prep" or "Turnover"),
//   a station (any room, chair or bed in Resources — its QR code opens the station's documents on the staff app),
//   a kit type (shown on visits whose service needs that kit — matched by the kit's name in the service's blueprint).
// Names are kept on the link so the staff app can show them without reading the services or kit lists.
export type DocLink =
  | { kind: 'service'; id: string; name: string; stepId?: string | null; stepLabel?: string | null }
  | { kind: 'station'; id: string; name: string }
  | { kind: 'kit'; id: string; name: string };

const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);

export function cleanLinks(raw: any): DocLink[] {
  const out: DocLink[] = []; const seen = new Set<string>();
  for (const l of Array.isArray(raw) ? raw : []) {
    const kind = l?.kind; const id = s(l?.id, 120); const name = s(l?.name, 80);
    if (!id || !['service', 'station', 'kit'].includes(kind)) continue;
    const stepId = kind === 'service' ? s(l?.stepId, 40) || null : null;
    const key = `${kind}:${id}:${stepId || ''}`; if (seen.has(key)) continue; seen.add(key);
    if (kind === 'service') out.push({ kind, id, name: name || 'Service', stepId, stepLabel: stepId ? s(l?.stepLabel, 60) || null : null });
    else out.push({ kind, id, name: name || (kind === 'station' ? 'Station' : 'Kit') } as DocLink);
    if (out.length >= 30) break;
  }
  return out;
}

export const linkLabel = (l: DocLink) => (l.kind === 'service' ? `${l.name}${l.stepLabel ? ` · ${l.stepLabel}` : ''}` : l.kind === 'station' ? `Station · ${l.name}` : `Kit · ${l.name}`);

/** The stations a visit uses (the booking's required stations, or the one it was seated at). */
export const visitStationIds = (visit: any): string[] => [...new Set([...(Array.isArray(visit?.requiredResourceIds) ? visit.requiredResourceIds : []), visit?.resourceId, visit?.stationId].filter(Boolean).map(String))];

/** The kit names a service needs (from its blueprint), lower-cased for matching. */
const kitNames = (service: any) => new Set<string>((service?.blueprint?.requirements || []).filter((r: any) => r?.kind === 'kit').map((r: any) => String(r?.name || '').trim().toLowerCase()).filter(Boolean));

export interface VisitDoc { doc: any; why: string; stepId: string | null; now: boolean }

/** Published documents that belong to this visit, with why ("Step · Prep", "Station · Chair 2", "Kit · Metal implements").
 *  `stepNow` (the step under way — its blueprint id, or its label for older services) puts that step's documents
 *  first and marks them. */
export function docsForVisit(docs: any[], visit: any, service: any, stepNow?: { id?: string | null; label?: string | null } | null): VisitDoc[] {
  if (!visit) return [];
  const sid = String(visit.serviceId || service?.id || ''); const stations = new Set(visitStationIds(visit)); const kits = kitNames(service);
  const isNow = (l: any) => !!l.stepId && !!stepNow && ((!!stepNow.id && l.stepId === stepNow.id) || (!!stepNow.label && String(l.stepLabel || '').trim().toLowerCase() === String(stepNow.label).trim().toLowerCase()));
  const out: VisitDoc[] = [];
  for (const d of docs || []) {
    if (!d || d.status !== 'published') continue;
    const links: DocLink[] = Array.isArray(d.links) ? d.links : [];
    let best: VisitDoc | null = null;
    for (const l of links) {
      let hit: VisitDoc | null = null;
      if (l.kind === 'service' && sid && l.id === sid) hit = { doc: d, why: d.category === 'aftercare' ? 'Aftercare to share' : l.stepLabel ? `Step · ${l.stepLabel}` : 'This service', stepId: l.stepId || null, now: isNow(l) };
      else if (l.kind === 'station' && stations.has(l.id)) hit = { doc: d, why: `Station · ${l.name}`, stepId: null, now: false };
      else if (l.kind === 'kit' && kits.has(String(l.name || '').trim().toLowerCase())) hit = { doc: d, why: `Kit · ${l.name}`, stepId: null, now: false };
      if (hit && (!best || (hit.now && !best.now))) best = hit;
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => Number(b.now) - Number(a.now) || String(a.doc.title || '').localeCompare(String(b.doc.title || '')));
}

/** Published documents linked to one station (what its QR code opens). */
export const docsForStation = (docs: any[], stationId: string) => (docs || []).filter((d) => d?.status === 'published' && (Array.isArray(d.links) ? d.links : []).some((l: any) => l?.kind === 'station' && l.id === stationId));
