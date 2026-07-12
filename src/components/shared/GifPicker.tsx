'use client';

/**
 * GifPicker — v1
 *
 * The fun layer: search and send GIFs in team messages. Powered by
 * Tenor's free API — get a key at console.cloud.google.com (enable the
 * Tenor API, create an API key) and set it in Vercel as
 * NEXT_PUBLIC_TENOR_API_KEY. Until the key exists, the GIF button simply
 * doesn't render — no broken half-feature.
 *
 * Selected GIFs are sent as regular image messages (hotlinked from
 * Tenor's CDN — no Storage upload, no rules change needed).
 */

import React, { useState, useEffect, useRef } from 'react';
import { Loader, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const GIF_ENABLED = !!process.env.NEXT_PUBLIC_TENOR_API_KEY;

export function GifPicker({
  onSelect,
  onClose,
  className,
}: {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const [search, setSearch] = useState('');
  const [gifs, setGifs] = useState<{ id: string; url: string; preview: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGifs = async (q: string) => {
    const key = process.env.NEXT_PUBLIC_TENOR_API_KEY;
    if (!key) return;
    setLoading(true);
    try {
      const endpoint = q.trim()
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${key}&limit=24&media_filter=tinygif,gif`
        : `https://tenor.googleapis.com/v2/featured?key=${key}&limit=24&media_filter=tinygif,gif`;
      const res = await fetch(endpoint);
      const data = await res.json();
      setGifs((data?.results || []).map((r: any) => ({
        id: r.id,
        url: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url,
        preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
      })).filter((g: any) => g.url));
    } catch {
      setGifs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGifs(''); }, []);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchGifs(search), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  return (
    <div className={cn('rounded-xl border-2 bg-white p-3 space-y-2', className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search GIFs..."
            autoFocus
            className="w-full h-9 rounded-lg border-2 pl-9 pr-3 text-xs font-bold"
          />
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/40">
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
        {loading && <div className="col-span-3 py-8 flex justify-center"><Loader className="w-4 h-4 animate-spin text-slate-300" /></div>}
        {!loading && gifs.map(g => (
          <button key={g.id} onClick={() => onSelect(g.url)} className="rounded-lg overflow-hidden border hover:border-indigo-400 transition-colors aspect-square">
            <img src={g.preview} alt="" className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
        {!loading && gifs.length === 0 && (
          <p className="col-span-3 text-center py-6 text-[9px] font-black uppercase text-slate-400">No GIFs found</p>
        )}
      </div>
      <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest text-right">Via Tenor</p>
    </div>
  );
}
