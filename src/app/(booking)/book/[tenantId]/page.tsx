'use client';

import React, { useState, useEffect } from 'react';
import { useFirebase } from '@/firebase';
import { doc, getDoc, getDocs, collection, query, where, orderBy } from 'firebase/firestore';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';
import { cn } from '@/lib/utils';
import {
  Calendar, Clock, MapPin, Phone, Instagram,
  ChevronDown, ChevronUp, Star, Gift, Sparkles,
} from 'lucide-react';

// ─── Font stacks ──────────────────────────────────────────────────────────────
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

const GOOGLE_FONT_IDS: Record<string, string> = {
  cormorant:  'Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400',
  playfair:   'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400',
  lora:       'Lora:ital,wght@0,400;0,600;0,700;1,400',
  space:      'Space+Grotesk:wght@400;500;600;700',
  josefin:    'Josefin+Sans:wght@400;600;700',
  raleway:    'Raleway:wght@400;500;600;700',
  bebas:      'Bebas+Neue',
  montserrat: 'Montserrat:wght@400;500;600;700',
  oswald:     'Oswald:wght@400;500;600',
};

function injectFonts(headingFont: string, bodyFont: string) {
  const ids = Array.from(new Set([headingFont, bodyFont])).filter(f => GOOGLE_FONT_IDS[f]);
  if (!ids.length) return;
  document.getElementById('booking-gfonts')?.remove();
  const link = document.createElement('link');
  link.id   = 'booking-gfonts';
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${ids.map(id => `family=${GOOGLE_FONT_IDS[id]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

// ─── Style helpers ────────────────────────────────────────────────────────────
interface StyleConfig {
  accentColor: string;
  bgColor:     string;
  headingFont: string;
  bodyFont:    string;
}

interface SectionProps {
  config: Record<string, any>;
  style:  StyleConfig;
  data:   PageData;
}

interface PageData {
  tenant:   any;
  services: any[];
  staff:    any[];
  events:   any[];
}

const ac  = (s: StyleConfig) => s.accentColor || '#8b6914';
const hf  = (s: StyleConfig) => FONT_STACKS[s.headingFont] || FONT_STACKS.cormorant;
const bf  = (s: StyleConfig) => FONT_STACKS[s.bodyFont]    || FONT_STACKS.space;

// ─── Nav ──────────────────────────────────────────────────────────────────────
function NavSection({ config, style }: SectionProps) {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-14 py-4 bg-white/95 backdrop-blur-xl border-b"
         style={{ borderColor: ac(style) + '22' }}>
      <div className="flex items-center gap-3">
        {config.logoUrl
          ? <img src={config.logoUrl} alt="Logo" className="h-8 w-auto object-contain" />
          : <span className="text-xl font-bold tracking-tighter" style={{ fontFamily: hf(style), color: ac(style) }}>{config.logoText || 'Studio'}</span>
        }
      </div>
      {config.showLinks && (
        <div className="hidden md:flex items-center gap-8">
          {['Services', 'Team', 'Contact'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`}
               className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
               style={{ fontFamily: bf(style) }}>{l}</a>
          ))}
        </div>
      )}
      <button className="px-6 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest text-white shadow-lg hover:opacity-90 transition-all active:scale-95"
              style={{ background: ac(style), fontFamily: bf(style) }}>
        {config.ctaText || 'Book Now'}
      </button>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function HeroSection({ config, style }: SectionProps) {
  const isSplit    = config.layout === 'split';
  const isFullbleed = config.layout === 'fullbleed';
  const hasBg      = !!config.bgImage;
  const textColor  = hasBg ? 'white' : '#0f172a';
  const subColor   = hasBg ? 'rgba(255,255,255,0.75)' : '#64748b';

  return (
    <section className="relative flex items-center"
             style={{ minHeight: isFullbleed ? '100vh' : '80vh', background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : style.bgColor }}>
      {hasBg && <div className="absolute inset-0 bg-black/45" />}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 py-24">
        {isSplit ? (
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <h1 className="text-5xl md:text-7xl leading-[0.95] font-light" style={{ fontFamily: hf(style), color: textColor }}>
                {config.headline || 'Book Your\nExperience'}
              </h1>
              <p className="text-lg leading-relaxed max-w-md" style={{ fontFamily: bf(style), color: subColor }}>{config.subheadline}</p>
              <div className="flex flex-wrap gap-4">
                <button className="px-9 py-4 rounded-full text-white text-sm font-bold shadow-2xl hover:opacity-90 transition-all" style={{ background: ac(style) }}>{config.ctaText  || 'Book a Session'}</button>
                <button className="px-9 py-4 rounded-full text-sm font-bold border-2 hover:opacity-80 transition-all" style={{ borderColor: hasBg ? 'white' : ac(style), color: hasBg ? 'white' : ac(style) }}>{config.cta2Text || 'Walk In'}</button>
              </div>
            </div>
            {config.heroImage
              ? <img src={config.heroImage} alt="" className="w-full aspect-square object-cover rounded-[2.5rem] shadow-2xl" />
              : <div className="w-full aspect-square rounded-[2.5rem]" style={{ background: ac(style) + '18' }} />
            }
          </div>
        ) : (
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-6xl md:text-8xl leading-[0.95] font-light" style={{ fontFamily: hf(style), color: textColor }}>
              {config.headline || 'Book Your Experience'}
            </h1>
            <p className="text-xl leading-relaxed max-w-2xl mx-auto" style={{ fontFamily: bf(style), color: subColor }}>{config.subheadline}</p>
            <div className="flex flex-wrap gap-4 justify-center">
              <button className="px-12 py-4 rounded-full text-white font-bold shadow-2xl hover:opacity-90 transition-all" style={{ background: ac(style) }}>{config.ctaText  || 'Book a Session'}</button>
              <button className="px-12 py-4 rounded-full font-bold border-2 hover:opacity-80 transition-all" style={{ borderColor: hasBg ? 'white' : ac(style), color: hasBg ? 'white' : ac(style) }}>{config.cta2Text || 'Walk In'}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Trust strip ──────────────────────────────────────────────────────────────
function TrustSection({ config, style }: SectionProps) {
  const stats = [
    { v: config.stat1v, l: config.stat1l },
    { v: config.stat2v, l: config.stat2l },
    { v: config.stat3v, l: config.stat3l },
    { v: config.stat4v, l: config.stat4l },
  ].filter(s => s.v);
  return (
    <section className="py-14 border-y" style={{ borderColor: ac(style) + '20' }}>
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((s, i) => (
          <div key={i} className="space-y-1">
            <p className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{s.v}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>{s.l}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Services ─────────────────────────────────────────────────────────────────
function ServicesSection({ config, style, data }: SectionProps) {
  const services = data.services;
  const cols = parseInt(config.columns) || 2;
  const gridCls = cols === 1 ? 'grid-cols-1 max-w-lg mx-auto' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return (
    <section id="services" className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Services'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {services.length > 0 ? (
          <div className={`grid gap-5 ${gridCls}`}>
            {services.map((svc: any) => (
              <div key={svc.id} className="group p-7 rounded-3xl border-2 bg-white hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                   style={{ borderColor: ac(style) + '25' }}>
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                  {config.showPrices && svc.price && (
                    <span className="text-base font-black" style={{ color: ac(style) }}>${svc.price}</span>
                  )}
                </div>
                {config.showDesc && svc.description && (
                  <p className="text-sm text-slate-500 leading-relaxed mb-4" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                )}
                {config.showDuration && svc.duration && (
                  <div className="flex items-center gap-1.5 mb-4">
                    <Clock className="w-3 h-3" style={{ color: ac(style) }} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>{svc.duration} min</p>
                  </div>
                )}
                <button className="w-full py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest text-white hover:opacity-90 transition-all"
                        style={{ background: ac(style) }}>Book Now</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-300" style={{ fontFamily: bf(style) }}>Services coming soon</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Team ─────────────────────────────────────────────────────────────────────
function TeamSection({ config, style, data }: SectionProps) {
  const staff = data.staff;
  return (
    <section id="team" className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'The Artists'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {staff.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">
            {staff.map((member: any) => (
              <div key={member.id} className="text-center space-y-4 group">
                <div className="relative mx-auto w-28 h-28 rounded-3xl overflow-hidden shadow-lg ring-2 ring-transparent group-hover:ring-2 transition-all"
                     style={{ background: ac(style) + '15', '--tw-ring-color': ac(style) + '40' } as any}>
                  {member.avatarUrl
                    ? <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{member.name?.[0]}</span>
                  }
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{ fontFamily: bf(style) }}>{member.name}</p>
                  {config.showSpecialties && member.specialties?.length > 0 && (
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{member.specialties.slice(0, 2).join(' · ')}</p>
                  )}
                  {config.showBio && member.bio && (
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">{member.bio}</p>
                  )}
                  {config.showBookButton && (
                    <button className="mt-3 px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white" style={{ background: ac(style) }}>Book</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-300" style={{ fontFamily: bf(style) }}>Team coming soon</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Reviews ──────────────────────────────────────────────────────────────────
function ReviewsSection({ config, style }: SectionProps) {
  const reviews = [
    { name: 'Sarah M.',   rating: 5, text: 'Absolutely incredible experience. The attention to detail is unmatched — I leave feeling taken care of every single time.' },
    { name: 'Jessica T.', rating: 5, text: "I've been coming here for over a year and every visit exceeds my expectations. The team is truly world-class." },
    { name: 'Priya K.',   rating: 5, text: 'The atmosphere is luxurious yet so welcoming. I always feel like a VIP. Truly the best in the city.' },
  ];
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'What Clients Say'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {reviews.map((r, i) => (
            <div key={i} className="p-8 rounded-3xl border-2 bg-white space-y-5" style={{ borderColor: ac(style) + '20' }}>
              {config.showRating && (
                <div className="flex gap-1">
                  {Array(r.rating).fill(0).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-current" style={{ color: ac(style) }} />
                  ))}
                </div>
              )}
              <p className="text-sm leading-relaxed text-slate-600 italic" style={{ fontFamily: bf(style) }}>"{r.text}"</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>— {r.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
function GallerySection({ config, style }: SectionProps) {
  const shades = ['08', '10', '14', '18', '12', '16'];
  return (
    <section className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Work'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {shades.map((s, i) => (
            <div key={i} className={`rounded-3xl ${i === 0 || i === 5 ? 'aspect-[4/5]' : 'aspect-square'}`}
                 style={{ background: ac(style) + s }} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Before / After ───────────────────────────────────────────────────────────
function BeforeAfterSection({ config, style }: SectionProps) {
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Transformations'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {[0, 1].map(i => (
            <div key={i} className="grid grid-cols-2 gap-2">
              {(['Before', 'After'] as const).map((label, j) => (
                <div key={j} className="aspect-square rounded-3xl flex flex-col items-center justify-center gap-2"
                     style={{ background: ac(style) + (j === 0 ? '12' : '24') }}>
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) + (j === 0 ? '80' : 'cc') }}>{label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Memberships ──────────────────────────────────────────────────────────────
function MembershipsSection({ config, style }: SectionProps) {
  const plans = [
    { name: 'Essential', price: '$89', period: '/mo', features: ['2 services/month', 'Priority booking', '10% off retail'] },
    { name: 'Luxe',      price: '$149',period: '/mo', features: ['4 services/month', 'VIP priority', '20% off retail', 'Free upgrades'], featured: true },
    { name: 'Elite',     price: '$249',period: '/mo', features: ['Unlimited services', 'Dedicated artist', '30% off retail', 'Exclusive events'] },
  ];
  return (
    <section className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Join the Club'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6 items-center">
          {plans.map((plan, i) => (
            <div key={i} className={cn('p-8 rounded-3xl border-2 space-y-6 transition-all', plan.featured ? 'shadow-2xl md:scale-105' : 'bg-white')}
                 style={{ borderColor: plan.featured ? ac(style) : ac(style) + '25', background: plan.featured ? ac(style) : 'white' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: plan.featured ? 'rgba(255,255,255,0.65)' : ac(style) }}>{plan.name}</p>
                <div className="flex items-end gap-1 mt-2">
                  <span className="text-4xl font-light" style={{ fontFamily: hf(style), color: plan.featured ? 'white' : '#0f172a' }}>{plan.price}</span>
                  <span className="text-sm mb-1" style={{ color: plan.featured ? 'rgba(255,255,255,0.5)' : '#94a3b8', fontFamily: bf(style) }}>{plan.period}</span>
                </div>
              </div>
              <ul className="space-y-2.5">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-center gap-2.5 text-sm" style={{ fontFamily: bf(style), color: plan.featured ? 'rgba(255,255,255,0.8)' : '#64748b' }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: plan.featured ? 'rgba(255,255,255,0.6)' : ac(style) }} />{f}
                  </li>
                ))}
              </ul>
              <button className="w-full py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all hover:opacity-90"
                      style={{ background: plan.featured ? 'white' : ac(style), color: plan.featured ? ac(style) : 'white' }}>Join Now</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Packages ─────────────────────────────────────────────────────────────────
function PackagesSection({ config, style }: SectionProps) {
  const pkgs = [
    { name: '5-Pack',  sessions: 5,  price: '$199', saving: 'Save 15%' },
    { name: '10-Pack', sessions: 10, price: '$349', saving: 'Save 25%' },
    { name: '20-Pack', sessions: 20, price: '$599', saving: 'Save 35%' },
  ];
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Prepaid Sessions'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {pkgs.map((pkg, i) => (
            <div key={i} className="p-8 rounded-3xl border-2 bg-white text-center space-y-5" style={{ borderColor: ac(style) + '25' }}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) }}>{pkg.name}</p>
              <p className="text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{pkg.price}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>
              {config.showExpiry && <p className="text-xs text-slate-400" style={{ fontFamily: bf(style) }}>Valid 12 months</p>}
              <span className="inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-white" style={{ background: ac(style) }}>{pkg.saving}</span>
              <button className="w-full py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest text-white hover:opacity-90 transition-all" style={{ background: ac(style) }}>Purchase</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gift Cards ───────────────────────────────────────────────────────────────
function GiftCardsSection({ config, style }: SectionProps) {
  const amounts = (config.amounts || '25,50,75,100').split(',').map((a: string) => a.trim());
  return (
    <section className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-2xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div className="space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Give the Gift of Beauty'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="p-10 rounded-[2rem] shadow-2xl space-y-8 text-white" style={{ background: `linear-gradient(135deg, ${ac(style)} 0%, ${ac(style)}cc 100%)` }}>
          <Gift className="w-12 h-12 mx-auto opacity-80" />
          <p className="text-lg font-light" style={{ fontFamily: hf(style) }}>Choose an amount</p>
          <div className="flex flex-wrap gap-3 justify-center">
            {amounts.map((a: string, i: number) => (
              <button key={i} className="px-6 py-3 rounded-2xl border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all">${a}</button>
            ))}
            <button className="px-6 py-3 rounded-2xl border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all">Custom</button>
          </div>
          <button className="px-12 py-4 rounded-full font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all"
                  style={{ background: 'white', color: ac(style) }}>{config.ctaText || 'Send a Gift Card'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Quote ────────────────────────────────────────────────────────────────────
function QuoteSection({ config, style }: SectionProps) {
  const tags = (config.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean);
  return (
    <section className="py-28 md:py-36" style={{ background: '#0f172a' }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div className="space-y-5">
          <h2 className="text-4xl md:text-6xl font-light text-white" style={{ fontFamily: hf(style) }}>{config.heading || 'Need Something Bigger?'}</h2>
          <p className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: bf(style) }}>{config.subheading}</p>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2.5 justify-center">
            {tags.map((tag: string, i: number) => (
              <span key={i} className="px-5 py-2 rounded-full border text-[11px] font-black uppercase tracking-widest text-white/55 border-white/20">{tag}</span>
            ))}
          </div>
        )}
        <button className="px-12 py-4 rounded-full font-black text-sm uppercase tracking-widest text-white shadow-2xl hover:opacity-90 transition-all"
                style={{ background: ac(style) }}>{config.ctaText || 'Request a Quote'}</button>
      </div>
    </section>
  );
}

// ─── New Client ───────────────────────────────────────────────────────────────
function NewClientSection({ config, style }: SectionProps) {
  return (
    <section className="py-16" style={{ background: ac(style) + '0e' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12 rounded-[2rem] border-2"
             style={{ borderColor: ac(style) + '28' }}>
          <div className="text-center md:text-left space-y-3">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <Sparkles className="w-4 h-4" style={{ color: ac(style) }} />
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>First Visit</p>
            </div>
            <h2 className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'First Visit Special'}</h2>
            <p className="text-xl font-black" style={{ color: ac(style), fontFamily: bf(style) }}>{config.offerText}</p>
            {config.finePrint && <p className="text-xs text-slate-400" style={{ fontFamily: bf(style) }}>{config.finePrint}</p>}
          </div>
          <button className="shrink-0 px-10 py-4 rounded-full text-white font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 transition-all"
                  style={{ background: ac(style) }}>{config.ctaText || 'Claim Offer'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQSection({ config, style }: SectionProps) {
  const [open, setOpen] = React.useState<number | null>(null);
  const items = [
    { q: config.q1, a: config.a1 },
    { q: config.q2, a: config.a2 },
    { q: config.q3, a: config.a3 },
    { q: config.q4, a: config.a4 },
  ].filter(i => i.q && i.a);
  return (
    <section className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <h2 className="text-4xl md:text-5xl font-light text-center mb-14" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Common Questions'}</h2>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="rounded-2xl border-2 overflow-hidden bg-white" style={{ borderColor: ac(style) + '22' }}>
              <button onClick={() => setOpen(open === i ? null : i)}
                      className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors">
                <span className="font-black text-sm uppercase tracking-tight text-slate-900 pr-4" style={{ fontFamily: bf(style) }}>{item.q}</span>
                {open === i
                  ? <ChevronUp   className="w-4 h-4 shrink-0" style={{ color: ac(style) }} />
                  : <ChevronDown className="w-4 h-4 shrink-0 text-slate-300" />
                }
              </button>
              {open === i && (
                <div className="px-6 pb-6 text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Policies ─────────────────────────────────────────────────────────────────
function PoliciesSection({ config, style }: SectionProps) {
  const policies = [
    { label: 'Cancellation', text: config.cancelText },
    { label: 'Late Arrival',  text: config.lateText   },
    { label: 'No-Show',       text: config.noshowText },
  ].filter(p => p.text);
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <h2 className="text-4xl md:text-5xl font-light text-center mb-14" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Policies'}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {policies.map((p, i) => (
            <div key={i} className="p-7 rounded-3xl border-2 bg-white space-y-3" style={{ borderColor: ac(style) + '22' }}>
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>{p.label}</p>
              <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────
function ContactSection({ config, style, data }: SectionProps) {
  const tenant = data.tenant;
  return (
    <section id="contact" className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <h2 className="text-4xl md:text-5xl font-light text-center mb-16" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Find Us'}</h2>
        <div className="grid md:grid-cols-2 gap-14 items-start">
          <div className="space-y-7">
            {config.showHours && config.customHours && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" style={{ color: ac(style) }} />
                  <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>Hours</p>
                </div>
                <p className="text-sm text-slate-500 leading-relaxed whitespace-pre-line" style={{ fontFamily: bf(style) }}>{config.customHours}</p>
              </div>
            )}
            {tenant?.studioAddress && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" style={{ color: ac(style) }} />
                  <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>Location</p>
                </div>
                <p className="text-sm text-slate-500" style={{ fontFamily: bf(style) }}>{tenant.studioAddress}</p>
              </div>
            )}
            {config.showPhone && tenant?.phone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4" style={{ color: ac(style) }} />
                <a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>{tenant.phone}</a>
              </div>
            )}
            {config.showSocial && tenant?.instagramHandle && (
              <div className="flex items-center gap-3">
                <Instagram className="w-4 h-4" style={{ color: ac(style) }} />
                <a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer"
                   className="text-sm text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>
                  @{tenant.instagramHandle}
                </a>
              </div>
            )}
          </div>
          {config.showMap && tenant?.studioLocation && (
            <div className="rounded-3xl overflow-hidden shadow-xl" style={{ height: '320px' }}>
              <iframe
                src={`https://maps.google.com/maps?q=${tenant.studioLocation.lat},${tenant.studioLocation.lng}&z=15&output=embed`}
                className="w-full h-full border-0"
                loading="lazy"
                title="Studio location"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────
function EventsSection({ config, style, data }: SectionProps) {
  const events = data.events;
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Upcoming Events'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {events.length > 0 ? (
          <div className="space-y-4">
            {events.map((event: any) => {
              const d = event.date ? new Date(event.date?.toDate?.() ?? event.date) : null;
              return (
                <div key={event.id} className="flex items-center gap-6 p-6 rounded-3xl border-2 bg-white hover:shadow-lg transition-all"
                     style={{ borderColor: ac(style) + '22' }}>
                  {d && (
                    <div className="shrink-0 w-14 h-14 rounded-2xl flex flex-col items-center justify-center text-white"
                         style={{ background: ac(style) }}>
                      <span className="text-[9px] font-black uppercase">{d.toLocaleString('default', { month: 'short' })}</span>
                      <span className="text-xl font-black leading-none">{d.getDate()}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{ fontFamily: bf(style) }}>{event.title || event.name}</p>
                    {event.description && <p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}
                  </div>
                  <button className="shrink-0 px-5 py-2 rounded-full text-[11px] font-black uppercase tracking-widest text-white" style={{ background: ac(style) }}>RSVP</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 space-y-4">
            <Calendar className="w-12 h-12 mx-auto text-slate-200" />
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-300" style={{ fontFamily: bf(style) }}>{config.emptyText || 'Check back soon!'}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Referral ─────────────────────────────────────────────────────────────────
function ReferralSection({ config, style }: SectionProps) {
  return (
    <section className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-4">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Refer a Friend'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid grid-cols-2 gap-5 max-w-md mx-auto">
          {[{ l: 'You get', v: config.rewardYou }, { l: 'Friend gets', v: config.rewardFriend }].map((item, i) => (
            <div key={i} className="p-6 rounded-3xl border-2 bg-white space-y-2" style={{ borderColor: ac(style) + '22' }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>{item.l}</p>
              <p className="text-2xl font-black" style={{ fontFamily: hf(style), color: ac(style) }}>{item.v}</p>
            </div>
          ))}
        </div>
        <button className="px-10 py-4 rounded-full text-white font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 transition-all"
                style={{ background: ac(style) }}>{config.ctaText || 'Get My Referral Link'}</button>
      </div>
    </section>
  );
}

// ─── Story ────────────────────────────────────────────────────────────────────
function StorySection({ config, style }: SectionProps) {
  const hasImage = !!config.image;
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className={cn('grid gap-14 items-center', hasImage ? 'md:grid-cols-2' : 'max-w-2xl mx-auto')}>
          <div className="space-y-8">
            <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</h2>
            <div className="w-12 h-px" style={{ background: ac(style) }} />
            <p className="text-base text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</p>
            {config.ctaText && (
              <button className="px-8 py-3.5 rounded-full border-2 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all"
                      style={{ borderColor: ac(style), color: ac(style) }}>{config.ctaText}</button>
            )}
          </div>
          {hasImage && (
            <img src={config.image} alt="Our Story" className="w-full aspect-square object-cover rounded-[2.5rem] shadow-2xl" />
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Instagram ────────────────────────────────────────────────────────────────
function InstagramSection({ config, style }: SectionProps) {
  const shades = ['10', '14', '18', '12', '16', '1a'];
  return (
    <section className="py-24 md:py-32 bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-3">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Follow Along'}</h2>
          <p className="text-base text-slate-400" style={{ fontFamily: bf(style) }}>{config.handle || '@studio'}</p>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {shades.map((s, i) => (
            <div key={i} className="aspect-square rounded-2xl" style={{ background: ac(style) + s }} />
          ))}
        </div>
        <a href={`https://instagram.com/${(config.handle || '').replace('@', '')}`}
           target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full border-2 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all"
           style={{ borderColor: ac(style), color: ac(style) }}>
          <Instagram className="w-4 h-4" />
          {config.ctaText || 'Follow us on Instagram'}
        </a>
      </div>
    </section>
  );
}

// ─── Waitlist ─────────────────────────────────────────────────────────────────
function WaitlistSection({ config, style }: SectionProps) {
  return (
    <section className="py-24 md:py-32" style={{ background: style.bgColor }}>
      <div className="max-w-lg mx-auto px-6 md:px-16 text-center space-y-8">
        <div className="space-y-4">
          <h2 className="text-3xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Fully Booked?'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="your@email.com"
            className="flex-1 px-4 py-3 rounded-2xl border-2 text-sm focus:outline-none"
            style={{ borderColor: ac(style) + '40', fontFamily: bf(style) }}
          />
          <button className="px-6 py-3 rounded-2xl text-white font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all"
                  style={{ background: ac(style) }}>{config.ctaText || 'Join'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({ tenant, style }: { tenant: any; style: StyleConfig }) {
  return (
    <footer className="py-8 border-t text-center" style={{ borderColor: ac(style) + '20' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>
        {tenant?.name || 'Studio'} · Powered by ClarityFlow
      </p>
    </footer>
  );
}

// ─── Section dispatcher ───────────────────────────────────────────────────────
function SectionRenderer({ section, style, data }: { section: PageSection; style: StyleConfig; data: PageData }) {
  const props = { config: section.config, style, data };
  switch (section.type) {
    case 'nav':         return <NavSection        {...props} />;
    case 'hero':        return <HeroSection       {...props} />;
    case 'trust':       return <TrustSection      {...props} />;
    case 'services':    return <ServicesSection   {...props} />;
    case 'team':        return <TeamSection       {...props} />;
    case 'reviews':     return <ReviewsSection    {...props} />;
    case 'gallery':     return <GallerySection    {...props} />;
    case 'beforeafter': return <BeforeAfterSection {...props} />;
    case 'memberships': return <MembershipsSection {...props} />;
    case 'packages':    return <PackagesSection   {...props} />;
    case 'giftcards':   return <GiftCardsSection  {...props} />;
    case 'quote':       return <QuoteSection      {...props} />;
    case 'newclient':   return <NewClientSection  {...props} />;
    case 'faq':         return <FAQSection        {...props} />;
    case 'policies':    return <PoliciesSection   {...props} />;
    case 'contact':     return <ContactSection    {...props} />;
    case 'events':      return <EventsSection     {...props} />;
    case 'referral':    return <ReferralSection   {...props} />;
    case 'story':       return <StorySection      {...props} />;
    case 'instagram':   return <InstagramSection  {...props} />;
    case 'waitlist':    return <WaitlistSection   {...props} />;
    default:            return null;
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────
function BookingPageContent({ tenantId }: { tenantId: string }) {
  const { firestore } = useFirebase();

  const [tenant,      setTenant]      = useState<any>(null);
  const [services,    setServices]    = useState<any[]>([]);
  const [staff,       setStaff]       = useState<any[]>([]);
  const [events,      setEvents]      = useState<any[]>([]);
  const [savedConfig, setSavedConfig] = useState<PageBuilderConfig | null>(null);
  const [liveConfig,  setLiveConfig]  = useState<{ sections: PageSection[]; style: StyleConfig } | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);

  // Fetch all public data
  useEffect(() => {
    if (!firestore || !tenantId) return;
    (async () => {
      try {
        // Tenant + pageConfig
        const tSnap = await getDoc(doc(firestore, 'tenants', tenantId));
        if (tSnap.exists()) {
          const t = { id: tSnap.id, ...tSnap.data() } as any;
          setTenant(t);
          const pc = t?.bookingPageSettings?.pageConfig as PageBuilderConfig | undefined;
          if (pc) setSavedConfig(pc);
        }
        // Services
        const svSnap = await getDocs(collection(firestore, `tenants/${tenantId}/services`));
        setServices(svSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
        // Staff
        const stSnap = await getDocs(collection(firestore, `tenants/${tenantId}/staff`));
        setStaff(stSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
        // Events
        const evSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/studioEvents`), orderBy('date', 'asc')));
        setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.warn('[booking] data fetch:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [firestore, tenantId]);

  // Live preview bridge — receives postMessage from the page builder iframe parent
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'CLARITY_PREVIEW') {
        setLiveConfig({ sections: e.data.sections, style: e.data.style });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Active config: live preview overrides saved
  const activeStyle: StyleConfig = {
    accentColor: liveConfig?.style.accentColor ?? savedConfig?.accentColor ?? '#8b6914',
    bgColor:     liveConfig?.style.bgColor     ?? savedConfig?.bgColor     ?? '#f8f4ef',
    headingFont: liveConfig?.style.headingFont ?? savedConfig?.headingFont ?? 'cormorant',
    bodyFont:    liveConfig?.style.bodyFont    ?? savedConfig?.bodyFont    ?? 'space',
  };

  const activeSections = (liveConfig?.sections ?? savedConfig?.sections ?? [])
    .filter(s => s.enabled)
    .sort((a, b) => a.order - b.order);

  // Inject Google Fonts when style changes
  useEffect(() => {
    injectFonts(activeStyle.headingFont, activeStyle.bodyFont);
  }, [activeStyle.headingFont, activeStyle.bodyFont]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: activeStyle.bgColor }}>
        <div className="text-center space-y-4">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin mx-auto"
               style={{ borderColor: activeStyle.accentColor }} />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (activeSections.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4 px-6">
          <p className="text-2xl font-light text-slate-300" style={{ fontFamily: hf(activeStyle) }}>Coming Soon</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">This page is being set up</p>
        </div>
      </div>
    );
  }

  const data: PageData = { tenant, services, staff, events };

  return (
    <div style={{ background: activeStyle.bgColor, fontFamily: bf(activeStyle) }} className="min-h-screen">
      {activeSections.map(section => (
        <SectionRenderer key={section.id} section={section} style={activeStyle} data={data} />
      ))}
      <Footer tenant={tenant} style={activeStyle} />
    </div>
  );
}

export default function BookingPage({ params }: { params: { tenantId: string } }) {
  return <BookingPageContent tenantId={params.tenantId} />;
}
