'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  Star, Clock, Users, MapPin, Phone, ArrowRight, FileText, Calendar,
  ChevronRight, Palette, Check, Plus, Minus, Gift, Crown, Share2,
  BookOpen, Sparkles, Loader, ArrowDown, Mail, Instagram, CheckCircle2,
  ChevronDown, Flame,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { PurchaseSheet } from '@/components/booking/PurchaseSheet';
import { Button } from '@/components/ui/button';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import {
  type Tenant, type Service, type Staff, type Appointment, type Event,
  type ConsentForm, type PricingTier, type Membership, type Package,
  type PageBuilderConfig, type PageSection,
} from '@/lib/data';

// ─── Safe helpers ──────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, sanitizeForFirestore(v)]));
};

// ─── Theme system ──────────────────────────────────────────────────────────────
export type BookingTheme = 'editorial' | 'soft_spa' | 'dark_glam' | 'bold_studio' | 'minimal_clean';

const BOOKING_THEMES: Record<BookingTheme, {
  label: string; headingFont: string; bodyFont: string;
  splashStyle: 'centered' | 'split' | 'dramatic' | 'minimal';
  heroOverlay: string; vars: Record<string, string>;
}> = {
  editorial: {
    label: 'Editorial', headingFont: 'system-ui, sans-serif', bodyFont: 'system-ui, sans-serif',
    splashStyle: 'centered', heroOverlay: 'bg-gradient-to-b from-white/60 via-white/20 to-white/90',
    vars: { '--primary': '0 0% 9%', '--primary-foreground': '0 0% 100%', '--background': '0 0% 100%', '--foreground': '0 0% 9%', '--muted': '0 0% 96%', '--muted-foreground': '0 0% 45%', '--border': '0 0% 89%', '--card': '0 0% 100%', '--card-foreground': '0 0% 9%', '--radius': '1rem' },
  },
  soft_spa: {
    label: 'Soft Spa', headingFont: "Georgia, 'Times New Roman', serif", bodyFont: "Georgia, serif",
    splashStyle: 'split', heroOverlay: 'bg-gradient-to-r from-[#fdf6ef]/95 via-[#fdf6ef]/60 to-transparent',
    vars: { '--primary': '340 28% 58%', '--primary-foreground': '0 0% 100%', '--background': '35 28% 97%', '--foreground': '20 20% 18%', '--muted': '35 22% 92%', '--muted-foreground': '20 12% 46%', '--border': '35 22% 86%', '--card': '35 28% 99%', '--card-foreground': '20 20% 18%', '--radius': '1.5rem' },
  },
  dark_glam: {
    label: 'Dark Glam', headingFont: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", bodyFont: 'system-ui, sans-serif',
    splashStyle: 'dramatic', heroOverlay: 'bg-gradient-to-b from-[#090909]/70 via-transparent to-[#090909]/95',
    vars: { '--primary': '44 72% 52%', '--primary-foreground': '0 0% 5%', '--background': '0 0% 6%', '--foreground': '0 0% 93%', '--muted': '0 0% 12%', '--muted-foreground': '0 0% 58%', '--border': '0 0% 18%', '--card': '0 0% 9%', '--card-foreground': '0 0% 93%', '--radius': '0.5rem' },
  },
  bold_studio: {
    label: 'Bold Studio', headingFont: 'system-ui, sans-serif', bodyFont: 'system-ui, sans-serif',
    splashStyle: 'centered', heroOverlay: 'bg-gradient-to-br from-violet-600/80 via-purple-500/60 to-pink-400/40',
    vars: { '--primary': '262 75% 58%', '--primary-foreground': '0 0% 100%', '--background': '0 0% 100%', '--foreground': '262 30% 10%', '--muted': '262 18% 96%', '--muted-foreground': '262 15% 44%', '--border': '262 18% 88%', '--card': '0 0% 100%', '--card-foreground': '262 30% 10%', '--radius': '2rem' },
  },
  minimal_clean: {
    label: 'Minimal Clean', headingFont: "'Gill Sans', Calibri, 'Trebuchet MS', sans-serif", bodyFont: "'Gill Sans', Calibri, sans-serif",
    splashStyle: 'minimal', heroOverlay: 'bg-white/90',
    vars: { '--primary': '210 22% 32%', '--primary-foreground': '0 0% 100%', '--background': '0 0% 99%', '--foreground': '210 18% 14%', '--muted': '210 12% 96%', '--muted-foreground': '210 10% 48%', '--border': '210 12% 91%', '--card': '0 0% 100%', '--card-foreground': '210 18% 14%', '--radius': '0.375rem' },
  },
};

const FONT_STACKS: Record<string, string> = {
  cormorant:  "'Cormorant Garamond', Georgia, serif",
  playfair:   "'Playfair Display', Georgia, serif",
  lora:       "'Lora', Georgia, serif",
  space:      "'Space Grotesk', system-ui, sans-serif",
  josefin:    "'Josefin Sans', system-ui, sans-serif",
  raleway:    "'Raleway', system-ui, sans-serif",
  bebas:      "'Bebas Neue', Impact, sans-serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
  oswald:     "'Oswald', system-ui, sans-serif",
  georgia:    'Georgia, serif',
  system:     'system-ui, sans-serif',
};

function buildThemeStyle(theme: BookingTheme, customPrimary?: string): React.CSSProperties {
  const vars = { ...BOOKING_THEMES[theme].vars };
  if (customPrimary) {
    const hsl = customPrimary.startsWith('#') ? hexToHSLComponents(customPrimary) : customPrimary;
    if (hsl) vars['--primary'] = hsl;
  }
  return vars as React.CSSProperties;
}

// ─── Page style derivation ─────────────────────────────────────────────────────
interface PS {
  headingStack: string;
  bodyStack:    string;
  bgColor:      string;
  textColor:    string;
  textMuted:    string;
  borderColor:  string;
  isDark:       boolean;
}

function isDarkHex(hex: string): boolean {
  if (!hex?.startsWith('#')) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
}
function hexToRgba(hex: string, a: number) {
  if (!hex?.startsWith('#')) return `rgba(0,0,0,${a})`;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function derivePS(theme: BookingTheme, pageConfig?: PageBuilderConfig | null): PS {
  const tc  = BOOKING_THEMES[theme];
  const bg  = pageConfig?.bgColor || '';
  const dark = bg ? isDarkHex(bg) : theme === 'dark_glam';
  return {
    headingStack: FONT_STACKS[pageConfig?.headingFont || ''] || tc.headingFont,
    bodyStack:    FONT_STACKS[pageConfig?.bodyFont    || ''] || tc.bodyFont,
    bgColor:      bg,
    textColor:    dark ? '#e8e0d0' : '#111111',
    textMuted:    dark ? 'rgba(232,224,208,0.5)' : 'rgba(17,17,17,0.45)',
    borderColor:  dark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.1)',
    isDark:       dark,
  };
}

// ─── Default sections (used when no pageConfig saved yet) ──────────────────────
const DEFAULT_SECTIONS: PageSection[] = [
  { id: 'nav',      type: 'nav',      enabled: true, order: 0, config: { logoText: '', ctaText: 'Book Now', showLinks: true } },
  { id: 'hero',     type: 'hero',     enabled: true, order: 1, config: { headline: 'Book Your Experience', subheadline: 'A sanctuary of craft, curated for those who appreciate the details.', ctaText: 'Book a Session', cta2Text: 'Walk In', layout: 'centered' } },
  { id: 'services', type: 'services', enabled: true, order: 2, config: { heading: 'Our Services', subheading: 'Handcrafted treatments for every occasion', layout: 'cards', showPrices: true, showDuration: true } },
  { id: 'team',     type: 'team',     enabled: true, order: 3, config: { heading: 'The Artists', subheading: 'Expert hands for every style', layout: 'circles', showSpecialties: true } },
  { id: 'quote',    type: 'quote',    enabled: true, order: 4, config: { heading: 'Need Something Bigger?', subheading: 'Planning a wedding, bridal party, or corporate event? We craft bespoke experiences.', ctaText: 'Request a Quote', tags: 'Bridal Parties,Corporate Events,Destination Services' } },
];

// ─── Scroll reveal hook ────────────────────────────────────────────────────────
function useScrollReveal(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const style = document.createElement('style');
    style.id = '__sr';
    style.textContent = '.sr{opacity:0;transform:translateY(24px);transition:opacity 0.65s ease,transform 0.65s ease}.sr.sv{opacity:1;transform:none}';
    if (!document.getElementById('__sr')) document.head.appendChild(style);
    const obs = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('sv'); obs.unobserve(e.target); } }),
      { threshold: 0.06 },
    );
    setTimeout(() => document.querySelectorAll('.sr').forEach(el => obs.observe(el)), 300);
    return () => obs.disconnect();
  }, [ready]);
}

// ─── Section heading component ─────────────────────────────────────────────────
const SH = ({ title, sub, ps, center = true }: { title: string; sub?: string; ps: PS; center?: boolean }) => (
  <div className={cn('mb-12', center && 'text-center')}>
    <h2 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: 'clamp(28px,4.5vw,46px)', fontWeight: 300, lineHeight: 1.08, letterSpacing: '0.02em', marginBottom: sub ? '10px' : '0' }}>
      {title}
    </h2>
    {sub && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '14px', lineHeight: 1.7 }}>{sub}</p>}
    <div style={{ width: '28px', height: '1px', background: 'var(--primary)', margin: center ? '14px auto 0' : '14px 0 0', opacity: 0.5 }} />
  </div>
);

// ─── SECTION COMPONENTS ────────────────────────────────────────────────────────

const NavSection = ({ config, ps, tenant, tenantId }: { config: any; ps: PS; tenant: Tenant | null | undefined; tenantId: string }) => (
  <nav className="sticky top-0 z-50 px-6 md:px-12 py-4 flex items-center justify-between" style={{ background: ps.bgColor ? `${ps.bgColor}ee` : 'var(--background)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${ps.borderColor}` }}>
    <div>
      {tenant?.bookingPageSettings?.logoUrl
        ? <img src={tenant.bookingPageSettings.logoUrl} alt={tenant.name} className="h-8 object-contain" />
        : <span style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '18px', fontWeight: 400, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{config.logoText || tenant?.name}</span>}
    </div>
    <div className="flex items-center gap-2">
      {config.showLinks !== false && (
        <>
          <Link href="#services" className="hidden md:block px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors hover:opacity-70" style={{ fontFamily: ps.bodyStack, color: ps.textMuted }}>Services</Link>
          <Link href={`/inquiry/${tenantId}`} className="hidden sm:block px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors hover:opacity-70" style={{ fontFamily: ps.bodyStack, color: ps.textMuted }}>Events</Link>
        </>
      )}
      <button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
        className="px-5 py-2.5 rounded-[var(--radius)] text-xs font-black uppercase tracking-widest shadow-lg transition-all hover:opacity-90 active:scale-95"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
        {config.ctaText || 'Book Now'}
      </button>
    </div>
  </nav>
);

const HeroSection = ({ config, ps, tenant, tenantId, onBook }: { config: any; ps: PS; tenant: Tenant | null | undefined; tenantId: string; onBook: () => void }) => {
  const heroImg = tenant?.bookingPageSettings?.heroImageUrl || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop';
  const layout = config.layout || 'centered';
  const isFullbleed = layout === 'fullbleed';
  return (
    <section className={cn('sr relative', isFullbleed ? 'min-h-[75vh] flex items-center justify-center' : 'py-20 md:py-32')}>
      {(layout === 'fullbleed' || layout === 'split') && (
        <div className={cn('absolute', layout === 'fullbleed' ? 'inset-0' : 'hidden md:block inset-y-0 right-0 w-1/2')}>
          <Image src={heroImg} alt="Studio" fill className="object-cover" priority />
          <div className="absolute inset-0" style={{ background: layout === 'fullbleed' ? 'rgba(0,0,0,0.45)' : 'linear-gradient(to left, transparent, var(--background) 20%)' }} />
        </div>
      )}
      <div className={cn('relative z-10 max-w-3xl', layout === 'centered' || layout === 'fullbleed' ? 'mx-auto text-center px-6' : 'px-6 md:px-12 w-full md:w-1/2')}>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="text-xs font-bold uppercase tracking-[0.4em] mb-4"
          style={{ color: layout === 'fullbleed' ? 'rgba(255,255,255,0.6)' : 'var(--muted-foreground)', fontFamily: ps.bodyStack }}>
          {tenant?.name}
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8 }}
          style={{ fontFamily: ps.headingStack, color: layout === 'fullbleed' ? '#fff' : ps.textColor, fontSize: 'clamp(36px,6vw,72px)', fontWeight: 300, lineHeight: 1.06, letterSpacing: '0.01em', marginBottom: '20px' }}>
          {config.headline || 'Book Your Experience'}
        </motion.h1>
        {config.subheadline && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            style={{ fontFamily: ps.bodyStack, color: layout === 'fullbleed' ? 'rgba(255,255,255,0.7)' : ps.textMuted, fontSize: '16px', lineHeight: 1.8, marginBottom: '32px', maxWidth: '520px', margin: '0 auto 32px' }}>
            {config.subheadline}
          </motion.p>
        )}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="flex flex-wrap gap-3 justify-center items-center">
          <button onClick={onBook}
            className="px-8 py-4 rounded-[var(--radius)] text-sm font-black uppercase tracking-widest shadow-2xl transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
            {config.ctaText || 'Book a Session'}
          </button>
          {config.cta2Text && (
            <Link href={`/kiosk/${tenantId}`} className="px-6 py-4 rounded-[var(--radius)] text-sm font-black uppercase tracking-widest border-2 transition-all hover:opacity-80"
              style={{ borderColor: layout === 'fullbleed' ? 'rgba(255,255,255,0.3)' : ps.borderColor, color: layout === 'fullbleed' ? '#fff' : ps.textColor, fontFamily: ps.bodyStack }}>
              {config.cta2Text}
            </Link>
          )}
        </motion.div>
      </div>
    </section>
  );
};

const TrustSection = ({ config, ps }: { config: any; ps: PS }) => {
  const stats = [
    { label: config.stat1l || 'Happy clients', value: config.stat1v || '500+' },
    { label: config.stat2l || 'Avg rating',    value: config.stat2v || '4.9 ★' },
    { label: config.stat3l || 'Years open',    value: config.stat3v || '6' },
    { label: config.stat4l || 'Services',      value: config.stat4v || '20+' },
  ];
  return (
    <section className="sr py-10 px-6 md:px-12" style={{ background: hexToRgba('var(--primary)' as any, 0.04), borderTop: `1px solid ${ps.borderColor}`, borderBottom: `1px solid ${ps.borderColor}` }}>
      <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        {stats.map((s, i) => (
          <div key={i} className="text-center space-y-1">
            <div style={{ fontFamily: ps.headingStack, color: 'var(--primary)', fontSize: 'clamp(28px,4vw,42px)', fontWeight: 300 }}>{s.value}</div>
            <div style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

const ServicesSection = ({ config, ps, services, onBook }: { config: any; ps: PS; services: Service[]; onBook: (s: Service) => void }) => (
  <section id="services" className="sr py-20 px-6 md:px-12 scroll-mt-20 max-w-6xl mx-auto">
    <SH title={config.heading || 'Our Services'} sub={config.subheading} ps={ps} />
    {config.showFilters !== false && services.length > 0 && (() => {
      const cats = [...new Set(services.map(s => s.category).filter(Boolean))];
      return cats.length > 1 ? (
        <div className="flex flex-wrap gap-2 justify-center mb-10">
          {cats.map(c => <span key={c} className="px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest cursor-pointer border-2 transition-all" style={{ borderColor: ps.borderColor, color: ps.textMuted, fontFamily: ps.bodyStack }}>{c}</span>)}
        </div>
      ) : null;
    })()}
    <div className={cn(config.layout === 'list' ? 'space-y-3' : 'grid gap-6', config.layout !== 'list' && (config.columns === '3' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : config.columns === '1' ? 'grid-cols-1 max-w-xl mx-auto' : 'grid-cols-1 sm:grid-cols-2'))}>
      {services.filter(s => !s.isPrivate && s.status !== 'archived').map((service, i) => (
        <motion.div key={service.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06, duration: 0.5 }}>
          {config.layout === 'list' ? (
            <div className="flex items-center justify-between p-5 rounded-[var(--radius)] border-2 cursor-pointer transition-all hover:border-primary group" style={{ borderColor: ps.borderColor, background: 'var(--card)' }} onClick={() => onBook(service)}>
              <div>
                <p style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '18px', fontWeight: 300 }}>{service.name}</p>
                {config.showDuration !== false && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '12px' }}>{service.duration} min</p>}
              </div>
              {config.showPrices !== false && <p style={{ fontFamily: ps.bodyStack, color: 'var(--primary)', fontSize: '18px', fontWeight: 600 }}>${service.price.toFixed(0)}</p>}
            </div>
          ) : (
            <div className="group cursor-pointer rounded-[var(--radius)] border-2 overflow-hidden transition-all hover:shadow-xl" style={{ borderColor: ps.borderColor, background: 'var(--card)' }} onClick={() => onBook(service)}>
              <div className="relative h-48 overflow-hidden" style={{ background: 'var(--muted)' }}>
                {service.imageUrl
                  ? <Image src={service.imageUrl} alt={service.name} fill className="object-cover transition-transform duration-700 group-hover:scale-105" />
                  : <div className="absolute inset-0 flex items-center justify-center opacity-20"><Sparkles className="w-12 h-12" style={{ color: 'var(--primary)' }} /></div>}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                {config.showDuration !== false && (
                  <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1" style={{ background: 'var(--card)', color: ps.textMuted, fontFamily: ps.bodyStack }}>
                    <Clock className="w-3 h-3" /> {service.duration}m
                  </div>
                )}
              </div>
              <div className="p-5 space-y-2">
                <div className="flex items-start justify-between">
                  <h3 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '19px', fontWeight: 300 }}>{service.name}</h3>
                  {config.showPrices !== false && <span style={{ fontFamily: ps.bodyStack, color: 'var(--primary)', fontSize: '17px', fontWeight: 600 }}>${service.price.toFixed(0)}</span>}
                </div>
                {config.showDesc !== false && service.description && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '13px', lineHeight: 1.6 }} className="line-clamp-2">{service.description}</p>}
              </div>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  </section>
);

const TeamSection = ({ config, ps, staff, onBook }: { config: any; ps: PS; staff: Staff[]; onBook: (staffId: string) => void }) => {
  const visible = staff.filter(s => s.showOnPublicPage !== false && s.active !== false);
  if (!visible.length) return null;
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto">
      <SH title={config.heading || 'The Artists'} sub={config.subheading} ps={ps} />
      <div className={cn('flex flex-wrap justify-center gap-8', config.layout === 'grid' && 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4')}>
        {visible.map((member, i) => (
          <motion.div key={member.id} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.07, duration: 0.5 }}
            className={cn('flex flex-col items-center gap-3 text-center cursor-pointer group', config.layout === 'row' ? 'flex-row text-left' : '')}>
            <div className="relative overflow-hidden shrink-0" style={{ width: config.layout === 'circles' ? '80px' : '100px', height: config.layout === 'circles' ? '80px' : '100px', borderRadius: config.layout === 'circles' ? '50%' : 'var(--radius)', background: 'var(--muted)' }}>
              {member.avatarUrl
                ? <Image src={member.avatarUrl} alt={member.name} fill className="object-cover transition-transform duration-500 group-hover:scale-110" />
                : <div className="absolute inset-0 flex items-center justify-center text-xl font-bold" style={{ fontFamily: ps.headingStack, color: 'var(--primary)' }}>{member.name?.[0]}</div>}
            </div>
            <div>
              <p style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '16px', fontWeight: 300 }}>{member.name}</p>
              <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{member.role === 'staff' ? 'Artist' : member.role}</p>
              {config.showSpecialties && member.specialties?.slice(0, 2).map(sp => (
                <span key={sp} className="inline-block mr-1 mt-1 px-2 py-0.5 rounded-full text-[9px] uppercase font-semibold tracking-widest" style={{ background: hexToRgba('', 0.08), color: 'var(--primary)', fontFamily: ps.bodyStack }}>
                  {sp}
                </span>
              ))}
              {config.showBookButton && (
                <button onClick={() => onBook(member.id)} className="mt-2 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest border-2 transition-all hover:opacity-70"
                  style={{ borderColor: 'var(--primary)', color: 'var(--primary)', fontFamily: ps.bodyStack }}>Book</button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const ReviewsSection = ({ config, ps }: { config: any; ps: PS }) => {
  const reviews = [
    { name: 'Sarah M.',    text: 'Absolutely divine. The atmosphere alone makes it worth every visit — I leave feeling completely restored.', rating: 5 },
    { name: 'Jessica T.', text: 'The attention to detail is unmatched. My nails have never looked better, and the service is always so personalized.', rating: 5 },
    { name: 'Amanda L.',  text: "I've been coming here for two years and have never been disappointed. A true sanctuary.", rating: 5 },
    { name: 'Rachel K.',  text: 'Booked for my bridal party — it was flawless. Every single one of my girls was glowing.', rating: 5 },
  ];
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto">
      <SH title={config.heading || 'What Clients Say'} sub={config.subheading} ps={ps} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reviews.map((r, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
            className="p-7 rounded-[var(--radius)] border-2 space-y-4" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}>
            {config.showRating !== false && <div className="flex gap-0.5">{[...Array(r.rating)].map((_, j) => <Star key={j} className="w-3.5 h-3.5 fill-current" style={{ color: 'var(--primary)' }} />)}</div>}
            <p style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '16px', fontWeight: 300, fontStyle: 'italic', lineHeight: 1.75 }}>"{r.text}"</p>
            <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{r.name}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const GallerySection = ({ config, ps }: { config: any; ps: PS }) => (
  <section className="sr py-20 px-6 md:px-12 max-w-6xl mx-auto">
    <SH title={config.heading || 'Our Work'} sub={config.subheading} ps={ps} />
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {[
        'https://images.unsplash.com/photo-1604654894610-df63bc536371?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1604654894610-df63bc536372?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1604654894610-df63bc536373?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1604654894610-df63bc536374?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1604654894610-df63bc536375?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1604654894610-df63bc536376?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1604654894610-df63bc536378?q=80&w=400&auto=format&fit=crop',
      ].map((src, i) => (
        <div key={i} className="relative aspect-square rounded-[var(--radius)] overflow-hidden group" style={{ background: 'var(--muted)' }}>
          <Image src={src} alt="Gallery" fill className="object-cover transition-transform duration-700 group-hover:scale-105" />
        </div>
      ))}
    </div>
  </section>
);

const BeforeAfterSection = ({ config, ps }: { config: any; ps: PS }) => (
  <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto">
    <SH title={config.heading || 'Transformations'} sub={config.subheading} ps={ps} />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {[1, 2].map(i => (
        <div key={i} className="rounded-[var(--radius)] border-2 overflow-hidden" style={{ borderColor: ps.borderColor }}>
          <div className="grid grid-cols-2">
            <div className="relative h-48" style={{ background: 'var(--muted)' }}>
              <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--card)', color: ps.textMuted, fontFamily: ps.bodyStack }}>Before</div>
            </div>
            <div className="relative h-48" style={{ background: 'var(--muted)' }}>
              <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--card)', color: 'var(--primary)', fontFamily: ps.bodyStack }}>After</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
);

const MembershipsSection = ({ config, ps, memberships, onPurchase }: { config: any; ps: PS; memberships: Membership[]; onPurchase: (m: Membership) => void }) => {
  if (!memberships.length) return null;
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto">
      <SH title={config.heading || 'Join the Club'} sub={config.subheading} ps={ps} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {memberships.filter(m => !m.isPrivate).map((m, i) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
            className="rounded-[var(--radius)] border-2 p-7 space-y-5 cursor-pointer transition-all hover:shadow-xl group" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}
            onClick={() => onPurchase(m)}>
            <div>
              <h3 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '22px', fontWeight: 300, marginBottom: '8px' }}>{m.name}</h3>
              <div style={{ fontFamily: ps.bodyStack, color: 'var(--primary)', fontSize: '28px', fontWeight: 300 }}>${m.price}<span style={{ fontSize: '13px', opacity: 0.6 }}>/{m.interval === 'monthly' ? 'mo' : 'yr'}</span></div>
            </div>
            {m.description && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '13px', lineHeight: 1.65 }}>{m.description}</p>}
            {(m.includedServices || []).slice(0, 4).map((perk, j) => (
              <div key={j} className="flex items-center gap-2"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--primary)' }} /><span style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '13px' }}>{perk.name} × {perk.quantity}</span></div>
            ))}
            <button className="w-full h-10 rounded-[var(--radius)] border-2 text-xs font-bold uppercase tracking-widest transition-all group-hover:opacity-80"
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)', fontFamily: ps.bodyStack }}>Join</button>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const PackagesSection = ({ config, ps, packages, services, onPurchase }: { config: any; ps: PS; packages: Package[]; services: Service[]; onPurchase: (p: Package) => void }) => {
  if (!packages.length) return null;
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto">
      <SH title={config.heading || 'Prepaid Sessions'} sub={config.subheading} ps={ps} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {packages.filter(p => !p.isPrivate).map((pkg, i) => {
          const svc = services.find(s => s.id === pkg.serviceId);
          const perSession = pkg.sessions > 0 ? (pkg.price / pkg.sessions).toFixed(2) : null;
          const savings = svc ? ((svc.price * pkg.sessions - pkg.price)).toFixed(0) : null;
          return (
            <motion.div key={pkg.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
              className="rounded-[var(--radius)] border-2 p-7 space-y-5 cursor-pointer transition-all hover:shadow-xl" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}
              onClick={() => onPurchase(pkg)}>
              {savings && Number(savings) > 0 && config.showSavings !== false && (
                <div className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest" style={{ background: hexToRgba('', 0.08), color: 'var(--primary)', fontFamily: ps.bodyStack }}>Save ${savings}</div>
              )}
              <div>
                <h3 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '20px', fontWeight: 300 }}>{pkg.name}</h3>
                {svc && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '13px', marginTop: '4px' }}>{pkg.sessions} × {svc.name}</p>}
              </div>
              <div style={{ fontFamily: ps.bodyStack, color: 'var(--primary)', fontSize: '28px', fontWeight: 300 }}>${pkg.price.toFixed(0)}</div>
              {perSession && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '12px' }}>${perSession} per session</p>}
              <button className="w-full h-10 rounded-[var(--radius)] text-xs font-bold uppercase tracking-widest text-white transition-all hover:opacity-90"
                style={{ background: 'var(--primary)', fontFamily: ps.bodyStack }}>Purchase</button>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};

const GiftCardsSection = ({ config, ps, tenantId }: { config: any; ps: PS; tenantId: string }) => {
  const amounts = (config.amounts || '25,50,75,100').split(',').map(Number).filter(Boolean);
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-4xl mx-auto text-center">
      <SH title={config.heading || 'Give the Gift of Beauty'} sub={config.subheading} ps={ps} />
      <div className="flex flex-wrap justify-center gap-3 mb-8">
        {amounts.map(a => (
          <div key={a} className="px-6 py-3 rounded-[var(--radius)] border-2 cursor-pointer transition-all hover:border-primary" style={{ borderColor: ps.borderColor, fontFamily: ps.bodyStack, color: 'var(--primary)', fontSize: '18px', fontWeight: 600 }}>${a}</div>
        ))}
      </div>
      <button className="px-8 py-4 rounded-[var(--radius)] text-sm font-black uppercase tracking-widest shadow-lg transition-all hover:opacity-90"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
        {config.ctaText || 'Send a Gift Card'}
      </button>
    </section>
  );
};

const QuoteSection = ({ config, ps, tenantId }: { config: any; ps: PS; tenantId: string }) => {
  const tags = (config.tags || 'Bridal Parties,Corporate Events,Destination Services').split(',').filter(Boolean);
  return (
    <section className="sr py-16 px-6 md:px-12 max-w-5xl mx-auto">
      <div className="rounded-[var(--radius)] border-2 p-8 md:p-14 relative overflow-hidden" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}>
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" style={{ background: hexToRgba('', 0.05) }} />
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1 space-y-4 text-center md:text-left">
            <p className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--primary)', fontFamily: ps.bodyStack, opacity: 0.7 }}>Custom Events & Groups</p>
            <h2 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: 'clamp(24px,4vw,40px)', fontWeight: 300, lineHeight: 1.1 }}>{config.heading || 'Need Something Bigger?'}</h2>
            <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '15px', lineHeight: 1.75 }}>{config.subheading}</p>
            <div className="flex flex-wrap gap-2 justify-center md:justify-start">
              {tags.map(tag => <span key={tag} className="px-3 py-1 rounded-full border text-xs font-semibold uppercase tracking-widest" style={{ borderColor: ps.borderColor, color: ps.textMuted, fontFamily: ps.bodyStack }}>{tag}</span>)}
            </div>
          </div>
          <div className="shrink-0">
            <Link href={`/inquiry/${tenantId}`} className="flex items-center gap-2 px-8 py-4 rounded-[var(--radius)] text-sm font-black uppercase tracking-widest shadow-lg transition-all hover:opacity-90 group"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack, textDecoration: 'none' }}>
              {config.ctaText || 'Request a Quote'}<ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <p className="text-xs text-center mt-3 opacity-50" style={{ fontFamily: ps.bodyStack, color: ps.textMuted }}>We respond within 24–48 hours</p>
          </div>
        </div>
      </div>
    </section>
  );
};

const NewClientSection = ({ config, ps, onBook }: { config: any; ps: PS; onBook: () => void }) => (
  <section className="sr py-16 px-6 md:px-12 max-w-4xl mx-auto text-center">
    <div className="rounded-[var(--radius)] border-2 p-10 md:p-14 space-y-6" style={{ border: `2px solid var(--primary)`, background: hexToRgba('', 0.04) }}>
      <Sparkles className="w-8 h-8 mx-auto" style={{ color: 'var(--primary)' }} />
      <h2 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: 'clamp(28px,4vw,44px)', fontWeight: 300 }}>{config.heading || 'First Visit Special'}</h2>
      <p style={{ fontFamily: ps.headingStack, color: 'var(--primary)', fontSize: 'clamp(22px,3.5vw,36px)', fontStyle: 'italic', fontWeight: 300 }}>{config.offerText || '20% off your first appointment'}</p>
      <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '12px' }}>{config.finePrint || 'Valid for new clients only.'}</p>
      <button onClick={onBook} className="px-8 py-4 rounded-[var(--radius)] text-sm font-black uppercase tracking-widest shadow-lg transition-all hover:opacity-90"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
        {config.ctaText || 'Claim Offer'}
      </button>
    </div>
  </section>
);

const FAQSection = ({ config, ps }: { config: any; ps: PS }) => {
  const [open, setOpen] = useState<number | null>(null);
  const questions = [
    { q: config.q1 || 'How do I book an appointment?', a: config.a1 || 'Use the Book Now button above or select any service to get started.' },
    { q: config.q2 || 'What is your cancellation policy?', a: config.a2 || 'We require 24 hours notice for all cancellations to avoid a fee.' },
    { q: config.q3 || 'Do you accept walk-ins?', a: config.a3 || 'Yes! Walk-ins are welcome based on availability.' },
    { q: config.q4 || 'Do you offer gift cards?', a: config.a4 || 'Absolutely — gift cards are available in any amount.' },
  ].filter(item => item.q);
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-3xl mx-auto">
      <SH title={config.heading || 'Common Questions'} ps={ps} />
      <div className="space-y-2">
        {questions.map((item, i) => (
          <div key={i} className="rounded-[var(--radius)] border-2 overflow-hidden" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}>
            <button onClick={() => setOpen(open === i ? null : i)} className="w-full px-6 py-5 flex items-center justify-between text-left gap-4">
              <span style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '17px', fontWeight: 300 }}>{item.q}</span>
              {open === i ? <Minus className="w-4 h-4 shrink-0" style={{ color: 'var(--primary)' }} /> : <Plus className="w-4 h-4 shrink-0" style={{ color: 'var(--muted-foreground)' }} />}
            </button>
            <AnimatePresence>
              {open === i && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <p className="px-6 pb-5 text-sm leading-relaxed" style={{ fontFamily: ps.bodyStack, color: ps.textMuted }}>{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
};

const PoliciesSection = ({ config, ps, tenant }: { config: any; ps: PS; tenant: Tenant | null | undefined }) => {
  const policies = [
    { label: 'Cancellation', text: config.cancelText || tenant?.cancellationPolicy || 'Please provide 24 hours notice for all cancellations.' },
    { label: 'Late Arrival',  text: config.lateText   || tenant?.lateArrivalPolicy  || 'Arrivals 15+ minutes late may need to reschedule.' },
    { label: 'No-Show',       text: config.noshowText || tenant?.noShowPolicy        || 'No-shows may be required to prepay future bookings.' },
  ];
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-4xl mx-auto">
      <SH title={config.heading || 'Our Policies'} ps={ps} center={false} />
      <div className="space-y-6">
        {policies.map(p => (
          <div key={p.label} className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--primary)', fontFamily: ps.bodyStack }}>{p.label}</p>
            <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '14px', lineHeight: 1.75 }}>{p.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

const ContactSection = ({ config, ps, tenant }: { config: any; ps: PS; tenant: Tenant | null | undefined }) => (
  <section className="sr py-20 px-6 md:px-12 max-w-4xl mx-auto">
    <SH title={config.heading || 'Find Us'} ps={ps} center={false} />
    <div className="space-y-5">
      {config.showHours !== false && config.customHours && (
        <div className="flex items-start gap-3">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '14px', lineHeight: 1.8, whiteSpace: 'pre-line' }}>{config.customHours}</p>
        </div>
      )}
      {config.showMap !== false && tenant?.studioAddress && (
        <div className="flex items-start gap-3">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '14px' }}>{tenant.studioAddress}</p>
        </div>
      )}
      {config.showPhone !== false && (tenant as any)?.phone && (
        <div className="flex items-center gap-3">
          <Phone className="w-4 h-4 shrink-0" style={{ color: 'var(--primary)' }} />
          <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '14px' }}>{(tenant as any).phone}</p>
        </div>
      )}
    </div>
  </section>
);

const EventsSection = ({ config, ps, events }: { config: any; ps: PS; events: Event[] }) => {
  const upcoming = events.filter(e => new Date(e.startTime) > new Date()).slice(0, 4);
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto">
      <SH title={config.heading || 'Upcoming Events'} sub={config.subheading} ps={ps} />
      {upcoming.length === 0 ? (
        <div className="text-center py-12 opacity-40">
          <Calendar className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--muted-foreground)' }} />
          <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '14px' }}>{config.emptyText || 'Check back soon for upcoming events!'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {upcoming.map(evt => (
            <div key={evt.id} className="rounded-[var(--radius)] border-2 p-6 space-y-2" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}>
              <p style={{ fontFamily: ps.bodyStack, color: 'var(--primary)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em' }}>{format(safeDate(evt.startTime), 'MMM d, yyyy')}</p>
              <h3 style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '20px', fontWeight: 300 }}>{evt.title}</h3>
              {evt.notes && <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '13px', lineHeight: 1.6 }} className="line-clamp-2">{evt.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const ReferralSection = ({ config, ps }: { config: any; ps: PS }) => (
  <section className="sr py-20 px-6 md:px-12 max-w-4xl mx-auto text-center">
    <Share2 className="w-8 h-8 mx-auto mb-4" style={{ color: 'var(--primary)' }} />
    <SH title={config.heading || 'Refer a Friend'} sub={config.subheading} ps={ps} />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 max-w-xl mx-auto">
      <div className="rounded-[var(--radius)] border-2 p-6 space-y-2" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}>
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--primary)', fontFamily: ps.bodyStack }}>You get</p>
        <p style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '28px', fontWeight: 300 }}>{config.rewardYou || '$15 credit'}</p>
      </div>
      <div className="rounded-[var(--radius)] border-2 p-6 space-y-2" style={{ borderColor: ps.borderColor, background: 'var(--card)' }}>
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--primary)', fontFamily: ps.bodyStack }}>They get</p>
        <p style={{ fontFamily: ps.headingStack, color: ps.textColor, fontSize: '28px', fontWeight: 300 }}>{config.rewardFriend || '$15 off'}</p>
      </div>
    </div>
    <button className="px-8 py-4 rounded-[var(--radius)] text-sm font-black uppercase tracking-widest shadow-lg transition-all hover:opacity-90"
      style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
      {config.ctaText || 'Get My Referral Link'}
    </button>
  </section>
);

const StorySection = ({ config, ps }: { config: any; ps: PS }) => (
  <section className="sr py-20 px-6 md:px-12 max-w-3xl mx-auto text-center space-y-6">
    <BookOpen className="w-8 h-8 mx-auto" style={{ color: 'var(--primary)' }} />
    <SH title={config.heading || 'Our Story'} ps={ps} />
    <p style={{ fontFamily: ps.headingStack, color: ps.textMuted, fontSize: '18px', fontWeight: 300, fontStyle: 'italic', lineHeight: 1.85 }}>{config.body}</p>
    {config.ctaText && (
      <button className="px-6 py-3 rounded-[var(--radius)] border-2 text-sm font-semibold uppercase tracking-widest transition-all hover:opacity-70"
        style={{ borderColor: ps.borderColor, color: ps.textColor, fontFamily: ps.bodyStack }}>{config.ctaText}</button>
    )}
  </section>
);

const InstagramSection = ({ config, ps }: { config: any; ps: PS }) => (
  <section className="sr py-20 px-6 md:px-12 max-w-5xl mx-auto text-center">
    <SH title={config.heading || 'Follow Along'} ps={ps} />
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
      {[...Array(6)].map((_, i) => <div key={i} className="aspect-square rounded-[var(--radius)] opacity-30" style={{ background: 'var(--muted)' }} />)}
    </div>
    <a href={`https://instagram.com/${(config.handle || '@studio').replace('@', '')}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-6 py-3 rounded-[var(--radius)] border-2 text-sm font-semibold uppercase tracking-widest transition-all hover:opacity-70"
      style={{ borderColor: ps.borderColor, color: ps.textColor, fontFamily: ps.bodyStack, textDecoration: 'none' }}>
      <Instagram className="w-4 h-4" />{config.ctaText || 'Follow us on Instagram'}
    </a>
  </section>
);

const WaitlistSection = ({ config, ps }: { config: any; ps: PS }) => {
  const [email, setEmail] = useState('');
  const [done,  setDone]  = useState(false);
  return (
    <section className="sr py-20 px-6 md:px-12 max-w-2xl mx-auto text-center space-y-6">
      <Bell className="w-8 h-8 mx-auto" style={{ color: 'var(--primary)' }} />
      <SH title={config.heading || 'Fully Booked?'} sub={config.subheading} ps={ps} />
      {done ? (
        <div className="flex items-center justify-center gap-2" style={{ color: 'var(--primary)', fontFamily: ps.bodyStack }}>
          <CheckCircle2 className="w-5 h-5" /><span className="font-semibold text-sm">You're on the waitlist!</span>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
            className="flex-1 h-12 px-4 rounded-[var(--radius)] border-2 text-sm" style={{ borderColor: ps.borderColor, background: 'var(--card)', color: ps.textColor, fontFamily: ps.bodyStack }} />
          <button onClick={() => email && setDone(true)} className="h-12 px-6 rounded-[var(--radius)] text-xs font-black uppercase tracking-widest shrink-0"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
            {config.ctaText || 'Join Waitlist'}
          </button>
        </div>
      )}
    </section>
  );
};

// ─── Mobile sticky CTA ─────────────────────────────────────────────────────────
const MobileStickyBar = ({ visible, onBook, ps }: { visible: boolean; onBook: () => void; ps: PS }) => (
  <AnimatePresence>
    {visible && (
      <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ duration: 0.3 }}
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 p-4 flex gap-3" style={{ background: 'var(--background)', borderTop: `1px solid var(--border)` }}>
        <button onClick={onBook} className="flex-1 h-12 rounded-[var(--radius)] text-xs font-black uppercase tracking-widest shadow-lg"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', fontFamily: ps.bodyStack }}>
          Book Now
        </button>
      </motion.div>
    )}
  </AnimatePresence>
);

// ─── Theme preview pill ────────────────────────────────────────────────────────
const ThemePreviewPill = ({ theme, onChange }: { theme: BookingTheme; onChange: (t: BookingTheme) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="flex flex-col gap-1.5 p-3 rounded-2xl bg-white border-2 border-slate-200 shadow-2xl">
            {(Object.keys(BOOKING_THEMES) as BookingTheme[]).map(t => (
              <button key={t} onClick={() => { onChange(t); setOpen(false); }}
                className={cn('flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all text-sm', t === theme ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-700')}>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: `hsl(${BOOKING_THEMES[t].vars['--primary']})` }} />
                <span className="text-[10px] font-black uppercase tracking-widest">{BOOKING_THEMES[t].label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border-2 border-slate-200 shadow-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all text-slate-700">
        <Palette className="w-3.5 h-3.5" style={{ color: `hsl(${BOOKING_THEMES[theme].vars['--primary']})` }} />
        {BOOKING_THEMES[theme].label}
      </button>
    </div>
  );
};

// ─── Splash screens (kept from existing) ──────────────────────────────────────
const SplashCentered = ({ tenant, tenantId, theme, onEnter }: { tenant: any; tenantId: string; theme: BookingTheme; onEnter: () => void }) => (
  <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8, ease: [0.16,1,0.3,1] }} className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background">
    <div className="absolute inset-0 z-0">
      <Image src={tenant?.bookingPageSettings?.heroImageUrl || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop'} alt="Studio" fill className={cn('object-cover', BOOKING_THEMES[theme].heroOverlay.includes('violet') ? 'opacity-30' : 'opacity-20')} priority />
      <div className={cn('absolute inset-0', BOOKING_THEMES[theme].heroOverlay)} />
    </div>
    <motion.div initial={{ opacity: 0, scale: 0.92, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.2, duration: 1, ease: [0.16,1,0.3,1] }} className="relative z-10 flex flex-col items-center text-center px-6 w-full max-w-lg mx-auto">
      <BookingHeader tenant={tenant} />
      <div className="mt-8 flex flex-col gap-3 w-full max-w-xs mx-auto">
        <Button size="lg" onClick={onEnter} className="h-14 rounded-[var(--radius)] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 group w-full">
          View Service Menu<ArrowDown className="ml-2 h-4 w-4 transition-transform group-hover:translate-y-1" />
        </Button>
        <Button size="lg" variant="outline" asChild className="h-12 rounded-[var(--radius)] text-[10px] font-black uppercase tracking-[0.2em] border-2 bg-background/50 backdrop-blur-sm w-full">
          <Link href={`/kiosk/${tenantId}`}><Users className="mr-2 h-4 w-4" />Join Queue</Link>
        </Button>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.6 }} className="mt-4">
        <Link href={`/inquiry/${tenantId}`} className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground hover:text-primary transition-colors">
          <FileText className="w-3.5 h-3.5" />Planning an event? Request a quote<ArrowRight className="w-3 h-3" />
        </Link>
      </motion.div>
    </motion.div>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 1 }} className="absolute bottom-10 flex flex-col items-center gap-2 text-muted-foreground">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-40">Scroll to Explore</p>
      <ArrowDown className="w-4 h-4 animate-bounce" />
    </motion.div>
  </motion.div>
);

const SplashSplit = ({ tenant, tenantId, onEnter }: { tenant: any; tenantId: string; onEnter: () => void }) => (
  <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} className="fixed inset-0 z-[100] flex overflow-hidden bg-background">
    <motion.div initial={{ opacity: 0, x: -32 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.9, ease: [0.16,1,0.3,1] }} className="relative z-10 flex flex-col justify-center px-10 md:px-16 w-full md:w-1/2 py-12">
      <div className="max-w-sm space-y-8">
        <BookingHeader tenant={tenant} />
        <div className="space-y-3 w-full">
          <Button size="lg" onClick={onEnter} className="h-14 w-full rounded-full text-[11px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 group">
            View Services<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
          <Button size="lg" variant="outline" asChild className="h-12 w-full rounded-full text-[10px] font-black uppercase tracking-widest border-2 border-primary/20">
            <Link href={`/kiosk/${tenantId}`}><Users className="mr-2 h-4 w-4" />Walk In</Link>
          </Button>
        </div>
        <Link href={`/inquiry/${tenantId}`} className="inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
          <FileText className="w-3.5 h-3.5" />Request a custom event quote<ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </motion.div>
    <motion.div initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: [0.16,1,0.3,1] }} className="hidden md:block w-1/2 relative">
      <Image src={tenant?.bookingPageSettings?.heroImageUrl || 'https://images.unsplash.com/photo-1604654894610-df63bc536371?q=80&w=1974&auto=format&fit=crop'} alt="Studio" fill className="object-cover" priority />
      <div className="absolute inset-0 bg-gradient-to-l from-transparent to-background/20" />
    </motion.div>
  </motion.div>
);

const SplashDramatic = ({ tenant, tenantId, onEnter }: { tenant: any; tenantId: string; onEnter: () => void }) => (
  <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#090909]">
    <div className="absolute inset-0 z-0">
      <Image src={tenant?.bookingPageSettings?.heroImageUrl || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop'} alt="Studio" fill className="object-cover opacity-15 scale-105" priority />
      <div className="absolute inset-0 bg-gradient-to-b from-[#090909]/60 via-transparent to-[#090909]/95" />
    </div>
    <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.8, duration: 0.8 }} className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg,transparent,hsl(44 72% 52%),transparent)' }} />
    <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 1, ease: [0.16,1,0.3,1] }} className="relative z-10 flex flex-col items-center text-center px-6 w-full max-w-2xl mx-auto space-y-8">
      <div className="space-y-4">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} className="text-[9px] font-black uppercase tracking-[0.5em]" style={{ color: 'hsl(44 72% 52% / 0.6)' }}>{tenant?.name || 'Studio'}</motion.p>
        <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.8 }} className="text-4xl sm:text-6xl md:text-7xl font-black uppercase tracking-tighter text-white leading-none" style={{ fontFamily: "'Palatino Linotype', Palatino, serif" }}>
          {tenant?.bookingPageSettings?.heroTitle || 'Book Your Experience'}
        </motion.h1>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1, duration: 0.6 }} className="h-px w-32 mx-auto" style={{ background: 'hsl(44 72% 52%)' }} />
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.6 }} className="flex flex-col sm:flex-row gap-3 w-full max-w-sm mx-auto">
        <Button size="lg" onClick={onEnter} className="h-12 sm:h-14 flex-1 text-[10px] font-black uppercase tracking-[0.3em] rounded-none border" style={{ background: 'hsl(44 72% 52% / 0.1)', borderColor: 'hsl(44 72% 52% / 0.3)', color: 'hsl(44 72% 52%)' }}>Enter Studio</Button>
        <Button size="lg" variant="outline" asChild className="h-12 sm:h-14 flex-1 text-[10px] font-black uppercase tracking-[0.3em] rounded-none border bg-transparent" style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
          <Link href={`/kiosk/${tenantId}`}>Walk In</Link>
        </Button>
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.6 }}>
        <Link href={`/inquiry/${tenantId}`} className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.3em] hover:opacity-80 transition-opacity" style={{ color: 'hsl(44 72% 52% / 0.5)' }}>
          <FileText className="w-3 h-3" />Custom event quote
        </Link>
      </motion.div>
    </motion.div>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8, duration: 1 }} className="absolute bottom-8 flex flex-col items-center gap-2" style={{ color: 'hsl(44 72% 52%)' }}>
      <div className="h-8 w-px" style={{ background: 'linear-gradient(to bottom, transparent, hsl(44 72% 52%))' }} />
      <ArrowDown className="w-4 h-4 animate-bounce opacity-60" />
    </motion.div>
  </motion.div>
);

const SplashMinimal = ({ tenant, tenantId, onEnter }: { tenant: any; tenantId: string; onEnter: () => void }) => (
  <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background overflow-hidden">
    <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'repeating-linear-gradient(0deg,currentColor 0px,currentColor 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,currentColor 0px,currentColor 1px,transparent 1px,transparent 40px)' }} />
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7 }} className="relative z-10 flex flex-col items-center text-center px-8 w-full max-w-md mx-auto space-y-10">
      <div className="space-y-6"><div className="h-px w-16 mx-auto bg-border" /><BookingHeader tenant={tenant} /><div className="h-px w-16 mx-auto bg-border" /></div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button size="lg" onClick={onEnter} className="h-12 w-full rounded-sm text-[10px] font-black uppercase tracking-[0.2em]">Book an Appointment</Button>
        <Button size="lg" variant="outline" asChild className="h-10 w-full rounded-sm text-[9px] font-bold uppercase tracking-[0.2em] border border-border shadow-none">
          <Link href={`/kiosk/${tenantId}`}>Walk-In Queue</Link>
        </Button>
      </div>
      <Link href={`/inquiry/${tenantId}`} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors border-b border-border pb-0.5">Request a custom quote →</Link>
    </motion.div>
  </motion.div>
);

const SplashScreen = ({ tenant, tenantId, theme, onEnter }: { tenant: any; tenantId: string; theme: BookingTheme; onEnter: () => void }) => {
  const style = BOOKING_THEMES[theme].splashStyle;
  if (style === 'split')    return <SplashSplit    tenant={tenant} tenantId={tenantId} onEnter={onEnter} />;
  if (style === 'dramatic') return <SplashDramatic tenant={tenant} tenantId={tenantId} onEnter={onEnter} />;
  if (style === 'minimal')  return <SplashMinimal  tenant={tenant} tenantId={tenantId} onEnter={onEnter} />;
  return <SplashCentered tenant={tenant} tenantId={tenantId} theme={theme} onEnter={onEnter} />;
};

// ─── Section renderer ──────────────────────────────────────────────────────────
function renderSection(
  section: PageSection,
  ps: PS,
  data: {
    tenant: Tenant | null | undefined;
    tenantId: string;
    services: Service[];
    staff: Staff[];
    memberships: Membership[];
    packages: Package[];
    events: Event[];
    onBook: (service?: Service) => void;
    onBookStaff: (staffId: string) => void;
    onPurchase: (item: Membership | Package, type: 'membership' | 'package') => void;
  },
) {
  const c = section.config;
  switch (section.type) {
    case 'nav':         return <NavSection          key={section.id} config={c} ps={ps} tenant={data.tenant} tenantId={data.tenantId} />;
    case 'hero':        return <HeroSection         key={section.id} config={c} ps={ps} tenant={data.tenant} tenantId={data.tenantId} onBook={() => data.onBook()} />;
    case 'trust':       return <TrustSection        key={section.id} config={c} ps={ps} />;
    case 'services':    return <ServicesSection     key={section.id} config={c} ps={ps} services={data.services} onBook={s => data.onBook(s)} />;
    case 'team':        return <TeamSection         key={section.id} config={c} ps={ps} staff={data.staff} onBook={data.onBookStaff} />;
    case 'reviews':     return <ReviewsSection      key={section.id} config={c} ps={ps} />;
    case 'gallery':     return <GallerySection      key={section.id} config={c} ps={ps} />;
    case 'beforeafter': return <BeforeAfterSection  key={section.id} config={c} ps={ps} />;
    case 'memberships': return <MembershipsSection  key={section.id} config={c} ps={ps} memberships={data.memberships} onPurchase={m => data.onPurchase(m, 'membership')} />;
    case 'packages':    return <PackagesSection     key={section.id} config={c} ps={ps} packages={data.packages} services={data.services} onPurchase={p => data.onPurchase(p, 'package')} />;
    case 'giftcards':   return <GiftCardsSection    key={section.id} config={c} ps={ps} tenantId={data.tenantId} />;
    case 'quote':       return <QuoteSection        key={section.id} config={c} ps={ps} tenantId={data.tenantId} />;
    case 'newclient':   return <NewClientSection    key={section.id} config={c} ps={ps} onBook={() => data.onBook()} />;
    case 'faq':         return <FAQSection          key={section.id} config={c} ps={ps} />;
    case 'policies':    return <PoliciesSection     key={section.id} config={c} ps={ps} tenant={data.tenant} />;
    case 'contact':     return <ContactSection      key={section.id} config={c} ps={ps} tenant={data.tenant} />;
    case 'events':      return <EventsSection       key={section.id} config={c} ps={ps} events={data.events} />;
    case 'referral':    return <ReferralSection     key={section.id} config={c} ps={ps} />;
    case 'story':       return <StorySection        key={section.id} config={c} ps={ps} />;
    case 'instagram':   return <InstagramSection    key={section.id} config={c} ps={ps} />;
    case 'waitlist':    return <WaitlistSection     key={section.id} config={c} ps={ps} />;
    default: return null;
  }
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function BookingPage() {
  const params    = useParams();
  const tenantId  = params.tenantId as string;
  const { firestore } = useFirebase();
  const { toast }     = useToast();

  const [entered,             setEntered]             = useState(false);
  const [selectedService,     setSelectedService]     = useState<Service | null>(null);
  const [initialStaffId,      setInitialStaffId]      = useState<string | undefined>();
  const [isSheetOpen,         setIsSheetOpen]         = useState(false);
  const [itemToPurchase,      setItemToPurchase]      = useState<Membership | Package | null>(null);
  const [purchaseType,        setPurchaseType]        = useState<'membership' | 'package' | null>(null);
  const [isPurchaseSheetOpen, setIsPurchaseSheetOpen] = useState(false);
  const [previewTheme,        setPreviewTheme]        = useState<BookingTheme | null>(null);
  const [showMobileCTA,       setShowMobileCTA]       = useState(false);

  // ── Data ───────────────────────────────────────────────────────────────────
  const tenantDocRef          = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`),                                                                                    [firestore, tenantId]);
  const servicesQuery         = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`),                                                                    [firestore, tenantId]);
  const staffQuery            = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`),                                                                       [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where('isActive', '==', true)),                      [firestore, tenantId]);
  const allAppointmentsQuery  = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`),                                                               [firestore, tenantId]);
  const allEventsQuery        = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`),                                                                     [firestore, tenantId]);
  const consentFormsQuery     = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`),                                                               [firestore, tenantId]);
  const pricingTiersQuery     = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`),                                                               [firestore, tenantId]);
  const membershipsQuery      = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/memberships`),                                                                [firestore, tenantId]);
  const packagesQuery         = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/packages`),                                                                   [firestore, tenantId]);

  const { data: tenant,             isLoading: l1  } = useDoc<Tenant>(tenantDocRef);
  const { data: services,           isLoading: l2  } = useCollection<Service>(servicesQuery);
  const { data: staff,              isLoading: l3  } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles,   isLoading: l4  } = useCollection<any>(scheduleProfilesQuery);
  const { data: appointmentsFromDB, isLoading: l5  } = useCollection<Appointment>(allAppointmentsQuery);
  const { data: eventsFromDB,       isLoading: l6  } = useCollection<Event>(allEventsQuery);
  const { data: consentForms,       isLoading: l7  } = useCollection<ConsentForm>(consentFormsQuery);
  const { data: pricingTiers,       isLoading: l8  } = useCollection<PricingTier>(pricingTiersQuery);
  const { data: memberships,        isLoading: l9  } = useCollection<Membership>(membershipsQuery);
  const { data: packages,           isLoading: l10 } = useCollection<Package>(packagesQuery);

  const appointments = useMemo(() => (appointmentsFromDB || []).map(a => ({ ...a, startTime: safeDate(a.startTime), endTime: safeDate(a.endTime) })), [appointmentsFromDB]);
  const events       = useMemo(() => (eventsFromDB || []).map(e => ({ ...e, startTime: safeDate(e.startTime), endTime: safeDate(e.endTime) })), [eventsFromDB]);

  // ── Theme & page config ────────────────────────────────────────────────────
  const activeTheme: BookingTheme  = previewTheme ?? ((tenant?.bookingPageSettings?.theme as BookingTheme) || 'editorial');
  const pageConfig: PageBuilderConfig | null = (tenant?.bookingPageSettings as any)?.pageConfig || null;
  const ps: PS                     = useMemo(() => derivePS(activeTheme, pageConfig), [activeTheme, pageConfig]);

  const orderedSections: PageSection[] = useMemo(() => {
    const sections = pageConfig?.sections?.length ? pageConfig.sections : DEFAULT_SECTIONS;
    return sections.filter(s => s.enabled).sort((a, b) => a.order - b.order);
  }, [pageConfig]);

  // ── CSS var injection (themes + page config overrides + fonts) ─────────────
  useEffect(() => {
    if (!tenant) return;
    const root = document.documentElement;
    Object.entries(BOOKING_THEMES[activeTheme].vars).forEach(([k, v]) => root.style.setProperty(k, v));
    const primaryOverride = pageConfig?.accentColor || tenant.bookingPageSettings?.primaryColor;
    if (primaryOverride) {
      const hsl = hexToHSLComponents(primaryOverride);
      if (hsl) root.style.setProperty('--primary', hsl);
    }
    root.style.setProperty('--booking-heading-font', ps.headingStack);
    root.style.setProperty('--booking-body-font',    ps.bodyStack);
    return () => {
      Object.keys(BOOKING_THEMES[activeTheme].vars).forEach(k => root.style.removeProperty(k));
      root.style.removeProperty('--booking-heading-font');
      root.style.removeProperty('--booking-body-font');
    };
  }, [activeTheme, tenant, pageConfig, ps]);

  // ── Google Fonts ───────────────────────────────────────────────────────────
  useEffect(() => {
    const id = '__booking_fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Playfair+Display:wght@400;500&family=Lora:ital,wght@0,400;1,400&family=Space+Grotesk:wght@300;400;500;700&family=Josefin+Sans:wght@300;400;600&family=Raleway:wght@300;400;600&family=Bebas+Neue&family=Montserrat:wght@300;400;500;700&family=Oswald:wght@300;400;500&display=swap';
    document.head.appendChild(link);
  }, []);

  // ── Scroll reveal ──────────────────────────────────────────────────────────
  useScrollReveal(entered);

  // ── Mobile CTA on scroll ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setShowMobileCTA(window.scrollY > 300);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleBook = (service?: Service) => {
    if (service) { setSelectedService(service); setInitialStaffId(undefined); }
    else {
      const first = (services || []).find(s => !s.isPrivate && s.status !== 'archived');
      if (first) { setSelectedService(first); setInitialStaffId(undefined); }
    }
    setIsSheetOpen(true);
  };
  const handleBookStaff = (staffId: string) => {
    const first = (services || []).find(s => !s.isPrivate && s.status !== 'archived');
    if (first) { setSelectedService(first); setInitialStaffId(staffId); setIsSheetOpen(true); }
  };
  const handlePurchase = (item: Membership | Package, type: 'membership' | 'package') => {
    setItemToPurchase(item); setPurchaseType(type); setIsPurchaseSheetOpen(true);
  };

  const handleConfirmBooking = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
    signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
    setBookingStep: (step: string) => void,
  ) => {
    if (!firestore) return;
    const batch = writeBatch(firestore);
    try {
      const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
      const qs         = await getDocs(query(clientsRef, where('email', '==', formData.clientEmail.toLowerCase())));
      let clientId: string;
      let clientName = formData.clientName;
      if (qs.empty) {
        const ref = doc(clientsRef); clientId = ref.id;
        batch.set(ref, sanitizeForFirestore({ id: clientId, name: formData.clientName, email: formData.clientEmail, phone: formData.clientPhone || '', avatarUrl: `https://picsum.photos/seed/${clientId}/100/100`, lifetimeValue: 0, lastAppointment: new Date().toISOString(), status: 'active' }));
      } else { clientId = qs.docs[0].id; clientName = qs.docs[0].data().name; }
      const aptRef = doc(collection(firestore, `tenants/${tenantId}/appointments`));
      const token  = nanoid(16);
      const newApt = { ...appointmentDetails, id: aptRef.id, tenantId, clientId, clientName, clientEmail: formData.clientEmail, clientPhone: formData.clientPhone, checkInToken: token };
      batch.set(aptRef, sanitizeForFirestore(newApt));
      batch.set(doc(firestore, 'appointmentCheckIns', token), sanitizeForFirestore(newApt));
      signedForms.forEach(f => { const r = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`)); batch.set(r, sanitizeForFirestore({ ...f, id: r.id, clientId, signedAt: new Date().toISOString() })); });
      if (newApt.staffId) { const nr = doc(collection(firestore, `tenants/${tenantId}/notifications`)); batch.set(nr, sanitizeForFirestore({ id: nanoid(), userId: newApt.staffId, type: 'new_appointment', message: `New booking: ${formData.clientName}`, link: '/planner', createdAt: new Date().toISOString(), read: false })); }
      await batch.commit();
      toast({ title: 'Booking Confirmed!' });
      setBookingStep('confirmation');
    } catch { toast({ variant: 'destructive', title: 'Booking Failed' }); }
  };

  if (l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8 || l9 || l10) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
        <Loader className="h-10 w-10 animate-spin text-primary" />
        <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Initializing Studio...</p>
      </div>
    );
  }

  const sectionData = {
    tenant, tenantId, services: services || [], staff: staff || [],
    memberships: memberships || [], packages: packages || [], events: events || [],
    onBook: handleBook, onBookStaff: handleBookStaff, onPurchase: handlePurchase,
  };

  return (
    <div className="relative min-h-screen w-full" style={{ ...buildThemeStyle(activeTheme, tenant?.bookingPageSettings?.primaryColor), background: ps.bgColor || 'var(--background)', fontFamily: ps.bodyStack }}>

      {/* Splash */}
      <AnimatePresence>
        {!entered && <SplashScreen tenant={tenant} tenantId={tenantId} theme={activeTheme} onEnter={() => setEntered(true)} />}
      </AnimatePresence>

      {/* Main content */}
      <main className={cn('relative transition-all duration-1000', !entered ? 'opacity-0 translate-y-10 pointer-events-none' : 'opacity-100 translate-y-0')}>

        {/* Dynamic section rendering */}
        {orderedSections.map(section => renderSection(section, ps, sectionData))}

        {/* Footer */}
        <footer className="py-14 px-6 text-center" style={{ borderTop: `1px solid ${ps.borderColor}`, background: ps.isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.02)' }}>
          <div className="max-w-md mx-auto space-y-4">
            <Sparkles className="w-8 h-8 mx-auto opacity-20" style={{ color: 'var(--primary)' }} />
            <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Handcrafted by {tenant?.name}</p>
            <div className="flex justify-center gap-5">
              <Link href="#" style={{ color: ps.textMuted }}><Instagram className="w-5 h-5" /></Link>
              <Link href="#" style={{ color: ps.textMuted }}><MapPin className="w-5 h-5" /></Link>
              <Link href="#" style={{ color: ps.textMuted }}><Phone className="w-5 h-5" /></Link>
            </div>
            <Link href={`/inquiry/${tenantId}`} className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
              style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              <FileText className="w-3.5 h-3.5" />Request a Custom Quote<ArrowRight className="w-3 h-3" />
            </Link>
            <p style={{ fontFamily: ps.bodyStack, color: ps.textMuted, fontSize: '10px', opacity: 0.4 }}>© {new Date().getFullYear()} ClarityFlow</p>
          </div>
        </footer>
      </main>

      {/* Mobile sticky CTA */}
      <MobileStickyBar visible={showMobileCTA && entered} onBook={() => handleBook()} ps={ps} />

      {/* BookingSheet */}
      {selectedService && (
        <BookingSheet
          open={isSheetOpen} onOpenChange={setIsSheetOpen}
          service={selectedService} staff={staff || []}
          initialStaffId={initialStaffId}
          pricingTiers={pricingTiers || []} appointments={appointments || []}
          events={events || []} scheduleProfiles={scheduleProfiles || []}
          services={services || []} consentForms={consentForms || []}
          tenant={tenant || null} onConfirm={handleConfirmBooking}
        />
      )}

      {/* PurchaseSheet */}
      {itemToPurchase && purchaseType && (
        <PurchaseSheet
          open={isPurchaseSheetOpen} onOpenChange={setIsPurchaseSheetOpen}
          item={itemToPurchase} type={purchaseType} tenant={tenant}
          onConfirm={async () => {}}
        />
      )}

      {/* Theme preview pill — remove or flag-gate in production */}
      <ThemePreviewPill theme={activeTheme} onChange={setPreviewTheme} />
    </div>
  );
}
