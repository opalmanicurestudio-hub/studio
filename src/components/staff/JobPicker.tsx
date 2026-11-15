'use client';
// src/components/staff/JobPicker.tsx — A PERSON'S JOB AND WHERE THEY WORK, on Add someone and on their card, at a food
// business only (lib/jobs; design canvas "Jobs and home screens"). Their job decides the screen they open on and their
// short menu; a cook or bartender also says which station. Part of the add/edit form: it sets `job` and `station`
// (and, while someone's being added, offers the role that goes with the job until a role is picked by hand).
import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { useTenant } from '@/context/TenantContext';
import { JOBS, jobDef, keptStation, stationFor } from '@/lib/jobs';
import { isFoodBusiness } from '@/lib/food-setup';
import { stationsOf } from '@/lib/table-service';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7';

export function JobPicker({ adding = false, roleIds = [] }: { adding?: boolean; roleIds?: string[] }) {
  const { selectedTenant } = useTenant();
  const { watch, setValue, getFieldState } = useFormContext<any>();
  const job = jobDef(watch('job'));
  const stations = stationsOf(selectedTenant);
  const station = keptStation(watch('station'), stations);
  if (!isFoodBusiness(selectedTenant)) return null;

  const pick = (id: string) => {
    const j = jobDef(id); if (!j) return;
    setValue('job', j.id, { shouldDirty: true });
    setValue('station', stationFor(j, stations) || '', { shouldDirty: true });
    if (adding) {
      // The role that goes with the job, until one's picked by hand (it's only what's offered: any role can be chosen).
      if (roleIds.includes(j.role) && !getFieldState('role').isDirty) setValue('role', j.role);
      // Nobody books a server: they stay off the booking page, and are paid by the hour unless pay's been set by hand.
      if (j.id !== 'other') { setValue('showOnPublicPage', false); if (!getFieldState('payStructure').isDirty) setValue('payStructure', 'hourly'); }
    }
  };

  return (
    <div className="space-y-3 text-left">
      <div>
        <p id="job-label" className="text-[14px] font-semibold" style={{ color: INK }}>Job</p>
        <p className="text-[13px]" style={{ color: MUTED }}>Their job decides the screen they open on.</p>
      </div>
      <div role="radiogroup" aria-labelledby="job-label" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {JOBS.map((j) => {
          const on = job?.id === j.id;
          return (
            <button key={j.id} type="button" role="radio" aria-checked={on} onClick={() => pick(j.id)}
              className="min-h-[44px] rounded-xl px-2 text-[14px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2"
              style={on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{j.name}</button>
          );
        })}
      </div>
      {job?.station && stations.length > 0 && (
        <label className="block">
          <span className="text-[14px] font-semibold" style={{ color: INK }}>Works at</span>
          <select value={station || ''} onChange={(e) => setValue('station', e.target.value, { shouldDirty: true })}
            className="mt-1.5 min-h-[44px] w-full rounded-xl bg-[#fff] px-3 text-[15px] outline-none focus:border-[#16171a]" style={{ border: `1px solid ${LINE}`, color: INK }}>
            {!station && <option value="">Pick a station</option>}
            {stations.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {job && <p className="rounded-xl px-3 py-2.5 text-[13.5px] leading-relaxed" style={{ background: SOFT, color: INK }}>{job.line}{adding && job.id !== 'other' ? ' They skip services and booking hours.' : ''}</p>}
    </div>
  );
}

/** A job that isn't booked: adding them skips services and booking hours. */
export const skipsBooking = (job: unknown) => { const j = jobDef(job); return !!j && j.id !== 'other'; };
