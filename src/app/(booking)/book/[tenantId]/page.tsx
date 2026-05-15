'use client';

import React, { useState, useEffect, useRef, useContext, createContext } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, getDoc, getDocs, collection, query, orderBy } from 'firebase/firestore';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';
import { cn } from '@/lib/utils';
import {
  Calendar, Clock, MapPin, Phone, Instagram,
  ChevronDown, ChevronUp, Star, Gift, Sparkles,
} from 'lucide-react';

// ─── Font stacks ──────────────────────────────────────────────────────────────
const FONT_STACKS: Record<string, string> = {
  cormorant:    "'Cormorant Garamond', Georgia, serif",
  playfair:     "'Playfair Display', Georgia, serif",
  lora:         "'Lora', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  'eb-garamond':"'EB Garamond', Georgia, serif",
  'libre-bask': "'Libre Baskerville', Georgia, serif",
  'dm-serif':   "'DM Serif Display', Georgia, serif",
  domine:       "'Domine', Georgia, serif",
  space:        "'Space Grotesk', system-ui, sans-serif",
  josefin:      "'Josefin Sans', system-ui, sans-serif",
  raleway:      "'Raleway', system-ui, sans-serif",
  montserrat:   "'Montserrat', system-ui, sans-serif",
  nunito:       "'Nunito', system-ui, sans-serif",
  poppins:      "'Poppins', system-ui, sans-serif",
  outfit:       "'Outfit', system-ui, sans-serif",
  'dm-sans':    "'DM Sans', system-ui, sans-serif",
  inter:        "'Inter', system-ui, sans-serif",
  figtree:      "'Figtree', system-ui, sans-serif",
  bebas:        "'Bebas Neue', Impact, sans-serif",
  oswald:       "'Oswald', system-ui, sans-serif",
  anton:        "'Anton', Impact, sans-serif",
  righteous:    "'Righteous', system-ui, sans-serif",
  abril:        "'Abril Fatface', Georgia, serif",
  pacifico:     "'Pacifico', cursive",
  dancing:      "'Dancing Script', cursive",
  'great-vibes':"'Great Vibes', cursive",
  georgia:      'Georgia, serif',
  system:       'system-ui, sans-serif',
};

const GOOGLE_FONT_PARAMS: Record<string, string> = {
  cormorant:    'Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400',
  playfair:     'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400',
  lora:         'Lora:ital,wght@0,400;0,600;0,700;1,400',
  merriweather: 'Merriweather:wght@300;400;700',
  'eb-garamond':'EB+Garamond:wght@400;600',
  'libre-bask': 'Libre+Baskerville:wght@400;700',
  'dm-serif':   'DM+Serif+Display',
  domine:       'Domine:wght@400;700',
  space:        'Space+Grotesk:wght@300;400;500;600;700',
  josefin:      'Josefin+Sans:wght@300;400;600;700',
  raleway:      'Raleway:wght@300;400;500;600;700',
  montserrat:   'Montserrat:wght@300;400;500;600;700',
  nunito:       'Nunito:wght@300;400;600;700',
  poppins:      'Poppins:wght@300;400;500;600;700',
  outfit:       'Outfit:wght@300;400;500;600;700',
  'dm-sans':    'DM+Sans:wght@300;400;500;700',
  inter:        'Inter:wght@300;400;500;700',
  figtree:      'Figtree:wght@300;400;500;700',
  bebas:        'Bebas+Neue',
  oswald:       'Oswald:wght@300;400;500;600',
  anton:        'Anton',
  righteous:    'Righteous',
  abril:        'Abril+Fatface',
  pacifico:     'Pacifico',
  dancing:      'Dancing+Script:wght@400;600;700',
  'great-vibes':'Great+Vibes',
};

function injectFonts(headingFont: string, bodyFont: string) {
  if (typeof document === 'undefined') return;
  const ids = Array.from(new Set([headingFont, bodyFont])).filter(f => GOOGLE_FONT_PARAMS[f]);
  if (!ids.length) return;
  document.getElementById('booking-gfonts')?.remove();
  const link = document.createElement('link');
  link.id   = 'booking-gfonts';
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${ids.map(id => `family=${GOOGLE_FONT_PARAMS[id]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

// ─── Animation system ─────────────────────────────────────────────────────────

/** Fires once when element enters viewport */
function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** Counts from 0 → target when inView becomes true */
function useCounter(target: number, inView: boolean, duration = 1400) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!inView || !target) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const p     = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.floor(eased * target));
      if (p >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [inView, target, duration]);
  return count;
}

/** Returns CSS transition styles for scroll entrance based on global animationStyle */
function anim(inView: boolean, style: StyleConfig, delayMs = 0): React.CSSProperties {
  const kind = style.animationStyle ?? 'fade';
  if (kind === 'none') return {};
  const dur  = style.animationSpeed === 'slow' ? 900 : style.animationSpeed === 'fast' ? 400 : 620;
  const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const tx   = `transition: opacity ${dur}ms ${ease} ${delayMs}ms, transform ${dur}ms ${ease} ${delayMs}ms`;
  const base: React.CSSProperties = {
    transition: `opacity ${dur}ms ${ease} ${delayMs}ms, transform ${dur}ms ${ease} ${delayMs}ms`,
  };
  if (!inView) {
    if (kind === 'slide') return { ...base, opacity: 0, transform: 'translateX(-36px)' };
    if (kind === 'scale') return { ...base, opacity: 0, transform: 'scale(0.91)' };
    return { ...base, opacity: 0, transform: 'translateY(30px)' };
  }
  return { ...base, opacity: 1, transform: 'none' };
}

// ─── Preview context + click-to-edit ─────────────────────────────────────────

const PreviewCtx = createContext(false);

/** In preview mode: hover outline + "Edit" badge that sends CLARITY_CLICK to parent */
function Editable({ sectionId, children }: { sectionId: string; children: React.ReactNode }) {
  const isPreview = useContext(PreviewCtx);
  const [hovered, setHovered] = useState(false);
  if (!isPreview) return <>{children}</>;

  return (
    <div
      style={{
        position: 'relative',
        outline:  hovered ? '2px solid #534AB7' : '2px solid transparent',
        outlineOffset: '-2px',
        transition: 'outline-color 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <button
          onClick={() => window.parent?.postMessage({ type: 'CLARITY_CLICK', sectionId }, '*')}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 9999,
            background: '#534AB7', color: 'white',
            padding: '5px 12px', borderRadius: 6,
            fontSize: 10, fontWeight: 900,
            textTransform: 'uppercase', letterSpacing: '0.12em',
            border: 'none', cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(83,74,183,0.4)',
          }}
        >
          ✏ Edit section
        </button>
      )}
      {children}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface StyleConfig {
  accentColor:    string;
  bgColor:        string;
  headingFont:    string;
  bodyFont:       string;
  borderRadius:   number;
  buttonStyle:    string;
  density:        string;
  animationStyle: string; // 'none' | 'fade' | 'slide' | 'scale'
  animationSpeed: string; // 'slow' | 'normal' | 'fast'
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

const ac = (s: StyleConfig) => s.accentColor  || '#8b6914';
const hf = (s: StyleConfig) => FONT_STACKS[s.headingFont] || FONT_STACKS.cormorant;
const bf = (s: StyleConfig) => FONT_STACKS[s.bodyFont]    || FONT_STACKS.space;
const br = (s: StyleConfig, scale = 1) => `${(s.borderRadius || 8) * scale}px`;

function btn(s: StyleConfig, variant: 'primary' | 'secondary' = 'primary') {
  const radius = s.buttonStyle === 'pill' ? '999px' : br(s, 0.5);
  if (variant === 'primary') {
    return {
      background:   s.buttonStyle === 'outline' || s.buttonStyle === 'ghost' ? 'transparent' : ac(s),
      color:        s.buttonStyle === 'outline' || s.buttonStyle === 'ghost' ? ac(s) : 'white',
      border:       s.buttonStyle === 'ghost'   ? 'none' : `2px solid ${ac(s)}`,
      borderRadius: radius,
    };
  }
  return { background: 'transparent', color: ac(s), border: `2px solid ${ac(s)}`, borderRadius: radius };
}

const py = (s: StyleConfig) =>
  s.density === 'compact' ? 'py-14 md:py-20' : s.density === 'airy' ? 'py-32 md:py-44' : 'py-24 md:py-32';

// ─── Default sections ─────────────────────────────────────────────────────────
function buildDefaultSections(): PageSection[] {
  return [
    { id: 'nav',      type: 'nav',      enabled: true, order: 0, config: { logoText: 'Studio', ctaText: 'Book Now', showLinks: true, sticky: true } },
    { id: 'hero',     type: 'hero',     enabled: true, order: 1, config: { headline: 'Book Your Experience', subheadline: 'A sanctuary of craft, curated for those who appreciate the details.', ctaText: 'Book a Session', showWalkIn: true, cta2Text: 'Walk In Today', layout: 'centered', overlayOpacity: 40 } },
    { id: 'services', type: 'services', enabled: true, order: 2, config: { heading: 'Our Services', subheading: 'Handcrafted treatments for every occasion', ctaText: 'Book this service', columns: '2', showPrices: true, showDuration: true, showDesc: true } },
    { id: 'team',     type: 'team',     enabled: true, order: 3, config: { heading: 'The Artists', subheading: 'Expert hands for every style', showSpecialties: true } },
    { id: 'quote',    type: 'quote',    enabled: true, order: 4, config: { heading: 'Need Something Bigger?', subheading: 'Planning a wedding, bridal party, or corporate event? We craft bespoke experiences.', ctaText: 'Request a Quote', tags: ['Bridal Parties', 'Corporate Events', 'Destination Services'] } },
    { id: 'contact',  type: 'contact',  enabled: true, order: 5, config: { heading: 'Find Us', showMap: true, showHours: true, showPhone: true, showSocial: true, ctaText: 'Book an Appointment' } },
  ];
}

// ─── Nav ─────────────────────────────────────────────────────────────────────
function NavSection({ config, style }: SectionProps) {
  return (
    <nav
      className={cn('z-50 flex items-center justify-between px-6 md:px-14 py-4 bg-white/95 backdrop-blur-xl border-b', config.sticky !== false && 'sticky top-0')}
      style={{ borderColor: ac(style) + '22' }}
    >
      <div className="flex items-center gap-3">
        {config.logoUrl
          ? <img src={config.logoUrl} alt="Logo" className="h-9 w-auto object-contain" />
          : <span className="text-xl font-bold tracking-tighter" style={{ fontFamily: hf(style), color: ac(style) }}>{config.logoText || 'Studio'}</span>
        }
      </div>
      {config.showLinks !== false && (
        <div className="hidden md:flex items-center gap-8">
          {['Services', 'Team', 'Contact'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`} className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>{l}</a>
          ))}
        </div>
      )}
      <button className="px-6 py-2.5 text-[11px] font-black uppercase tracking-widest shadow-lg hover:opacity-90 transition-all active:scale-95" style={{ ...btn(style), fontFamily: bf(style) }}>
        {config.ctaText || 'Book Now'}
      </button>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function HeroSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView(0.05);
  const isSplit      = config.layout === 'split';
  const isFullbleed  = config.layout === 'fullbleed' || config.layout === 'cinematic';
  const hasBg        = !!config.bgImage;
  const hasVideo     = !!config.videoUrl;
  const opacity      = (config.overlayOpacity ?? 40) / 100;
  const textColor    = hasBg || hasVideo ? 'white' : '#0f172a';
  const subColor     = hasBg || hasVideo ? 'rgba(255,255,255,0.75)' : '#64748b';
  const showWalkIn   = config.showWalkIn !== false;

  return (
    <section
      className="relative flex items-center overflow-hidden"
      style={{ minHeight: isFullbleed ? '100vh' : '82vh', background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : style.bgColor }}
    >
      {hasVideo && (
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
          <source src={config.videoUrl} />
        </video>
      )}
      {(hasBg || hasVideo) && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${opacity})` }} />}
      {config.showBadge && config.badgeText && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 rounded-full border border-white/30 bg-white/10 backdrop-blur text-white text-[10px] font-black uppercase tracking-widest">
          {config.badgeText}
        </div>
      )}
      <div ref={ref} className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 py-24">
        {isSplit ? (
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="space-y-8" style={anim(inView, style)}>
              <h1 className="text-5xl md:text-7xl leading-[0.95] font-light" style={{ fontFamily: hf(style), color: textColor }}>{config.headline || 'Book Your Experience'}</h1>
              <p className="text-lg leading-relaxed max-w-md" style={{ fontFamily: bf(style), color: subColor }}>{config.subheadline}</p>
              <div className="flex flex-wrap gap-4">
                <button className="px-9 py-4 text-sm font-bold shadow-2xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Book a Session'}</button>
                {showWalkIn && <button className="px-9 py-4 text-sm font-bold hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), borderColor: hasBg ? 'white' : ac(style), color: hasBg ? 'white' : ac(style), fontFamily: bf(style) }}>{config.cta2Text || 'Walk In'}</button>}
              </div>
            </div>
            <div style={anim(inView, style, 150)}>
              {config.heroImage
                ? <img src={config.heroImage} alt="" className="w-full aspect-[4/5] object-cover shadow-2xl" style={{ borderRadius: br(style, 2) }} />
                : <div className="w-full aspect-[4/5]" style={{ background: ac(style) + '18', borderRadius: br(style, 2) }} />
              }
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto text-center space-y-8" style={anim(inView, style)}>
            <h1 className="text-6xl md:text-8xl leading-[0.95] font-light" style={{ fontFamily: hf(style), color: textColor }}>{config.headline || 'Book Your Experience'}</h1>
            <p className="text-xl leading-relaxed max-w-2xl mx-auto" style={{ fontFamily: bf(style), color: subColor }}>{config.subheadline}</p>
            <div className="flex flex-wrap gap-4 justify-center" style={anim(inView, style, 120)}>
              <button className="px-12 py-4 font-bold shadow-2xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Book a Session'}</button>
              {showWalkIn && <button className="px-12 py-4 font-bold hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), borderColor: hasBg ? 'white' : ac(style), color: hasBg ? 'white' : ac(style), fontFamily: bf(style) }}>{config.cta2Text || 'Walk In'}</button>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Trust (animated counters) ────────────────────────────────────────────────
function StatCounter({ value, label, style, delay }: { value: string; label: string; style: StyleConfig; delay: number }) {
  const [ref, inView] = useInView(0.3);
  const numericPart   = parseInt(value.replace(/\D/g, '')) || 0;
  const suffix        = value.replace(/[\d]/g, '');
  const count         = useCounter(numericPart, inView);
  return (
    <div ref={ref} className="space-y-1 text-center" style={anim(inView, style, delay)}>
      <p className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>
        {numericPart ? `${count}${suffix}` : value}
      </p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>{label}</p>
    </div>
  );
}

function TrustSection({ config, style }: SectionProps) {
  const stats = [
    { v: config.stat1v, l: config.stat1l },
    { v: config.stat2v, l: config.stat2l },
    { v: config.stat3v, l: config.stat3l },
    { v: config.stat4v, l: config.stat4l },
  ].filter(s => s.v);
  return (
    <section className="py-14 border-y" style={{ borderColor: ac(style) + '20' }}>
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
        {stats.map((s, i) => <StatCounter key={i} value={s.v} label={s.l} style={style} delay={i * 80} />)}
      </div>
    </section>
  );
}

// ─── Services (staggered) ────────────────────────────────────────────────────
function ServicesSection({ config, style, data }: SectionProps) {
  const [ref, inView] = useInView();
  const services      = data.services;
  const cols          = parseInt(config.columns) || 2;
  const gridCls       = cols === 1 ? 'grid-cols-1 max-w-lg mx-auto' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Services'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {services.length > 0 ? (
          <div className={`grid gap-5 ${gridCls}`}>
            {services.map((svc: any, i: number) => (
              <div
                key={svc.id}
                className="group p-7 bg-white hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                style={{ ...anim(inView, style, i * 70), borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}25` }}
              >
                {config.showImages && svc.imageUrl && <img src={svc.imageUrl} alt={svc.name} className="w-full aspect-video object-cover mb-4" style={{ borderRadius: br(style) }} />}
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                  {config.showPrices !== false && svc.price && <span className="text-base font-black ml-3 shrink-0" style={{ color: ac(style) }}>${svc.price}</span>}
                </div>
                {config.showDesc !== false && svc.description && <p className="text-sm text-slate-500 leading-relaxed mb-4" style={{ fontFamily: bf(style) }}>{svc.description}</p>}
                {config.showDuration !== false && svc.duration && (
                  <div className="flex items-center gap-1.5 mb-5">
                    <Clock className="w-3 h-3" style={{ color: ac(style) }} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</p>
                  </div>
                )}
                <button className="w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Book Now'}</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-300">Services coming soon</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Team (staggered) ────────────────────────────────────────────────────────
function TeamSection({ config, style, data }: SectionProps) {
  const [ref, inView] = useInView();
  const staff         = data.staff;
  return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'The Artists'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {staff.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">
            {staff.map((member: any, i: number) => (
              <div key={member.id} className="text-center space-y-4 group" style={anim(inView, style, i * 80)}>
                <div className="relative mx-auto w-28 h-28 overflow-hidden shadow-lg" style={{ background: ac(style) + '15', borderRadius: br(style, 1.5) }}>
                  {member.avatarUrl
                    ? <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{member.name?.[0]}</span>
                  }
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{ fontFamily: bf(style) }}>{member.name}</p>
                  {config.showSpecialties !== false && member.specialties?.length > 0 && <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{member.specialties.slice(0, 2).join(' · ')}</p>}
                  {config.showBio && member.bio && <p className="text-xs text-slate-500 mt-2 leading-relaxed" style={{ fontFamily: bf(style) }}>{member.bio}</p>}
                  {config.showBookButton && <button className="mt-3 px-5 py-1.5 text-[10px] font-black uppercase tracking-widest" style={{ ...btn(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20"><p className="text-[11px] font-black uppercase tracking-widest text-slate-300">Team coming soon</p></div>
        )}
      </div>
    </section>
  );
}

// ─── Reviews ─────────────────────────────────────────────────────────────────
function ReviewsSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const reviews = [
    { name: 'Sarah M.',   rating: 5, text: 'Absolutely incredible experience. The attention to detail is unmatched — I leave feeling taken care of every single time.' },
    { name: 'Jessica T.', rating: 5, text: "I've been coming here for over a year and every visit exceeds my expectations. The team is truly world-class." },
    { name: 'Priya K.',   rating: 5, text: 'The atmosphere is luxurious yet so welcoming. I always feel like a VIP. Truly the best in the city.' },
  ];
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'What Clients Say'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {reviews.map((r, i) => (
            <div key={i} className="p-8 bg-white space-y-5" style={{ ...anim(inView, style, i * 90), borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}20` }}>
              {config.showRating !== false && <div className="flex gap-1">{Array(r.rating).fill(0).map((_, j) => <Star key={j} className="w-4 h-4 fill-current" style={{ color: ac(style) }} />)}</div>}
              {config.showPhotos && <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-sm font-black">{r.name[0]}</div>}
              <p className="text-sm leading-relaxed text-slate-600 italic" style={{ fontFamily: bf(style) }}>"{r.text}"</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>— {r.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gallery ─────────────────────────────────────────────────────────────────
function GallerySection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const uploaded: any[] = Array.isArray(config.images) ? config.images : [];
  const shades  = ['08', '10', '14', '18', '12', '16'];
  const cols    = parseInt(config.columns) || 3;
  const gridCls = cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3';
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Work'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className={`grid ${gridCls} gap-3`}>
          {uploaded.length > 0
            ? uploaded.map((img: any, i: number) => (
                <div key={img.id || i} className="aspect-square overflow-hidden" style={{ ...anim(inView, style, i * 55), borderRadius: br(style) }}>
                  <img src={img.url} alt={img.caption || ''} className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
                </div>
              ))
            : shades.map((s, i) => (
                <div key={i} className={i === 0 || i === 5 ? 'aspect-[4/5]' : 'aspect-square'} style={{ ...anim(inView, style, i * 55), background: ac(style) + s, borderRadius: br(style) }} />
              ))
          }
        </div>
      </div>
    </section>
  );
}

// ─── Before / After ───────────────────────────────────────────────────────────
function BeforeAfterSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const pairs: any[]  = Array.isArray(config.pairs) ? config.pairs : [];
  const showLabels    = config.showLabels !== false;
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Transformations'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {(pairs.length > 0 ? pairs : [{}, {}]).map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-3" style={anim(inView, style, i * 100)}>
              <div className="grid grid-cols-2 gap-2">
                {(['before', 'after'] as const).map((side, j) => (
                  <div key={side} className="relative overflow-hidden aspect-square" style={{ borderRadius: br(style) }}>
                    {pair[`${side}Url`]
                      ? <img src={pair[`${side}Url`]} alt={side} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center" style={{ background: ac(style) + (j === 0 ? '12' : '28') }}>
                          {showLabels && <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) + (j === 0 ? '80' : 'cc') }}>{side}</span>}
                        </div>
                    }
                    {showLabels && pair[`${side}Url`] && (
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[9px] font-black uppercase text-white" style={{ background: j === 0 ? 'rgba(0,0,0,0.5)' : ac(style) + 'cc' }}>{side}</div>
                    )}
                  </div>
                ))}
              </div>
              {pair.caption && <p className="text-xs text-slate-400 text-center font-bold uppercase tracking-widest" style={{ fontFamily: bf(style) }}>{pair.caption}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Memberships ──────────────────────────────────────────────────────────────
function MembershipsSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const plans = [
    { name: 'Essential', price: '$89',  period: '/mo', features: ['2 services/month', 'Priority booking', '10% off retail'] },
    { name: 'Luxe',      price: '$149', period: '/mo', features: ['4 services/month', 'VIP priority', '20% off retail', 'Free upgrades'], featured: true },
    { name: 'Elite',     price: '$249', period: '/mo', features: ['Unlimited services', 'Dedicated artist', '30% off retail', 'Exclusive events'] },
  ];
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Join the Club'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6 items-center">
          {plans.map((plan, i) => (
            <div key={i} className={cn('p-8 space-y-6', plan.featured ? 'shadow-2xl md:scale-105' : 'bg-white')} style={{ ...anim(inView, style, i * 80), borderRadius: br(style, 1.5), border: `2px solid ${plan.featured ? ac(style) : ac(style) + '25'}`, background: plan.featured ? ac(style) : 'white' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: plan.featured ? 'rgba(255,255,255,0.65)' : ac(style) }}>{plan.name}</p>
                {config.showBadge && plan.featured && <span className="inline-block mt-1 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest text-white bg-white/20">Most Popular</span>}
                <div className="flex items-end gap-1 mt-2">
                  <span className="text-4xl font-light" style={{ fontFamily: hf(style), color: plan.featured ? 'white' : '#0f172a' }}>{plan.price}</span>
                  <span className="text-sm mb-1" style={{ color: plan.featured ? 'rgba(255,255,255,0.5)' : '#94a3b8', fontFamily: bf(style) }}>{plan.period}</span>
                </div>
              </div>
              <ul className="space-y-2.5">{plan.features.map((f, j) => <li key={j} className="flex items-center gap-2.5 text-sm" style={{ fontFamily: bf(style), color: plan.featured ? 'rgba(255,255,255,0.8)' : '#64748b' }}><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: plan.featured ? 'rgba(255,255,255,0.6)' : ac(style) }} />{f}</li>)}</ul>
              <button className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ background: plan.featured ? 'white' : ac(style), color: plan.featured ? ac(style) : 'white', borderRadius: br(style), fontFamily: bf(style) }}>{config.ctaText || 'Join Now'}</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Packages ────────────────────────────────────────────────────────────────
function PackagesSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const pkgs = [
    { name: '5-Pack',  sessions: 5,  price: '$199', saving: 'Save 15%' },
    { name: '10-Pack', sessions: 10, price: '$349', saving: 'Save 25%' },
    { name: '20-Pack', sessions: 20, price: '$599', saving: 'Save 35%' },
  ];
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Prepaid Sessions'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {pkgs.map((pkg, i) => (
            <div key={i} className="p-8 bg-white text-center space-y-5" style={{ ...anim(inView, style, i * 80), borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}25` }}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) }}>{pkg.name}</p>
              <p className="text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{pkg.price}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>
              {config.showExpiry !== false && <p className="text-xs text-slate-400">Valid 12 months</p>}
              {config.showSavings !== false && <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: ac(style), borderRadius: br(style, 2) }}>{pkg.saving}</span>}
              <button className="block w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>Purchase</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gift Cards ───────────────────────────────────────────────────────────────
function GiftCardsSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const amounts = (config.amounts || '25,50,75,100').split(',').map((a: string) => a.trim());
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-2xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div ref={ref} className="space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Give the Gift of Beauty'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="p-10 shadow-2xl space-y-8 text-white" style={{ ...anim(inView, style, 100), background: `linear-gradient(135deg, ${ac(style)} 0%, ${ac(style)}cc 100%)`, borderRadius: br(style, 2) }}>
          <Gift className="w-12 h-12 mx-auto opacity-80" />
          <p className="text-lg font-light" style={{ fontFamily: hf(style) }}>Choose an amount</p>
          <div className="flex flex-wrap gap-3 justify-center">
            {amounts.map((a: string, i: number) => <button key={i} className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{ borderRadius: br(style) }}>${a}</button>)}
            <button className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{ borderRadius: br(style) }}>Custom</button>
          </div>
          <button className="px-12 py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all" style={{ background: 'white', color: ac(style), borderRadius: br(style, 3), fontFamily: bf(style) }}>{config.ctaText || 'Send a Gift Card'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Quote ───────────────────────────────────────────────────────────────────
function QuoteSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const rawTags = config.tags;
  const tags: string[] = Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
  return (
    <section className={py(style)} style={{ background: '#0f172a' }}>
      <div ref={ref} className="max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10" style={anim(inView, style)}>
        <div className="space-y-5">
          <h2 className="text-4xl md:text-6xl font-light text-white" style={{ fontFamily: hf(style) }}>{config.heading || 'Need Something Bigger?'}</h2>
          <p className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: bf(style) }}>{config.subheading}</p>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2.5 justify-center">
            {tags.map((tag: string, i: number) => <span key={i} className="px-5 py-2 border text-[11px] font-black uppercase tracking-widest text-white/55 border-white/20" style={{ borderRadius: br(style, 3) }}>{tag}</span>)}
          </div>
        )}
        <button className="px-12 py-4 font-black text-sm uppercase tracking-widest shadow-2xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Request a Quote'}</button>
      </div>
    </section>
  );
}

// ─── New Client ───────────────────────────────────────────────────────────────
function NewClientSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  return (
    <section className={py(style)} style={{ background: ac(style) + '0e' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div ref={ref} className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12" style={{ ...anim(inView, style), borderRadius: br(style, 2), border: `2px solid ${ac(style)}28` }}>
          <div className="text-center md:text-left space-y-3">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <Sparkles className="w-4 h-4" style={{ color: ac(style) }} />
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>First Visit</p>
            </div>
            <h2 className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'First Visit Special'}</h2>
            <p className="text-xl font-black" style={{ color: ac(style), fontFamily: bf(style) }}>{config.offerText}</p>
            {config.finePrint && <p className="text-xs text-slate-400" style={{ fontFamily: bf(style) }}>{config.finePrint}</p>}
          </div>
          <button className="shrink-0 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Claim Offer'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
function FAQSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const [open, setOpen] = useState<number | null>(null);
  const items = [1,2,3,4,5,6].map(n => ({ q: config[`q${n}`], a: config[`a${n}`] })).filter(i => i.q && i.a);
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <h2 ref={ref} className="text-4xl md:text-5xl font-light text-center mb-14" style={{ ...anim(inView, style), fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Common Questions'}</h2>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="overflow-hidden bg-white" style={{ ...anim(inView, style, i * 60), borderRadius: br(style), border: `2px solid ${ac(style)}22` }}>
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors">
                <span className="font-black text-sm uppercase tracking-tight text-slate-900 pr-4" style={{ fontFamily: bf(style) }}>{item.q}</span>
                {open === i ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: ac(style) }} /> : <ChevronDown className="w-4 h-4 shrink-0 text-slate-300" />}
              </button>
              {open === i && <div className="px-6 pb-6 text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{item.a}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Policies ────────────────────────────────────────────────────────────────
function PoliciesSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const policyItems: any[] = Array.isArray(config.policies) ? config.policies : [];
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <h2 ref={ref} className="text-4xl md:text-5xl font-light text-center mb-14" style={{ ...anim(inView, style), fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Policies'}</h2>
        {policyItems.length > 0 ? (
          <div className="grid md:grid-cols-3 gap-6">
            {policyItems.map((p: any, i: number) => (
              <div key={p.id || i} className="p-7 bg-white space-y-3" style={{ ...anim(inView, style, i * 80), borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}22` }}>
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{p.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-300 text-[11px] font-black uppercase tracking-widest">No policies configured yet</div>
        )}
      </div>
    </section>
  );
}

// ─── Contact ─────────────────────────────────────────────────────────────────
function ContactSection({ config, style, data }: SectionProps) {
  const [ref, inView] = useInView();
  const tenant       = data.tenant;
  const socialLinks: any[] = Array.isArray(config.socialLinks) ? config.socialLinks : [];
  return (
    <section id="contact" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <h2 ref={ref} className="text-4xl md:text-5xl font-light text-center mb-16" style={{ ...anim(inView, style), fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Find Us'}</h2>
        <div className="grid md:grid-cols-2 gap-14 items-start">
          <div className="space-y-7" style={anim(inView, style, 80)}>
            {config.showHours !== false && config.customHours && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2"><Clock className="w-4 h-4" style={{ color: ac(style) }} /><p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>Hours</p></div>
                <p className="text-sm text-slate-500 leading-relaxed whitespace-pre-line" style={{ fontFamily: bf(style) }}>{config.customHours}</p>
              </div>
            )}
            {tenant?.studioAddress && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2"><MapPin className="w-4 h-4" style={{ color: ac(style) }} /><p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>Location</p></div>
                <p className="text-sm text-slate-500" style={{ fontFamily: bf(style) }}>{tenant.studioAddress}</p>
              </div>
            )}
            {config.showPhone !== false && tenant?.phone && (
              <div className="flex items-center gap-3"><Phone className="w-4 h-4" style={{ color: ac(style) }} /><a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>{tenant.phone}</a></div>
            )}
            {config.showSocial !== false && socialLinks.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {socialLinks.map((link: any) => (
                  <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors border rounded-full"
                     style={{ borderColor: ac(style) + '30', fontFamily: bf(style) }}>{link.platform}</a>
                ))}
              </div>
            )}
            {config.showSocial !== false && tenant?.instagramHandle && (
              <div className="flex items-center gap-3"><Instagram className="w-4 h-4" style={{ color: ac(style) }} /><a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>@{tenant.instagramHandle}</a></div>
            )}
            {config.ctaText && <button className="mt-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText}</button>}
          </div>
          {config.showMap !== false && tenant?.studioLocation && (
            <div className="overflow-hidden shadow-xl" style={{ ...anim(inView, style, 160), height: '320px', borderRadius: br(style, 1.5) }}>
              <iframe src={`https://maps.google.com/maps?q=${tenant.studioLocation.lat},${tenant.studioLocation.lng}&z=15&output=embed`} className="w-full h-full border-0" loading="lazy" title="Studio location" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Events ──────────────────────────────────────────────────────────────────
function EventsSection({ config, style, data }: SectionProps) {
  const [ref, inView] = useInView();
  const events        = data.events;
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div ref={ref} className="text-center mb-16 space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Upcoming Events'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {events.length > 0 ? (
          <div className="space-y-4">
            {events.map((event: any, i: number) => {
              const d = event.date ? new Date(event.date?.toDate?.() ?? event.date) : null;
              return (
                <div key={event.id} className="flex items-center gap-6 p-6 bg-white hover:shadow-lg transition-all" style={{ ...anim(inView, style, i * 60), borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}22` }}>
                  {d && <div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-white" style={{ background: ac(style), borderRadius: br(style) }}><span className="text-[9px] font-black uppercase">{d.toLocaleString('default', { month: 'short' })}</span><span className="text-xl font-black leading-none">{d.getDate()}</span></div>}
                  <div className="flex-1 min-w-0">
                    <p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{ fontFamily: bf(style) }}>{event.title || event.name}</p>
                    {event.description && <p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}
                  </div>
                  <button className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'RSVP'}</button>
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

// ─── Referral ────────────────────────────────────────────────────────────────
function ReferralSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div ref={ref} className="space-y-4" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Refer a Friend'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid grid-cols-2 gap-5 max-w-md mx-auto">
          {[{ l: 'You get', v: config.rewardYou }, { l: 'Friend gets', v: config.rewardFriend }].map((item, i) => (
            <div key={i} className="p-6 bg-white space-y-2" style={{ ...anim(inView, style, i * 100), borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}22` }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>{item.l}</p>
              <p className="text-2xl font-black" style={{ fontFamily: hf(style), color: ac(style) }}>{item.v}</p>
            </div>
          ))}
        </div>
        <button className="px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Get My Referral Link'}</button>
      </div>
    </section>
  );
}

// ─── Story ───────────────────────────────────────────────────────────────────
function StorySection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const hasImage      = !!config.image;
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className={cn('grid gap-14 items-center', hasImage ? 'md:grid-cols-2' : 'max-w-2xl mx-auto')}>
          <div ref={ref} className="space-y-8" style={anim(inView, style)}>
            <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</h2>
            <div className="w-12 h-px" style={{ background: ac(style) }} />
            {config.pullQuote && <p className="text-2xl font-light italic" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>}
            <p className="text-base text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</p>
            {config.ctaText && <button className="px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), fontFamily: bf(style) }}>{config.ctaText}</button>}
          </div>
          {hasImage && <img src={config.image} alt="Our Story" className="w-full aspect-square object-cover shadow-2xl" style={{ ...anim(inView, style, 120), borderRadius: br(style, 2) }} />}
        </div>
      </div>
    </section>
  );
}

// ─── Instagram ────────────────────────────────────────────────────────────────
function InstagramSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  const uploaded: any[] = Array.isArray(config.images) ? config.images : [];
  const shades  = ['10', '14', '18', '12', '16', '1a'];
  const cols    = parseInt(config.columns) || 4;
  const gridCls = cols === 3 ? 'grid-cols-3' : cols === 6 ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-4';
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div ref={ref} className="space-y-3" style={anim(inView, style)}>
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Follow Along'}</h2>
          <p className="text-base text-slate-400" style={{ fontFamily: bf(style) }}>{config.handle || '@studio'}</p>
        </div>
        <div className={`grid ${gridCls} gap-2`}>
          {(uploaded.length > 0 ? uploaded.slice(0, cols === 6 ? 6 : 8) : shades).map((item: any, i: number) => (
            <div key={i} className="aspect-square overflow-hidden" style={{ ...anim(inView, style, i * 50), borderRadius: br(style), background: typeof item === 'string' ? ac(style) + item : undefined }}>
              {typeof item === 'object' && item.url && <img src={item.url} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />}
            </div>
          ))}
        </div>
        <a href={`https://instagram.com/${(config.handle || '').replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), fontFamily: bf(style) }}>
          <Instagram className="w-4 h-4" />{config.ctaText || 'Follow us on Instagram'}
        </a>
      </div>
    </section>
  );
}

// ─── Waitlist ────────────────────────────────────────────────────────────────
function WaitlistSection({ config, style }: SectionProps) {
  const [ref, inView] = useInView();
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-lg mx-auto px-6 md:px-16 text-center space-y-8">
        <div ref={ref} className="space-y-4" style={anim(inView, style)}>
          <h2 className="text-3xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Fully Booked?'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="flex gap-2" style={anim(inView, style, 100)}>
          <input type="email" placeholder="your@email.com" className="flex-1 px-4 py-3 text-sm focus:outline-none" style={{ borderRadius: br(style), border: `2px solid ${ac(style)}40`, fontFamily: bf(style) }} />
          <button className="px-6 py-3 font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>{config.ctaText || 'Join'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────
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
  const content = (() => {
    switch (section.type) {
      case 'nav':         return <NavSection         {...props} />;
      case 'hero':        return <HeroSection        {...props} />;
      case 'trust':       return <TrustSection       {...props} />;
      case 'services':    return <ServicesSection    {...props} />;
      case 'team':        return <TeamSection        {...props} />;
      case 'reviews':     return <ReviewsSection     {...props} />;
      case 'gallery':     return <GallerySection     {...props} />;
      case 'beforeafter': return <BeforeAfterSection {...props} />;
      case 'memberships': return <MembershipsSection {...props} />;
      case 'packages':    return <PackagesSection    {...props} />;
      case 'giftcards':   return <GiftCardsSection   {...props} />;
      case 'quote':       return <QuoteSection       {...props} />;
      case 'newclient':   return <NewClientSection   {...props} />;
      case 'faq':         return <FAQSection         {...props} />;
      case 'policies':    return <PoliciesSection    {...props} />;
      case 'contact':     return <ContactSection     {...props} />;
      case 'events':      return <EventsSection      {...props} />;
      case 'referral':    return <ReferralSection    {...props} />;
      case 'story':       return <StorySection       {...props} />;
      case 'instagram':   return <InstagramSection   {...props} />;
      case 'waitlist':    return <WaitlistSection    {...props} />;
      default:            return null;
    }
  })();
  // Nav is always excluded from the editable wrapper (it's sticky and doesn't need it)
  if (section.type === 'nav') return <>{content}</>;
  return <Editable sectionId={section.id}>{content}</Editable>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_STYLE: StyleConfig = {
  accentColor:    '#8b6914',
  bgColor:        '#f8f4ef',
  headingFont:    'cormorant',
  bodyFont:       'space',
  borderRadius:   8,
  buttonStyle:    'filled',
  density:        'balanced',
  animationStyle: 'fade',
  animationSpeed: 'normal',
};

// ─── Main component ───────────────────────────────────────────────────────────
function BookingPageContent({ tenantId }: { tenantId: string }) {
  const [tenant,      setTenant]      = useState<any>(null);
  const [services,    setServices]    = useState<any[]>([]);
  const [staff,       setStaff]       = useState<any[]>([]);
  const [events,      setEvents]      = useState<any[]>([]);
  const [savedConfig, setSavedConfig] = useState<PageBuilderConfig | null>(null);
  const [liveConfig,  setLiveConfig]  = useState<{ sections: PageSection[]; style: any } | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);

  const getDb = () => {
    try { return getFirestore(getApp()); }
    catch { return null; }
  };

  // ── Data fetch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) { setIsLoading(false); return; }
    let cancelled = false;

    const fetchData = async () => {
      let db = getDb();
      let attempts = 0;
      while (!db && attempts < 10) { await new Promise(r => setTimeout(r, 500)); db = getDb(); attempts++; }
      if (!db || cancelled) { setIsLoading(false); return; }

      try {
        const tSnap = await getDoc(doc(db, 'tenants', tenantId));
        if (!cancelled && tSnap.exists()) {
          const t = { id: tSnap.id, ...tSnap.data() } as any;
          setTenant(t);
          const pc = t?.bookingPageSettings?.pageConfig as PageBuilderConfig | undefined;
          if (pc?.sections?.length) setSavedConfig(pc);
        }
        const [svSnap, stSnap, evSnap] = await Promise.all([
          getDocs(collection(db, `tenants/${tenantId}/services`)),
          getDocs(collection(db, `tenants/${tenantId}/staff`)),
          getDocs(query(collection(db, `tenants/${tenantId}/studioEvents`), orderBy('date', 'asc'))).catch(() => getDocs(collection(db, `tenants/${tenantId}/studioEvents`))),
        ]);
        if (!cancelled) {
          setServices(svSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
          setStaff(stSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
          setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch (e) {
        console.warn('[booking] fetch error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [tenantId]);

  // ── Live preview bridge ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'CLARITY_PREVIEW') {
        setLiveConfig({ sections: e.data.sections, style: e.data.style });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Active config ──────────────────────────────────────────────────────────
  const activeStyle: StyleConfig = {
    accentColor:    liveConfig?.style?.accentColor    ?? savedConfig?.accentColor    ?? DEFAULT_STYLE.accentColor,
    bgColor:        liveConfig?.style?.bgColor        ?? savedConfig?.bgColor        ?? DEFAULT_STYLE.bgColor,
    headingFont:    liveConfig?.style?.headingFont    ?? savedConfig?.headingFont    ?? DEFAULT_STYLE.headingFont,
    bodyFont:       liveConfig?.style?.bodyFont       ?? savedConfig?.bodyFont       ?? DEFAULT_STYLE.bodyFont,
    borderRadius:   liveConfig?.style?.borderRadius   ?? savedConfig?.borderRadius   ?? DEFAULT_STYLE.borderRadius,
    buttonStyle:    liveConfig?.style?.buttonStyle    ?? savedConfig?.buttonStyle    ?? DEFAULT_STYLE.buttonStyle,
    density:        liveConfig?.style?.density        ?? savedConfig?.density        ?? DEFAULT_STYLE.density,
    animationStyle: liveConfig?.style?.animationStyle ?? savedConfig?.animationStyle ?? DEFAULT_STYLE.animationStyle,
    animationSpeed: liveConfig?.style?.animationSpeed ?? savedConfig?.animationSpeed ?? DEFAULT_STYLE.animationSpeed,
  };

  const rawSections    = liveConfig?.sections ?? savedConfig?.sections ?? buildDefaultSections();
  const activeSections = rawSections.filter(s => s.enabled).sort((a, b) => a.order - b.order);
  const isPreview      = liveConfig !== null;

  useEffect(() => { injectFonts(activeStyle.headingFont, activeStyle.bodyFont); }, [activeStyle.headingFont, activeStyle.bodyFont]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: activeStyle.bgColor }}>
        <div className="text-center space-y-4">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: activeStyle.accentColor }} />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  const data: PageData = { tenant, services, staff, events };

  return (
    <PreviewCtx.Provider value={isPreview}>
      <div style={{ background: activeStyle.bgColor, fontFamily: bf(activeStyle) }} className="min-h-screen">
        {activeSections.map(section => (
          <SectionRenderer key={section.id} section={section} style={activeStyle} data={data} />
        ))}
        <Footer tenant={tenant} style={activeStyle} />
      </div>
    </PreviewCtx.Provider>
  );
}

export default function BookingPage({ params }: { params: { tenantId: string } }) {
  return <BookingPageContent tenantId={params.tenantId} />;
}
        ctaText: 'Book an Appointment', layout: 'split-map',
      },
    },
  ];
}

// ─── Nav ─────────────────────────────────────────────────────────────────────
function NavSection({ config, style }: SectionProps) {
  return (
    <nav
      className={cn('z-50 flex items-center justify-between px-6 md:px-14 py-4 bg-white/95 backdrop-blur-xl border-b', config.sticky !== false && 'sticky top-0')}
      style={{ borderColor: ac(style) + '22' }}
    >
      <div className="flex items-center gap-3">
        {config.logoUrl
          ? <img src={config.logoUrl} alt="Logo" className="h-9 w-auto object-contain" />
          : <span className="text-xl font-bold tracking-tighter" style={{ fontFamily: hf(style), color: ac(style) }}>{config.logoText || 'Studio'}</span>
        }
      </div>
      {config.showLinks !== false && (
        <div className="hidden md:flex items-center gap-8">
          {['Services', 'Team', 'Contact'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`}
               className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
               style={{ fontFamily: bf(style) }}>{l}</a>
          ))}
        </div>
      )}
      <button
        className="px-6 py-2.5 text-[11px] font-black uppercase tracking-widest text-white shadow-lg hover:opacity-90 transition-all active:scale-95"
        style={{ ...btn(style), fontFamily: bf(style) }}
      >
        {config.ctaText || 'Book Now'}
      </button>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function HeroSection({ config, style }: SectionProps) {
  const isSplit     = config.layout === 'split';
  const isFullbleed = config.layout === 'fullbleed' || config.layout === 'cinematic';
  const hasBg       = !!config.bgImage;
  const hasVideo    = !!config.videoUrl;
  const opacity     = (config.overlayOpacity ?? 40) / 100;
  const textColor   = hasBg || hasVideo ? 'white' : '#0f172a';
  const subColor    = hasBg || hasVideo ? 'rgba(255,255,255,0.75)' : '#64748b';
  const showWalkIn  = config.showWalkIn !== false;

  return (
    <section
      className="relative flex items-center overflow-hidden"
      style={{
        minHeight: isFullbleed ? '100vh' : '82vh',
        background: hasBg
          ? `url(${config.bgImage}) center/cover no-repeat`
          : style.bgColor,
      }}
    >
      {hasVideo && (
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
          <source src={config.videoUrl} />
        </video>
      )}
      {(hasBg || hasVideo) && (
        <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${opacity})` }} />
      )}
      {config.showBadge && config.badgeText && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 rounded-full border border-white/30 bg-white/10 backdrop-blur text-white text-[10px] font-black uppercase tracking-widest">
          {config.badgeText}
        </div>
      )}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 py-24">
        {isSplit ? (
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <h1 className="text-5xl md:text-7xl leading-[0.95] font-light" style={{ fontFamily: hf(style), color: textColor }}>
                {config.headline || 'Book Your Experience'}
              </h1>
              <p className="text-lg leading-relaxed max-w-md" style={{ fontFamily: bf(style), color: subColor }}>{config.subheadline}</p>
              <div className="flex flex-wrap gap-4">
                <button className="px-9 py-4 text-sm font-bold shadow-2xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
                  {config.ctaText || 'Book a Session'}
                </button>
                {showWalkIn && (
                  <button className="px-9 py-4 text-sm font-bold hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), borderColor: hasBg ? 'white' : ac(style), color: hasBg ? 'white' : ac(style), fontFamily: bf(style) }}>
                    {config.cta2Text || 'Walk In'}
                  </button>
                )}
              </div>
            </div>
            {config.heroImage
              ? <img src={config.heroImage} alt="" className="w-full aspect-[4/5] object-cover shadow-2xl" style={{ borderRadius: br(style, 2) }} />
              : <div className="w-full aspect-[4/5]" style={{ background: ac(style) + '18', borderRadius: br(style, 2) }} />
            }
          </div>
        ) : (
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-6xl md:text-8xl leading-[0.95] font-light" style={{ fontFamily: hf(style), color: textColor }}>
              {config.headline || 'Book Your Experience'}
            </h1>
            <p className="text-xl leading-relaxed max-w-2xl mx-auto" style={{ fontFamily: bf(style), color: subColor }}>{config.subheadline}</p>
            <div className="flex flex-wrap gap-4 justify-center">
              <button className="px-12 py-4 font-bold shadow-2xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
                {config.ctaText || 'Book a Session'}
              </button>
              {showWalkIn && (
                <button className="px-12 py-4 font-bold hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), borderColor: hasBg ? 'white' : ac(style), color: hasBg ? 'white' : ac(style), fontFamily: bf(style) }}>
                  {config.cta2Text || 'Walk In'}
                </button>
              )}
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
  const cols     = parseInt(config.columns) || 2;
  const gridCls  = cols === 1 ? 'grid-cols-1 max-w-lg mx-auto' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Services'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {services.length > 0 ? (
          <div className={`grid gap-5 ${gridCls}`}>
            {services.map((svc: any) => (
              <div
                key={svc.id}
                className="group p-7 bg-white hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}25` }}
              >
                {config.showImages && svc.imageUrl && (
                  <img src={svc.imageUrl} alt={svc.name} className="w-full aspect-video object-cover mb-4" style={{ borderRadius: br(style) }} />
                )}
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                  {config.showPrices !== false && svc.price && (
                    <span className="text-base font-black ml-3 shrink-0" style={{ color: ac(style) }}>${svc.price}</span>
                  )}
                </div>
                {config.showDesc !== false && svc.description && (
                  <p className="text-sm text-slate-500 leading-relaxed mb-4" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                )}
                {config.showDuration !== false && svc.duration && (
                  <div className="flex items-center gap-1.5 mb-5">
                    <Clock className="w-3 h-3" style={{ color: ac(style) }} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</p>
                  </div>
                )}
                <button
                  className="w-full py-3 text-[11px] font-black uppercase tracking-widest text-white hover:opacity-90 transition-all"
                  style={{ ...btn(style), fontFamily: bf(style) }}
                >
                  {config.ctaText || 'Book Now'}
                </button>
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
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'The Artists'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {staff.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">
            {staff.map((member: any) => (
              <div key={member.id} className="text-center space-y-4 group">
                <div
                  className="relative mx-auto w-28 h-28 overflow-hidden shadow-lg"
                  style={{ background: ac(style) + '15', borderRadius: br(style, 1.5) }}
                >
                  {member.avatarUrl
                    ? <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{member.name?.[0]}</span>
                  }
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{ fontFamily: bf(style) }}>{member.name}</p>
                  {config.showSpecialties !== false && member.specialties?.length > 0 && (
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{member.specialties.slice(0, 2).join(' · ')}</p>
                  )}
                  {config.showBio && member.bio && (
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed" style={{ fontFamily: bf(style) }}>{member.bio}</p>
                  )}
                  {config.showBookButton && (
                    <button className="mt-3 px-5 py-1.5 text-[10px] font-black uppercase tracking-widest text-white" style={{ ...btn(style), fontFamily: bf(style) }}>
                      {config.bookCta || 'Book'}
                    </button>
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
  const placeholder = [
    { name: 'Sarah M.',   rating: 5, text: 'Absolutely incredible experience. The attention to detail is unmatched — I leave feeling taken care of every single time.' },
    { name: 'Jessica T.', rating: 5, text: "I've been coming here for over a year and every visit exceeds my expectations. The team is truly world-class." },
    { name: 'Priya K.',   rating: 5, text: 'The atmosphere is luxurious yet so welcoming. I always feel like a VIP. Truly the best in the city.' },
  ];
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'What Clients Say'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {placeholder.map((r, i) => (
            <div key={i} className="p-8 bg-white space-y-5" style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}20` }}>
              {config.showRating !== false && (
                <div className="flex gap-1">
                  {Array(r.rating).fill(0).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-current" style={{ color: ac(style) }} />
                  ))}
                </div>
              )}
              {config.showPhotos && (
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-sm font-black">
                  {r.name[0]}
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
  const uploaded: any[] = Array.isArray(config.images) ? config.images : [];
  const placeholderShades = ['08', '10', '14', '18', '12', '16'];
  const cols = parseInt(config.columns) || 3;
  const gridCls = cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3';

  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Work'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className={`grid ${gridCls} gap-3`}>
          {uploaded.length > 0
            ? uploaded.map((img: any, i: number) => (
                <div key={img.id || i} className="aspect-square overflow-hidden" style={{ borderRadius: br(style) }}>
                  <img src={img.url} alt={img.caption || ''} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                </div>
              ))
            : placeholderShades.map((s, i) => (
                <div
                  key={i}
                  className={i === 0 || i === 5 ? 'aspect-[4/5]' : 'aspect-square'}
                  style={{ background: ac(style) + s, borderRadius: br(style) }}
                />
              ))
          }
        </div>
      </div>
    </section>
  );
}

// ─── Before / After ───────────────────────────────────────────────────────────
function BeforeAfterSection({ config, style }: SectionProps) {
  const pairs: any[] = Array.isArray(config.pairs) ? config.pairs : [];
  const showLabels = config.showLabels !== false;

  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Transformations'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>

        {pairs.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-8">
            {pairs.map((pair: any, i: number) => (
              <div key={pair.id || i} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {/* Before */}
                  <div className="relative overflow-hidden aspect-square" style={{ borderRadius: br(style) }}>
                    {pair.beforeUrl
                      ? <img src={pair.beforeUrl} alt="Before" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center" style={{ background: ac(style) + '12' }}>
                          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) + '80' }}>Before</span>
                        </div>
                    }
                    {showLabels && (
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-white" style={{ background: 'rgba(0,0,0,0.5)' }}>
                        Before
                      </div>
                    )}
                  </div>
                  {/* After */}
                  <div className="relative overflow-hidden aspect-square" style={{ borderRadius: br(style) }}>
                    {pair.afterUrl
                      ? <img src={pair.afterUrl} alt="After" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center" style={{ background: ac(style) + '28' }}>
                          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) + 'cc' }}>After</span>
                        </div>
                    }
                    {showLabels && (
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-white" style={{ background: ac(style) + 'cc' }}>
                        After
                      </div>
                    )}
                  </div>
                </div>
                {pair.caption && (
                  <p className="text-xs text-slate-400 text-center font-bold uppercase tracking-widest" style={{ fontFamily: bf(style) }}>{pair.caption}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          // Placeholder when no pairs uploaded yet
          <div className="grid md:grid-cols-2 gap-8">
            {[0, 1].map(i => (
              <div key={i} className="grid grid-cols-2 gap-2">
                {(['Before', 'After'] as const).map((label, j) => (
                  <div
                    key={j}
                    className="aspect-square flex flex-col items-center justify-center gap-2"
                    style={{ background: ac(style) + (j === 0 ? '12' : '28'), borderRadius: br(style) }}
                  >
                    {showLabels && <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) + (j === 0 ? '80' : 'cc') }}>{label}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Memberships ──────────────────────────────────────────────────────────────
function MembershipsSection({ config, style }: SectionProps) {
  const plans = [
    { name: 'Essential', price: '$89',  period: '/mo', features: ['2 services/month', 'Priority booking', '10% off retail'] },
    { name: 'Luxe',      price: '$149', period: '/mo', features: ['4 services/month', 'VIP priority', '20% off retail', 'Free upgrades'], featured: true },
    { name: 'Elite',     price: '$249', period: '/mo', features: ['Unlimited services', 'Dedicated artist', '30% off retail', 'Exclusive events'] },
  ];
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Join the Club'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6 items-center">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={cn('p-8 space-y-6 transition-all', plan.featured ? 'shadow-2xl md:scale-105' : 'bg-white')}
              style={{
                borderRadius: br(style, 1.5),
                border:       `2px solid ${plan.featured ? ac(style) : ac(style) + '25'}`,
                background:   plan.featured ? ac(style) : 'white',
              }}
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: plan.featured ? 'rgba(255,255,255,0.65)' : ac(style) }}>{plan.name}</p>
                {config.showBadge && plan.featured && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest text-white bg-white/20">Most Popular</span>
                )}
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
              <button
                className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest transition-all hover:opacity-90"
                style={{ background: plan.featured ? 'white' : ac(style), color: plan.featured ? ac(style) : 'white', borderRadius: br(style), fontFamily: bf(style) }}
              >
                {config.ctaText || 'Join Now'}
              </button>
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
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Prepaid Sessions'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {pkgs.map((pkg, i) => (
            <div key={i} className="p-8 bg-white text-center space-y-5" style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}25` }}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) }}>{pkg.name}</p>
              <p className="text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{pkg.price}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>
              {config.showExpiry !== false && <p className="text-xs text-slate-400" style={{ fontFamily: bf(style) }}>Valid 12 months</p>}
              {config.showSavings !== false && <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: ac(style), borderRadius: br(style, 2) }}>{pkg.saving}</span>}
              <button className="block w-full py-3 text-[11px] font-black uppercase tracking-widest text-white hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>Purchase</button>
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
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-2xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div className="space-y-4">
          <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Give the Gift of Beauty'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="p-10 shadow-2xl space-y-8 text-white" style={{ background: `linear-gradient(135deg, ${ac(style)} 0%, ${ac(style)}cc 100%)`, borderRadius: br(style, 2) }}>
          <Gift className="w-12 h-12 mx-auto opacity-80" />
          <p className="text-lg font-light" style={{ fontFamily: hf(style) }}>Choose an amount</p>
          <div className="flex flex-wrap gap-3 justify-center">
            {amounts.map((a: string, i: number) => (
              <button key={i} className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{ borderRadius: br(style) }}>${a}</button>
            ))}
            <button className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{ borderRadius: br(style) }}>Custom</button>
          </div>
          <button className="px-12 py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all" style={{ background: 'white', color: ac(style), borderRadius: br(style, 3), fontFamily: bf(style) }}>
            {config.ctaText || 'Send a Gift Card'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Quote ────────────────────────────────────────────────────────────────────
function QuoteSection({ config, style }: SectionProps) {
  const rawTags = config.tags;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === 'string'
      ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];
  return (
    <section className={py(style)} style={{ background: '#0f172a' }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div className="space-y-5">
          <h2 className="text-4xl md:text-6xl font-light text-white" style={{ fontFamily: hf(style) }}>{config.heading || 'Need Something Bigger?'}</h2>
          <p className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: bf(style) }}>{config.subheading}</p>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2.5 justify-center">
            {tags.map((tag: string, i: number) => (
              <span key={i} className="px-5 py-2 border text-[11px] font-black uppercase tracking-widest text-white/55 border-white/20" style={{ borderRadius: br(style, 3) }}>{tag}</span>
            ))}
          </div>
        )}
        <button className="px-12 py-4 font-black text-sm uppercase tracking-widest text-white shadow-2xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
          {config.ctaText || 'Request a Quote'}
        </button>
      </div>
    </section>
  );
}

// ─── New Client ───────────────────────────────────────────────────────────────
function NewClientSection({ config, style }: SectionProps) {
  return (
    <section className={py(style)} style={{ background: ac(style) + '0e' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12" style={{ borderRadius: br(style, 2), border: `2px solid ${ac(style)}28` }}>
          <div className="text-center md:text-left space-y-3">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <Sparkles className="w-4 h-4" style={{ color: ac(style) }} />
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>First Visit</p>
            </div>
            <h2 className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'First Visit Special'}</h2>
            <p className="text-xl font-black" style={{ color: ac(style), fontFamily: bf(style) }}>{config.offerText}</p>
            {config.finePrint && <p className="text-xs text-slate-400" style={{ fontFamily: bf(style) }}>{config.finePrint}</p>}
            {config.expiryText && <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{config.expiryText}</p>}
          </div>
          <button className="shrink-0 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
            {config.ctaText || 'Claim Offer'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQSection({ config, style }: SectionProps) {
  const [open, setOpen] = React.useState<number | null>(null);
  const items = [1,2,3,4,5,6].map(n => ({ q: config[`q${n}`], a: config[`a${n}`] })).filter(i => i.q && i.a);
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <h2 className="text-4xl md:text-5xl font-light text-center mb-14" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Common Questions'}</h2>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="overflow-hidden bg-white" style={{ borderRadius: br(style), border: `2px solid ${ac(style)}22` }}>
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors">
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
  const policyItems: any[] = Array.isArray(config.policies) ? config.policies : [];
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <h2 className="text-4xl md:text-5xl font-light text-center mb-14" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Policies'}</h2>
        {policyItems.length > 0 ? (
          <div className="grid md:grid-cols-3 gap-6">
            {policyItems.map((p: any, i: number) => (
              <div key={p.id || i} className="p-7 bg-white space-y-3" style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}22` }}>
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{p.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-300 text-[11px] font-black uppercase tracking-widest">No policies configured yet</div>
        )}
      </div>
    </section>
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────
function ContactSection({ config, style, data }: SectionProps) {
  const tenant = data.tenant;
  const socialLinks: any[] = Array.isArray(config.socialLinks) ? config.socialLinks : [];
  return (
    <section id="contact" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <h2 className="text-4xl md:text-5xl font-light text-center mb-16" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Find Us'}</h2>
        <div className="grid md:grid-cols-2 gap-14 items-start">
          <div className="space-y-7">
            {config.showHours !== false && config.customHours && (
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
            {config.showPhone !== false && tenant?.phone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4" style={{ color: ac(style) }} />
                <a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>{tenant.phone}</a>
              </div>
            )}
            {config.showSocial !== false && socialLinks.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {socialLinks.map((link: any) => (
                  <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors border rounded-full"
                     style={{ borderColor: ac(style) + '30', fontFamily: bf(style) }}>
                    {link.platform}
                  </a>
                ))}
              </div>
            )}
            {config.showSocial !== false && tenant?.instagramHandle && (
              <div className="flex items-center gap-3">
                <Instagram className="w-4 h-4" style={{ color: ac(style) }} />
                <a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer"
                   className="text-sm text-slate-500 hover:text-slate-900 transition-colors" style={{ fontFamily: bf(style) }}>
                  @{tenant.instagramHandle}
                </a>
              </div>
            )}
            {config.ctaText && (
              <button className="mt-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
                {config.ctaText}
              </button>
            )}
          </div>
          {config.showMap !== false && tenant?.studioLocation && (
            <div className="overflow-hidden shadow-xl" style={{ height: '320px', borderRadius: br(style, 1.5) }}>
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
    <section className={py(style)} style={{ background: style.bgColor }}>
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
                <div key={event.id} className="flex items-center gap-6 p-6 bg-white hover:shadow-lg transition-all" style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}22` }}>
                  {d && (
                    <div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-white" style={{ background: ac(style), borderRadius: br(style) }}>
                      <span className="text-[9px] font-black uppercase">{d.toLocaleString('default', { month: 'short' })}</span>
                      <span className="text-xl font-black leading-none">{d.getDate()}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{ fontFamily: bf(style) }}>{event.title || event.name}</p>
                    {event.description && <p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}
                  </div>
                  <button className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest text-white" style={{ ...btn(style), fontFamily: bf(style) }}>
                    {config.ctaText || 'RSVP'}
                  </button>
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
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-4">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Refer a Friend'}</h2>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid grid-cols-2 gap-5 max-w-md mx-auto">
          {[{ l: 'You get', v: config.rewardYou }, { l: 'Friend gets', v: config.rewardFriend }].map((item, i) => (
            <div key={i} className="p-6 bg-white space-y-2" style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}22` }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>{item.l}</p>
              <p className="text-2xl font-black" style={{ fontFamily: hf(style), color: ac(style) }}>{item.v}</p>
            </div>
          ))}
        </div>
        <button className="px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
          {config.ctaText || 'Get My Referral Link'}
        </button>
      </div>
    </section>
  );
}

// ─── Story ────────────────────────────────────────────────────────────────────
function StorySection({ config, style }: SectionProps) {
  const hasImage = !!config.image;
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className={cn('grid gap-14 items-center', hasImage ? 'md:grid-cols-2' : 'max-w-2xl mx-auto')}>
          <div className="space-y-8">
            <h2 className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</h2>
            <div className="w-12 h-px" style={{ background: ac(style) }} />
            {config.pullQuote && (
              <p className="text-2xl font-light italic" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>
            )}
            <p className="text-base text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</p>
            {config.ctaText && (
              <button className="px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btn(style, 'secondary'), fontFamily: bf(style) }}>{config.ctaText}</button>
            )}
          </div>
          {hasImage && (
            <img src={config.image} alt="Our Story" className="w-full aspect-square object-cover shadow-2xl" style={{ borderRadius: br(style, 2) }} />
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Instagram ────────────────────────────────────────────────────────────────
function InstagramSection({ config, style }: SectionProps) {
  const uploaded: any[] = Array.isArray(config.images) ? config.images : [];
  const shades = ['10', '14', '18', '12', '16', '1a'];
  const cols   = parseInt(config.columns) || 4;
  const gridCls = cols === 3 ? 'grid-cols-3' : cols === 6 ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-4';

  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-3">
          <h2 className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Follow Along'}</h2>
          <p className="text-base text-slate-400" style={{ fontFamily: bf(style) }}>{config.handle || '@studio'}</p>
        </div>
        <div className={`grid ${gridCls} gap-2`}>
          {uploaded.length > 0
            ? uploaded.slice(0, parseInt(config.columns) === 6 ? 6 : 8).map((img: any, i: number) => (
                <div key={img.id || i} className="aspect-square overflow-hidden" style={{ borderRadius: br(style) }}>
                  <img src={img.url} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                </div>
              ))
            : shades.map((s, i) => (
                <div key={i} className="aspect-square" style={{ background: ac(style) + s, borderRadius: br(style) }} />
              ))
          }
        </div>
        <a
          href={`https://instagram.com/${(config.handle || '').replace('@', '')}`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all"
          style={{ ...btn(style, 'secondary'), fontFamily: bf(style) }}
        >
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
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-lg mx-auto px-6 md:px-16 text-center space-y-8">
        <div className="space-y-4">
          <h2 className="text-3xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Fully Booked?'}</h2>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="flex gap-2">
          <input type="email" placeholder="your@email.com" className="flex-1 px-4 py-3 text-sm focus:outline-none" style={{ borderRadius: br(style), border: `2px solid ${ac(style)}40`, fontFamily: bf(style) }} />
          <button className="px-6 py-3 font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all" style={{ ...btn(style), fontFamily: bf(style) }}>
            {config.ctaText || 'Join'}
          </button>
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
    case 'nav':         return <NavSection         {...props} />;
    case 'hero':        return <HeroSection        {...props} />;
    case 'trust':       return <TrustSection       {...props} />;
    case 'services':    return <ServicesSection    {...props} />;
    case 'team':        return <TeamSection        {...props} />;
    case 'reviews':     return <ReviewsSection     {...props} />;
    case 'gallery':     return <GallerySection     {...props} />;
    case 'beforeafter': return <BeforeAfterSection {...props} />;
    case 'memberships': return <MembershipsSection {...props} />;
    case 'packages':    return <PackagesSection    {...props} />;
    case 'giftcards':   return <GiftCardsSection   {...props} />;
    case 'quote':       return <QuoteSection       {...props} />;
    case 'newclient':   return <NewClientSection   {...props} />;
    case 'faq':         return <FAQSection         {...props} />;
    case 'policies':    return <PoliciesSection    {...props} />;
    case 'contact':     return <ContactSection     {...props} />;
    case 'events':      return <EventsSection      {...props} />;
    case 'referral':    return <ReferralSection    {...props} />;
    case 'story':       return <StorySection       {...props} />;
    case 'instagram':   return <InstagramSection   {...props} />;
    case 'waitlist':    return <WaitlistSection    {...props} />;
    default:            return null;
  }
}

// ─── Default style ────────────────────────────────────────────────────────────
const DEFAULT_STYLE: StyleConfig = {
  accentColor:  '#8b6914',
  bgColor:      '#f8f4ef',
  headingFont:  'cormorant',
  bodyFont:     'space',
  borderRadius: 8,
  buttonStyle:  'filled',
  density:      'balanced',
};

// ─── Main content ─────────────────────────────────────────────────────────────
function BookingPageContent({ tenantId }: { tenantId: string }) {
  const [tenant,      setTenant]      = useState<any>(null);
  const [services,    setServices]    = useState<any[]>([]);
  const [staff,       setStaff]       = useState<any[]>([]);
  const [events,      setEvents]      = useState<any[]>([]);
  const [savedConfig, setSavedConfig] = useState<PageBuilderConfig | null>(null);
  const [liveConfig,  setLiveConfig]  = useState<{ sections: PageSection[]; style: any } | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);

  // ── Get Firestore directly — no auth dependency on public page ────────────
  const getDb = () => {
    try { return getFirestore(getApp()); }
    catch { return null; }
  };

  useEffect(() => {
    if (!tenantId) { setIsLoading(false); return; }

    let cancelled = false;

    const fetchData = async () => {
      // Poll for Firestore readiness (max 5s)
      let db = getDb();
      let attempts = 0;
      while (!db && attempts < 10) {
        await new Promise(r => setTimeout(r, 500));
        db = getDb();
        attempts++;
      }

      if (!db || cancelled) { setIsLoading(false); return; }

      try {
        const tSnap = await getDoc(doc(db, 'tenants', tenantId));
        if (!cancelled && tSnap.exists()) {
          const t = { id: tSnap.id, ...tSnap.data() } as any;
          setTenant(t);
          const pc = t?.bookingPageSettings?.pageConfig as PageBuilderConfig | undefined;
          if (pc?.sections?.length) setSavedConfig(pc);
        }

        const [svSnap, stSnap, evSnap] = await Promise.all([
          getDocs(collection(db, `tenants/${tenantId}/services`)),
          getDocs(collection(db, `tenants/${tenantId}/staff`)),
          getDocs(query(collection(db, `tenants/${tenantId}/studioEvents`), orderBy('date', 'asc'))).catch(() =>
            getDocs(collection(db, `tenants/${tenantId}/studioEvents`))
          ),
        ]);

        if (!cancelled) {
          setServices(svSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
          setStaff(stSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false));
          setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch (e) {
        console.warn('[booking] fetch error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [tenantId]);

  // ── Live preview bridge ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'CLARITY_PREVIEW') {
        setLiveConfig({ sections: e.data.sections, style: e.data.style });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Active config: live > saved > defaults ─────────────────────────────────
  const activeStyle: StyleConfig = {
    accentColor:  liveConfig?.style?.accentColor  ?? savedConfig?.accentColor  ?? DEFAULT_STYLE.accentColor,
    bgColor:      liveConfig?.style?.bgColor      ?? savedConfig?.bgColor      ?? DEFAULT_STYLE.bgColor,
    headingFont:  liveConfig?.style?.headingFont  ?? savedConfig?.headingFont  ?? DEFAULT_STYLE.headingFont,
    bodyFont:     liveConfig?.style?.bodyFont     ?? savedConfig?.bodyFont     ?? DEFAULT_STYLE.bodyFont,
    borderRadius: liveConfig?.style?.borderRadius ?? savedConfig?.borderRadius ?? DEFAULT_STYLE.borderRadius,
    buttonStyle:  liveConfig?.style?.buttonStyle  ?? savedConfig?.buttonStyle  ?? DEFAULT_STYLE.buttonStyle,
    density:      liveConfig?.style?.density      ?? savedConfig?.density      ?? DEFAULT_STYLE.density,
  };

  // Fall back to built-in defaults when no config saved yet
  const rawSections  = liveConfig?.sections ?? savedConfig?.sections ?? buildDefaultSections();
  const activeSections = rawSections.filter(s => s.enabled).sort((a, b) => a.order - b.order);

  useEffect(() => {
    injectFonts(activeStyle.headingFont, activeStyle.bodyFont);
  }, [activeStyle.headingFont, activeStyle.bodyFont]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: activeStyle.bgColor }}>
        <div className="text-center space-y-4">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: activeStyle.accentColor }} />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading...</p>
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

// ─── Page export ──────────────────────────────────────────────────────────────
export default function BookingPage({ params }: { params: { tenantId: string } }) {
  return <BookingPageContent tenantId={params.tenantId} />;
}
