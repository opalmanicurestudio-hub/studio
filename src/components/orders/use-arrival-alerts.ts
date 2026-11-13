'use client';
// src/components/orders/use-arrival-alerts.ts — WHO JUST ARRIVED, for the screens that watch pickups (the Orders screen,
// components/orders/PickupsScreen): each new arrival is announced once (a sound, a vibration and the screen's message,
// read out by a screen reader), and a customer waiting five minutes outside with nobody on the way asks the team again
// (lib/fulfil-client notifyCurbside, staff_escalation), once per order per screen. Both follow the screen's own idea of
// an arrival (Pickups counts someone who arrived before their order was bagged).
import * as React from 'react';
import { notifyCurbside } from '@/lib/fulfil-client';
import { curbsideWaitMinutes } from '@/lib/retail-orders';
import { feel } from './ui';

export const ESCALATE_AFTER_MIN = 5;

export function useArrivalAlerts(orders: any[], now: number, tenantId: string, onArrive: (o: any) => void, isArrival: (o: any) => boolean = (o) => o?.stage === 'arrived') {
  const arrivedKey = orders.filter(isArrival).map((o) => o.id).join(',');
  const announced = React.useRef<Set<string>>(new Set());
  const say = React.useRef(onArrive); say.current = onArrive;
  React.useEffect(() => {
    const fresh = orders.filter((o) => isArrival(o) && !announced.current.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => announced.current.add(o.id)); feel(true);
    say.current(fresh[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedKey]);
  const escalated = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!tenantId) return;
    for (const o of orders) {
      if (!isArrival(o) || escalated.current.has(o.id) || o.curbside?.bringingOutAt) continue;
      const m = curbsideWaitMinutes(o, new Date(now)); if (m === null || m < ESCALATE_AFTER_MIN) continue;
      escalated.current.add(o.id); notifyCurbside(tenantId, o.id, 'staff_escalation');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, now, tenantId]);
}
