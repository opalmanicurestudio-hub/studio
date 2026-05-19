'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { type PageSection } from '@/lib/data';
import { cn } from '@/lib/utils';
import {
  Calendar, Clock, MapPin, Phone, Mail, Instagram,
  ChevronDown, ChevronUp, Star, Gift, Sparkles, Pencil,
  ChevronLeft, ChevronRight, X as XIcon, ArrowRight, ArrowLeftRight,
} from 'lucide-react';

const ANIM_CSS = `
@keyframes cf-fade-up    { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
@keyframes cf-fade-in    { from{opacity:0} to{opacity:1} }
@keyframes cf-slide-left { from{opacity:0;transform:translateX(-28px)} to{opacity:1;transform:translateX(0)} }
@keyframes cf-slide-right{ from{opacity:0;transform:translateX(28px)} to{opacity:1;transform:translateX(0)} }
@keyframes cf-scale-up   { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
@keyframes cf-zoom-in    { from{opacity:0;transform:scale(1.08)} to{opacity:1;transform:scale(1)} }
@keyframes cf-marquee    { from{transform:translateX(0)} to{transform:translateX(-50%)} }
@keyframes cf-word-up    { from{opacity:0;transform:translateY(110%)} to{opacity:1;transform:translateY(0)} }
@keyframes cf-drift-a    { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-14px) rotate(2deg)} }
@keyframes cf-drift-b    { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(10px) rotate(-1.5deg)} }
@keyframes cf-drift-c    { 0%,100%{transform:translateX(0)} 50%{transform:translateX(10px)} }
@keyframes cf-line-grow  { from{transform:scaleX(0);opacity:0} to{transform:scaleX(1);opacity:1} }
@keyframes cf-reveal-r   { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0% 0 0)} }
@keyframes cf-float-up   { 0%{opacity:0;transform:translateY(40px) scale(0.96)} 100%{opacity:1;transform:translateY(0) scale(1)} }
@keyframes cf-blur-in    { from{opacity:0;filter:blur(12px);transform:scale(1.04)} to{opacity:1;filter:blur(0);transform:scale(1)} }
@keyframes cf-count-up   { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
`;

const STACKS: Record<string, string> = {
  cormorant:"'Cormorant Garamond',Georgia,serif", playfair:"'Playfair Display',Georgia,serif",
  lora:"'Lora',Georgia,serif", merriweather:"'Merriweather',Georgia,serif",
  'eb-garamond':"'EB Garamond',Georgia,serif", 'libre-bask':"'Libre Baskerville',Georgia,serif",
  'dm-serif':"'DM Serif Display',Georgia,serif", domine:"'Domine',Georgia,serif",
  space:"'Space Grotesk',system-ui,sans-serif", josefin:"'Josefin Sans',system-ui,sans-serif",
  raleway:"'Raleway',system-ui,sans-serif", montserrat:"'Montserrat',system-ui,sans-serif",
  nunito:"'Nunito',system-ui,sans-serif", poppins:"'Poppins',system-ui,sans-serif",
  outfit:"'Outfit',system-ui,sans-serif", 'dm-sans':"'DM Sans',system-ui,sans-serif",
  inter:"'Inter',system-ui,sans-serif", figtree:"'Figtree',system-ui,sans-serif",
  bebas:"'Bebas Neue',Impact,sans-serif", oswald:"'Oswald',system-ui,sans-serif",
  anton:"'Anton',Impact,sans-serif", righteous:"'Righteous',system-ui,sans-serif",
  abril:"'Abril Fatface',Georgia,serif", pacifico:"'Pacifico',cursive",
  dancing:"'Dancing Script',cursive", 'great-vibes':"'Great Vibes',cursive",
  georgia:'Georgia,serif', system:'system-ui,sans-serif',
};
const GFONTS: Record<string, string> = {
  cormorant:'Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400',
  playfair:'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400',
  lora:'Lora:ital,wght@0,400;0,600;0,700;1,400', merriweather:'Merriweather:wght@300;400;700',
  'eb-garamond':'EB+Garamond:wght@400;600', 'libre-bask':'Libre+Baskerville:wght@400;700',
  'dm-serif':'DM+Serif+Display', domine:'Domine:wght@400;700',
  space:'Space+Grotesk:wght@300;400;500;600;700', josefin:'Josefin+Sans:wght@300;400;600;700',
  raleway:'Raleway:wght@300;400;500;600;700', montserrat:'Montserrat:wght@300;400;500;600;700',
  nunito:'Nunito:wght@300;400;600;700', poppins:'Poppins:wght@300;400;500;600;700',
  outfit:'Outfit:wght@300;400;500;600;700', 'dm-sans':'DM+Sans:wght@300;400;500;700',
  inter:'Inter:wght@300;400;500;700', figtree:'Figtree:wght@300;400;500;700',
  bebas:'Bebas+Neue', oswald:'Oswald:wght@300;400;500;600',
  anton:'Anton', righteous:'Righteous', abril:'Abril+Fatface',
  pacifico:'Pacifico', dancing:'Dancing+Script:wght@400;600;700', 'great-vibes':'Great+Vibes',
};

function injectFonts(h: string, b: string) {
  if (typeof document === 'undefined') return;
  const ids = Array.from(new Set([h, b])).filter(f => GFONTS[f]);
  if (!ids.length) return;
  document.getElementById('cf-gfonts')?.remove();
  const link = document.createElement('link');
  link.id = 'cf-gfonts'; link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${ids.map(id => `family=${GFONTS[id]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

interface StyleConfig {
  accentColor: string; bgColor: string; headingFont: string; bodyFont: string;
  borderRadius: number; buttonStyle: string; density: string;
}
interface SectionProps {
  config: Record<string, any>; style: StyleConfig; data: PageData;
  isPreview: boolean; sectionId: string; onFieldTap?: (s: string, f: string) => void;
}
interface PageData { tenant: any; services: any[]; staff: any[]; events: any[]; tenantId: string; }

const DS: StyleConfig = {
  accentColor: '#000000', bgColor: '#ffffff', headingFont: 'josefin',
  bodyFont: 'inter', borderRadius: 4, buttonStyle: 'filled', density: 'balanced',
};

const ac  = (s: StyleConfig) => s.accentColor || '#000000';
const hf  = (s: StyleConfig) => STACKS[s.headingFont] || STACKS.josefin;
const bf  = (s: StyleConfig) => STACKS[s.bodyFont]    || STACKS.inter;
const br  = (s: StyleConfig, x = 1) => `${(s.borderRadius || 4) * x}px`;
const py  = (s: StyleConfig) =>
  s.density === 'compact' ? 'py-14 md:py-20' : s.density === 'airy' ? 'py-32 md:py-44' : 'py-24 md:py-32';

function btnStyle(s: StyleConfig, v: 'primary' | 'secondary' = 'primary') {
  const r = s.buttonStyle === 'pill' ? '999px' : br(s, 0.6);
  return v === 'primary'
    ? { background: s.buttonStyle === 'outline' || s.buttonStyle === 'ghost' ? 'transparent' : ac(s),
        color:      s.buttonStyle === 'outline' || s.buttonStyle === 'ghost' ? ac(s) : '#ffffff',
        border:     s.buttonStyle === 'ghost' ? 'none' : `2px solid ${ac(s)}`, borderRadius: r }
    : { background: 'transparent', color: ac(s), border: `2px solid ${ac(s)}`, borderRadius: r };
}

function hexToHsl(hex: string): string {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, sl = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max-min; sl = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){ case r: h=((g-b)/d+(g<b?6:0))/6; break; case g: h=((b-r)/d+2)/6; break; case b: h=((r-g)/d+4)/6; break; }
  }
  return `${Math.round(h*360)} ${Math.round(sl*100)}% ${Math.round(l*100)}%`;
}

function openBooking(service?: any) {
  window.dispatchEvent(new CustomEvent('cf-book', { detail: { service: service || null } }));
}
function cta(action?: string, url?: string) {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    if (action === 'booking') { openBooking(); return; }
    if (action === 'url' && url) { window.open(url, '_blank'); return; }
    const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    if (action === 'scroll-services') { go('services'); return; }
    if (action === 'scroll-contact')  { go('contact');  return; }
    if (action === 'scroll-team')     { go('team');     return; }
    go('contact');
  };
}

const ANIM_MAP: Record<string, string> = {
  'fade-up':'cf-fade-up', 'fade-in':'cf-fade-in', 'slide-left':'cf-slide-left',
  'slide-right':'cf-slide-right', 'scale-up':'cf-scale-up', 'zoom-in':'cf-zoom-in', 'none':'',
};

function useInView(t = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); obs.disconnect(); } }, { threshold: t });
    obs.observe(el); return () => obs.disconnect();
  }, [t]);
  return { ref, visible: v };
}

function FieldTap({ sectionId, fieldKey, isPreview, onFieldTap, as = 'span', children, style, className }: {
  sectionId: string; fieldKey: string; isPreview: boolean; onFieldTap?: (s: string, f: string) => void;
  as?: 'span'|'div'|'h1'|'h2'|'h3'|'p'; children: React.ReactNode; style?: React.CSSProperties; className?: string;
}) {
  const [hov, setHov] = useState(false);
  const Tag = as as any;
  const ts: React.CSSProperties = isPreview
    ? { ...style, cursor: 'pointer', outline: hov ? '2px solid rgba(99,102,241,0.8)' : '2px solid transparent', outlineOffset: '2px', borderRadius: '3px', transition: 'outline-color 0.15s' }
    : style || {};
  return (
    <Tag style={ts} className={className}
      onMouseEnter={() => isPreview && setHov(true)} onMouseLeave={() => isPreview && setHov(false)}
      onClick={isPreview ? (e: any) => { e.stopPropagation(); onFieldTap?.(sectionId, fieldKey); } : undefined}>
      {children}
    </Tag>
  );
}

function EditOverlay({ onClick, label = 'Edit section' }: { onClick: () => void; label?: string }) {
  return (
    <div className="absolute inset-0 z-50 cursor-pointer" onClick={onClick}>
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2.5px rgba(99,102,241,0.7)', borderRadius: '2px' }}/>
      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-white text-[10px] font-black uppercase tracking-widest shadow-xl" style={{ background: '#6366f1', borderRadius: '8px' }}>
        <Pencil className="w-3 h-3"/>{label}
      </div>
    </div>
  );
}

function SectionWrapper({ section, isPreview, onEdit, onFieldTap, children }: {
  section: PageSection; isPreview: boolean; onEdit: (id: string) => void;
  onFieldTap: (s: string, f: string) => void; children: React.ReactNode;
}) {
  const { ref, visible } = useInView();
  const [hov, setHov] = useState(false);
  const a = (section.config as any)._animation || {};
  const animName  = ANIM_MAP[a.type || 'fade-up'] || 'cf-fade-up';
  const animSpeed = a.speed || 700;
  if (section.type === 'nav') return (
    <div className="relative" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {children}{isPreview && hov && <EditOverlay onClick={() => onEdit(section.id)} label="Edit nav"/>}
    </div>
  );
  if ((a.type || 'fade-up') === 'none') return (
    <div className="relative" onMouseEnter={() => isPreview && setHov(true)} onMouseLeave={() => isPreview && setHov(false)}>
      {children}{isPreview && hov && <EditOverlay onClick={() => onEdit(section.id)}/>}
    </div>
  );
  return (
    <div ref={ref} className="relative"
      style={visible ? { animationName: animName, animationDuration: `${animSpeed}ms`, animationFillMode: 'both', animationTimingFunction: 'cubic-bezier(0.16,1,0.3,1)' } : { opacity: 0 }}
      onMouseEnter={() => isPreview && setHov(true)} onMouseLeave={() => isPreview && setHov(false)}>
      {children}{isPreview && hov && <EditOverlay onClick={() => onEdit(section.id)}/>}
    </div>
  );
}

function isBuilderConfig(pc: any): boolean {
  return Array.isArray(pc?.sections) && pc.sections.length > 0;
}

function buildDefaults(): PageSection[] {
  return [
    { id:'nav',      type:'nav',      enabled:true, order:0, config:{ logoText:'Studio', ctaText:'Book Now', showLinks:true, sticky:true, layout:'centered', ctaAction:'booking' } },
    { id:'hero',     type:'hero',     enabled:true, order:1, config:{ headline:'Book Your Experience', subheadline:'A sanctuary of craft, curated for those who appreciate the details.', ctaText:'Book a Session', showWalkIn:true, cta2Text:'Walk In Today', layout:'centered', overlayOpacity:40, ctaAction:'booking', cta2Action:'scroll-contact' } },
    { id:'services', type:'services', enabled:true, order:2, config:{ heading:'Our Services', subheading:'Handcrafted treatments for every occasion', ctaText:'Book this service', columns:'2', showPrices:true, showDuration:true, showDesc:true, layout:'cards', ctaAction:'booking' } },
    { id:'team',     type:'team',     enabled:true, order:3, config:{ heading:'The Artists', subheading:'Expert hands for every style', showSpecialties:true, layout:'circles' } },
    { id:'quote',    type:'quote',    enabled:true, order:4, config:{ heading:'Need Something Bigger?', subheading:'Planning a wedding, bridal party, or corporate event?', ctaText:'Request a Quote', tags:['Bridal Parties','Corporate Events','Destination Services'], layout:'centered', ctaAction:'scroll-contact' } },
    { id:'contact',  type:'contact',  enabled:true, order:5, config:{ heading:'Find Us', showMap:true, showHours:true, showPhone:true, showSocial:true, ctaText:'Book an Appointment', layout:'split-map', ctaAction:'booking' } },
  ];
}

// ─── Section components ────────────────────────────────────────────────────────

function NavSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'centered';

  const Logo = () => config.logoUrl
    ? <img src={config.logoUrl} alt="Logo" className="h-9 w-auto object-contain"/>
    : <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
        style={{ fontFamily: hf(style), color: ac(style), fontSize: '20px', fontWeight: 'bold', letterSpacing: '-0.05em' }}>
        {config.logoText || 'Studio'}
      </FieldTap>;

  const Links = ({ className = '' }: { className?: string }) => config.showLinks !== false ? (
    <div className={cn('hidden md:flex items-center gap-8', className)}>
      {['Services','Team','Contact'].map(l =>
        <a key={l} href={`#${l.toLowerCase()}`}
           className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
           style={{ fontFamily: bf(style) }}>{l}</a>)}
    </div>
  ) : null;

  const Cta = ({ size = 'default' }: { size?: 'default' | 'sm' }) => (
    <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
      <button onClick={cta(config.ctaAction, config.ctaUrl)}
              className={cn('font-black uppercase tracking-widest shadow-lg hover:opacity-90 transition-all active:scale-95',
                size === 'sm' ? 'px-4 py-2 text-[10px]' : 'px-6 py-2.5 text-[11px]')}
              style={{ ...btnStyle(style), fontFamily: bf(style) }}>
        {config.ctaText || 'Book Now'}
      </button>
    </FieldTap>
  );

  // ── floating — pill/capsule that hovers above content ─────────────────
  if (layout === 'floating') return (
    <div className={cn('z-50 flex justify-center px-4 pt-4', config.sticky !== false && 'sticky top-4')}>
      <nav className="flex items-center gap-6 px-6 py-3"
           style={{
             background: config.transparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.92)',
             backdropFilter: 'blur(20px)',
             WebkitBackdropFilter: 'blur(20px)',
             borderRadius: '999px',
             border: `1.5px solid rgba(0,0,0,0.07)`,
             boxShadow: '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
           }}>
        <Logo/>
        <Links/>
        <Cta size="sm"/>
      </nav>
    </div>
  );

  // ── bold — giant centered logo + link row below ───────────────────────
  if (layout === 'bold') return (
    <nav className={cn('z-50 w-full border-b', config.sticky !== false && 'sticky top-0',
                       config.transparent ? 'bg-transparent border-transparent' : 'bg-white/95 backdrop-blur-xl')}
         style={{ borderColor: config.transparent ? 'transparent' : ac(style) + '18' }}>
      <div className="flex flex-col items-center gap-1 py-4 px-6">
        {/* Giant logo */}
        {config.logoUrl
          ? <img src={config.logoUrl} alt="Logo" className="h-12 w-auto object-contain"/>
          : <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
              style={{ fontFamily: hf(style), color: ac(style), fontSize: 'clamp(28px,4vw,48px)', fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1 }}>
              {config.logoText || 'Studio'}
            </FieldTap>}
        {/* Links row */}
        <div className="flex items-center gap-6 flex-wrap justify-center">
          {config.showLinks !== false && ['Services','Team','Contact'].map(l =>
            <a key={l} href={`#${l.toLowerCase()}`}
               className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-900 transition-colors"
               style={{ fontFamily: bf(style) }}>{l}</a>)}
          <Cta size="sm"/>
        </div>
      </div>
    </nav>
  );

  // ── split — logo centered, links on both sides ────────────────────────
  if (layout === 'split') return (
    <nav className={cn('z-50 grid grid-cols-3 items-center px-8 py-4 border-b',
                       config.sticky !== false && 'sticky top-0',
                       config.transparent ? 'bg-transparent border-transparent' : 'bg-white/95 backdrop-blur-xl')}
         style={{ borderColor: config.transparent ? 'transparent' : ac(style) + '18' }}>
      {/* Left links */}
      <div className="hidden md:flex items-center gap-6">
        {['Services','Gallery'].map(l =>
          <a key={l} href={`#${l.toLowerCase()}`}
             className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
             style={{ fontFamily: bf(style) }}>{l}</a>)}
      </div>
      {/* Center logo */}
      <div className="flex justify-center">
        <Logo/>
      </div>
      {/* Right: links + cta */}
      <div className="hidden md:flex items-center justify-end gap-6">
        {['Team','Contact'].map(l =>
          <a key={l} href={`#${l.toLowerCase()}`}
             className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
             style={{ fontFamily: bf(style) }}>{l}</a>)}
        <Cta size="sm"/>
      </div>
      {/* Mobile: logo + cta */}
      <div className="md:hidden flex justify-end col-start-3"><Cta size="sm"/></div>
    </nav>
  );

  // ── logo-top — stacked two-row layout ────────────────────────────────
  if (layout === 'logo-top') return (
    <nav className={cn('z-50 flex flex-col items-center gap-2 py-4 px-6 border-b',
                       config.sticky !== false && 'sticky top-0',
                       config.transparent ? 'bg-transparent border-transparent' : 'bg-white/95 backdrop-blur-xl')}
         style={{ borderColor: config.transparent ? 'transparent' : ac(style) + '18' }}>
      <Logo/>
      <div className="flex items-center gap-6">
        <Links/><Cta size="sm"/>
      </div>
    </nav>
  );

  // ── minimal — just logo + cta ─────────────────────────────────────────
  if (layout === 'minimal') return (
    <nav className={cn('z-50 flex items-center justify-between px-6 md:px-14 py-4',
                       config.sticky !== false && 'sticky top-0',
                       config.transparent ? 'bg-transparent' : 'bg-white/95 backdrop-blur-xl')}>
      <Logo/><Cta/>
    </nav>
  );

  // ── centered — default ────────────────────────────────────────────────
  return (
    <nav className={cn('z-50 flex items-center justify-between px-6 md:px-14 py-4 border-b',
                       config.sticky !== false && 'sticky top-0',
                       config.transparent ? 'bg-transparent border-transparent' : 'bg-white/95 backdrop-blur-xl')}
         style={{ borderColor: config.transparent ? 'transparent' : ac(style) + '22' }}>
      <Logo/>
      <Links/>
      <Cta/>
    </nav>
  );
}

function HeroSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'centered';
  const hasBg = !!config.bgImage, hasVideo = !!config.videoUrl;
  const opacity = (config.overlayOpacity ?? 40) / 100;
  const hasMedia = (hasBg || hasVideo);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const tc = (l: string) => hasMedia && l !== 'minimal' ? 'white' : '#0f172a';
  const sc = (l: string) => hasMedia && l !== 'minimal' ? 'rgba(255,255,255,0.72)' : '#64748b';

  const headline = config.headline || 'Book Your Experience';
  const subheadline = config.subheadline || 'A sanctuary of craft, curated for those who appreciate the details.';
  const words = headline.split(' ');

  const BgMedia = ({ extraClass = '' }: { extraClass?: string }) => (
    <>
      {hasBg && <div className={cn('absolute inset-0 bg-center bg-cover', extraClass)} style={{ backgroundImage: `url(${config.bgImage})` }}/>}
      {hasVideo && <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      {hasMedia && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${opacity})` }}/>}
    </>
  );

  const BookBtns = ({ tc: textColor }: { tc: string }) => (
    <div className="flex flex-wrap gap-4">
      <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
        <button onClick={cta(config.ctaAction, config.ctaUrl)}
                className="px-10 py-4 font-bold shadow-2xl hover:scale-[1.03] active:scale-[0.98] transition-all"
                style={{ ...btnStyle(style), fontFamily: bf(style) }}>
          {config.ctaText || 'Book a Session'}
        </button>
      </FieldTap>
      {config.showWalkIn !== false && (
        <FieldTap sectionId={sectionId} fieldKey="cta2Text" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
          <button onClick={cta(config.cta2Action)}
                  className="px-10 py-4 font-bold hover:opacity-80 transition-all"
                  style={{ ...btnStyle(style, 'secondary'), borderColor: hasMedia ? 'white' : ac(style), color: hasMedia ? 'white' : ac(style), fontFamily: bf(style) }}>
            {config.cta2Text || 'Walk In'}
          </button>
        </FieldTap>
      )}
    </div>
  );

  // ── KINETIC — word-by-word animated reveal ────────────────────────────
  if (layout === 'kinetic') return (
    <section className="relative flex flex-col items-center justify-center overflow-hidden"
             style={{ minHeight: '92vh', background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : style.bgColor }}>
      {hasVideo && <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      {hasMedia && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${opacity})` }}/>}

      {/* Floating ambient blobs */}
      <div className="absolute top-[15%] left-[8%] w-48 h-48 rounded-full pointer-events-none"
           style={{ background: ac(style), opacity: 0.12, filter: 'blur(60px)', animation: 'cf-drift-a 9s ease-in-out infinite' }}/>
      <div className="absolute bottom-[20%] right-[10%] w-64 h-64 rounded-full pointer-events-none"
           style={{ background: ac(style), opacity: 0.1, filter: 'blur(80px)', animation: 'cf-drift-b 12s ease-in-out infinite 2s' }}/>

      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto space-y-10">
        {/* Badge */}
        {config.showBadge && config.badgeText && (
          <div className="flex justify-center"
               style={{ animation: 'cf-fade-in 0.8s 0.2s both' }}>
            <span className="px-5 py-1.5 border border-current/30 text-[10px] font-black uppercase tracking-[0.3em] rounded-full"
                  style={{ color: hasMedia ? 'rgba(255,255,255,0.7)' : ac(style) + 'aa' }}>
              {config.badgeText}
            </span>
          </div>
        )}

        {/* Word-by-word animated headline */}
        <h1 className="flex flex-wrap justify-center gap-x-[0.3em] leading-[0.9]"
            style={{ fontSize: 'clamp(48px, 8vw, 96px)', fontFamily: hf(style) }}>
          {words.map((word, i) => (
            <span key={i} className="overflow-hidden inline-block">
              <span className="inline-block"
                    style={{ color: tc(layout), animation: `cf-word-up 0.9s cubic-bezier(0.16,1,0.3,1) ${0.15 + i * 0.1}s both` }}>
                {word}
              </span>
            </span>
          ))}
        </h1>

        {/* Animated accent line + subtext */}
        <div className="flex flex-col items-center gap-3"
             style={{ animation: `cf-fade-in 1s ${0.2 + words.length * 0.1}s both` }}>
          <div className="h-px w-16 origin-left"
               style={{ background: hasMedia ? 'rgba(255,255,255,0.4)' : ac(style), animation: `cf-line-grow 0.8s ${0.3 + words.length * 0.1}s both` }}/>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-base md:text-lg max-w-xl leading-relaxed text-center"
            style={{ fontFamily: bf(style), color: sc(layout) }}>
            {subheadline}
          </FieldTap>
        </div>

        {/* CTAs with spring pop */}
        <div className="flex flex-wrap gap-4 justify-center"
             style={{ animation: `cf-float-up 0.9s cubic-bezier(0.34,1.56,0.64,1) ${0.4 + words.length * 0.1}s both` }}>
          <BookBtns tc={tc(layout)}/>
        </div>
      </div>

      {/* Floating dot accents */}
      {[...Array(4)].map((_, i) => (
        <div key={i} className="absolute pointer-events-none rounded-full"
             style={{
               width: [6,4,8,5][i], height: [6,4,8,5][i],
               top: ['20%','70%','40%','80%'][i], left: ['15%','80%','5%','60%'][i],
               background: hasMedia ? 'rgba(255,255,255,0.4)' : ac(style),
               animation: `${['cf-drift-a','cf-drift-b','cf-drift-c','cf-drift-a'][i]} ${[7,9,11,8][i]}s ease-in-out infinite ${i * 1.5}s`,
               opacity: 0.5,
             }}/>
      ))}
    </section>
  );

  // ── LAYERS — mouse-reactive parallax depth ────────────────────────────
  if (layout === 'layers') {
    const handleMM = (e: React.MouseEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setMouse({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
    };
    return (
      <section className="relative flex items-center overflow-hidden"
               style={{ minHeight: '95vh', background: hasMedia ? 'transparent' : '#0c0c0c', cursor: 'crosshair' }}
               onMouseMove={handleMM}>
        {/* Deep background — most movement */}
        <div className="absolute inset-[-6%] transition-transform duration-700 ease-out"
             style={{ transform: `translate(${mouse.x * 24}px, ${mouse.y * 16}px)` }}>
          {hasBg
            ? <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url(${config.bgImage})` }}/>
            : <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${ac(style)}30 0%, #000 70%)` }}/>}
          {hasMedia && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${Math.min(opacity + 0.15, 0.85)})` }}/>}
        </div>

        {/* Mid glow orbs */}
        <div className="absolute inset-0 pointer-events-none transition-transform duration-500 ease-out"
             style={{ transform: `translate(${mouse.x * 12}px, ${mouse.y * 8}px)` }}>
          <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full"
               style={{ background: ac(style) + '22', filter: 'blur(80px)' }}/>
          <div className="absolute bottom-1/3 left-1/5 w-64 h-64 rounded-full"
               style={{ background: ac(style) + '18', filter: 'blur(60px)' }}/>
        </div>

        {/* Foreground text — least movement */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 transition-transform duration-700 ease-out"
             style={{ transform: `translate(${mouse.x * 6}px, ${mouse.y * 4}px)` }}>
          <div className="max-w-3xl space-y-8" style={{ animation: 'cf-blur-in 1.2s 0.1s both' }}>
            {config.showBadge && config.badgeText && (
              <span className="inline-block px-4 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-white/60 border border-white/20 rounded-full">
                {config.badgeText}
              </span>
            )}
            <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h1" className="font-light leading-[0.9]"
              style={{ fontSize: 'clamp(52px,8vw,100px)', fontFamily: hf(style), color: 'white' }}>
              {headline}
            </FieldTap>
            <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" className="text-lg max-w-md leading-relaxed"
              style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.65)' }}>
              {subheadline}
            </FieldTap>
            <BookBtns tc="white"/>
          </div>
        </div>

        {/* Mouse cursor follower */}
        <div className="absolute pointer-events-none rounded-full transition-all duration-300 ease-out"
             style={{
               width: 300, height: 300,
               left: `calc(${(mouse.x + 0.5) * 100}% - 150px)`,
               top: `calc(${(mouse.y + 0.5) * 100}% - 150px)`,
               background: `radial-gradient(circle, ${ac(style)}18 0%, transparent 70%)`,
               filter: 'blur(2px)',
             }}/>
      </section>
    );
  }

  // ── FILMSTRIP — scrolling image reel behind text ──────────────────────
  if (layout === 'filmstrip') {
    const strips = config.filmImages?.length > 0
      ? config.filmImages
      : Array(8).fill(config.bgImage || null);
    const shade = (i: number) => ['10','18','14','20','12','16','0e','1c'][i % 8];
    return (
      <section className="relative flex items-center overflow-hidden"
               style={{ minHeight: '90vh', background: '#0a0a0a' }}>
        {/* Scrolling image strips */}
        <div className="absolute inset-0 flex flex-col gap-0 overflow-hidden opacity-50">
          {[0,1,2].map(row => (
            <div key={row} className="flex-1 flex items-stretch overflow-hidden">
              <div className="flex gap-1 items-stretch"
                   style={{
                     animation: `cf-marquee ${28 + row * 6}s linear infinite ${row % 2 === 1 ? 'reverse' : 'normal'}`,
                     width: 'max-content',
                   }}>
                {[...strips, ...strips, ...strips].map((img: any, i: number) => (
                  <div key={i} className="w-48 md:w-64 flex-shrink-0 h-full"
                       style={{
                         background: img ? `url(${img}) center/cover no-repeat` : ac(style) + shade(i),
                         filter: 'brightness(0.7)',
                       }}/>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Gradient vignette */}
        <div className="absolute inset-0"
             style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.75) 100%)' }}/>

        {/* Content */}
        <div className="relative z-10 w-full max-w-5xl mx-auto px-6 md:px-16 text-center space-y-8">
          {config.showBadge && config.badgeText && (
            <div style={{ animation: 'cf-fade-in 1s 0.3s both' }}>
              <span className="inline-block px-5 py-1.5 border border-white/25 text-[10px] font-black uppercase tracking-[0.3em] text-white/60 rounded-full">
                {config.badgeText}
              </span>
            </div>
          )}
          <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="h1" className="font-light leading-[0.9] text-white text-center"
            style={{ fontSize: 'clamp(48px,9vw,110px)', fontFamily: hf(style), animation: 'cf-blur-in 1.4s 0.2s both' }}>
            {headline}
          </FieldTap>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-lg max-w-2xl mx-auto leading-relaxed"
            style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.65)', animation: 'cf-fade-up 1s 0.5s both' }}>
            {subheadline}
          </FieldTap>
          <div className="flex gap-4 justify-center flex-wrap" style={{ animation: 'cf-float-up 0.9s 0.7s both' }}>
            <BookBtns tc="white"/>
          </div>
        </div>
      </section>
    );
  }

  // ── MAGAZINE — editorial bold typography ──────────────────────────────
  if (layout === 'magazine') return (
    <section className="relative overflow-hidden" style={{ minHeight: '90vh', background: style.bgColor }}>
      <div className="grid md:grid-cols-2 min-h-[90vh]">
        {/* Left: typography */}
        <div className="flex flex-col justify-center px-8 md:px-16 py-20 space-y-8">
          {config.showBadge && config.badgeText && (
            <span className="text-[10px] font-black uppercase tracking-[0.3em]"
                  style={{ color: ac(style) }}>
              — {config.badgeText}
            </span>
          )}
          <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="h1" className="font-light leading-[0.88]"
            style={{ fontSize: 'clamp(40px,6vw,80px)', fontFamily: hf(style), color: '#0f172a', animation: 'cf-fade-up 1s 0.1s both' }}>
            {headline}
          </FieldTap>
          <div className="h-0.5 w-12 origin-left" style={{ background: ac(style), animation: 'cf-line-grow 0.8s 0.4s both' }}/>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-base leading-relaxed max-w-sm"
            style={{ fontFamily: bf(style), color: '#64748b', animation: 'cf-fade-up 1s 0.5s both' }}>
            {subheadline}
          </FieldTap>
          <div style={{ animation: 'cf-fade-up 1s 0.7s both' }}>
            <BookBtns tc="#0f172a"/>
          </div>
        </div>
        {/* Right: image */}
        <div className="relative overflow-hidden" style={{ background: ac(style) + '12' }}>
          {hasBg
            ? <img src={config.bgImage} alt="" className="w-full h-full object-cover"
                   style={{ animation: 'cf-zoom-in 1.4s 0.1s both' }}/>
            : config.heroImage
            ? <img src={config.heroImage} alt="" className="w-full h-full object-cover"
                   style={{ animation: 'cf-zoom-in 1.4s 0.1s both' }}/>
            : <div className="w-full h-full flex items-center justify-center">
                <span className="text-[80px] font-light opacity-20" style={{ fontFamily: hf(style), color: ac(style) }}>
                  {(config.logoText || 'S')[0]}
                </span>
              </div>}
          {/* Accent stripe */}
          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: ac(style) }}/>
        </div>
      </div>
    </section>
  );

  // ── SPLIT ─────────────────────────────────────────────────────────────
  if (layout === 'split') return (
    <section className="relative flex items-center overflow-hidden"
             style={{ minHeight: '85vh', background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : style.bgColor }}>
      <BgMedia/>
      {config.showBadge && config.badgeText && (
        <FieldTap sectionId={sectionId} fieldKey="badgeText" isPreview={isPreview} onFieldTap={onFieldTap}
          as="div" className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 border border-white/30 bg-white/10 backdrop-blur text-white text-[10px] font-black uppercase tracking-widest rounded-full">
          {config.badgeText}
        </FieldTap>
      )}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 py-20">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h1" className="text-5xl md:text-7xl font-light leading-[0.95]"
              style={{ fontFamily: hf(style), color: tc(layout) }}>
              {headline}
            </FieldTap>
            <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" className="text-lg max-w-md leading-relaxed"
              style={{ fontFamily: bf(style), color: sc(layout) }}>
              {subheadline}
            </FieldTap>
            <BookBtns tc={tc(layout)}/>
          </div>
          <div>
            {config.heroImage
              ? <img src={config.heroImage} alt="" className="w-full aspect-[4/5] object-cover shadow-2xl" style={{ borderRadius: br(style, 2) }}/>
              : <div className="w-full aspect-[4/5]" style={{ background: ac(style)+'18', borderRadius: br(style, 2) }}/>}
          </div>
        </div>
      </div>
    </section>
  );

  // ── CINEMATIC ─────────────────────────────────────────────────────────
  if (layout === 'cinematic') return (
    <section className="relative flex items-end overflow-hidden"
             style={{ minHeight: '100vh', background: hasMedia ? 'transparent' : '#0a0a0a' }}>
      <BgMedia/>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)' }}/>
      {hasVideo && <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 pb-20 space-y-6">
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="font-light leading-[0.9] text-white"
          style={{ fontSize: 'clamp(44px,8vw,96px)', fontFamily: hf(style) }}>
          {headline}
        </FieldTap>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-lg max-w-xl leading-relaxed"
          style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.65)' }}>
          {subheadline}
        </FieldTap>
        <BookBtns tc="white"/>
      </div>
    </section>
  );

  // ── FULLBLEED ─────────────────────────────────────────────────────────
  if (layout === 'fullbleed') return (
    <section className="relative flex items-center overflow-hidden"
             style={{ minHeight: '100vh', background: hasBg ? `url(${config.bgImage}) center/cover` : style.bgColor }}>
      <BgMedia/>
      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 md:px-16 py-24 text-center space-y-8">
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="text-6xl md:text-8xl leading-[0.95] font-light"
          style={{ fontFamily: hf(style), color: tc(layout) }}>{headline}</FieldTap>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-xl max-w-2xl mx-auto leading-relaxed"
          style={{ fontFamily: bf(style), color: sc(layout) }}>{subheadline}</FieldTap>
        <div className="flex flex-wrap gap-4 justify-center"><BookBtns tc={tc(layout)}/></div>
      </div>
    </section>
  );

  // ── MINIMAL ───────────────────────────────────────────────────────────
  if (layout === 'minimal') return (
    <section className="flex items-center" style={{ minHeight: '70vh', background: '#ffffff' }}>
      <div className="w-full max-w-4xl mx-auto px-6 md:px-16 py-20 space-y-8">
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="text-5xl md:text-7xl font-light leading-[0.9]"
          style={{ fontFamily: hf(style), color: '#0f172a' }}>{headline}</FieldTap>
        <div className="h-0.5 w-16" style={{ background: ac(style) }}/>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-lg max-w-lg leading-relaxed text-slate-500"
          style={{ fontFamily: bf(style) }}>{subheadline}</FieldTap>
        <BookBtns tc="#0f172a"/>
      </div>
    </section>
  );

  // ── CENTERED — default ────────────────────────────────────────────────
  return (
    <section className="relative flex items-center overflow-hidden"
             style={{ minHeight: '82vh', background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : style.bgColor }}>
      <BgMedia/>
      {config.showBadge && config.badgeText && (
        <FieldTap sectionId={sectionId} fieldKey="badgeText" isPreview={isPreview} onFieldTap={onFieldTap}
          as="div" className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 border border-white/30 bg-white/10 backdrop-blur text-white text-[10px] font-black uppercase tracking-widest rounded-full">
          {config.badgeText}
        </FieldTap>
      )}
      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 md:px-16 py-24 text-center space-y-8">
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="text-6xl md:text-8xl leading-[0.95] font-light"
          style={{ fontFamily: hf(style), color: tc(layout) }}>{headline}</FieldTap>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-xl max-w-2xl mx-auto leading-relaxed"
          style={{ fontFamily: bf(style), color: sc(layout) }}>{subheadline}</FieldTap>
        <div className="flex flex-wrap gap-4 justify-center"><BookBtns tc={tc(layout)}/></div>
      </div>
    </section>
  );
}

function TrustSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const stats = [{ v:config.stat1v,l:config.stat1l },{ v:config.stat2v,l:config.stat2l },{ v:config.stat3v,l:config.stat3l },{ v:config.stat4v,l:config.stat4l }].filter(s => s.v);
  const layout = config.layout || 'strip', showDiv = config.showDividers !== false;
  const SV = ({ s, i, dark=false }: { s:{v:string;l:string}; i:number; dark?:boolean }) => (
    <div className={cn('space-y-1 py-2 text-center', showDiv && i < stats.length-1 && (dark ? 'border-r border-white/10' : 'border-r border-slate-100'))}>
      <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}v`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: dark ? 'white' : ac(style) }}>{s.v}</FieldTap>
      <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}l`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-[10px] font-black uppercase tracking-widest" style={{ color: dark ? ac(style)+'cc' : '#94a3b8', fontFamily: bf(style) }}>{s.l}</FieldTap>
    </div>
  );
  if (layout==='banner')  return <section className="py-12" style={{ background:'#0f172a' }}><div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">{stats.map((s,i)=><SV key={i} s={s} i={i} dark/>)}</div></section>;
  if (layout==='cards')   return <section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-4">{stats.map((s,i)=><div key={i} className="p-6 bg-white text-center space-y-2 shadow-sm" style={{ borderRadius:br(style,1.5), border:`2px solid ${ac(style)}18` }}><FieldTap sectionId={sectionId} fieldKey={`stat${i+1}v`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-4xl font-light" style={{ fontFamily:hf(style), color:ac(style) }}>{s.v}</FieldTap><FieldTap sectionId={sectionId} fieldKey={`stat${i+1}l`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily:bf(style) }}>{s.l}</FieldTap></div>)}</div></section>;
  if (layout==='ticker')  return <section className="py-4 border-y overflow-hidden" style={{ borderColor:ac(style)+'20' }}><div className="flex" style={{ animation:'cf-marquee 20s linear infinite', width:'max-content' }}>{[...stats,...stats,...stats,...stats].map((s,i)=><div key={i} className="flex items-center gap-2 px-8 shrink-0"><span className="text-2xl font-light" style={{ fontFamily:hf(style), color:ac(style) }}>{s.v}</span><span className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily:bf(style) }}>{s.l}</span><span className="w-1 h-1 rounded-full ml-4" style={{ background:ac(style)+'40' }}/></div>)}</div></section>;
  return <section className="py-14 border-y" style={{ borderColor:ac(style)+'20' }}><div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">{stats.map((s,i)=><SV key={i} s={s} i={i}/>)}</div></section>;
}

function ServicesSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'cards';
  const allServices = data.services;
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // ── Working category filter ──────────────────────────────────────────
  const categories = Array.from(new Set(
    allServices.map((s: any) => s.category).filter(Boolean)
  )) as string[];
  const services = activeCategory
    ? allServices.filter((s: any) => s.category === activeCategory)
    : allServices;

  // ── Shared header ────────────────────────────────────────────────────
  const Header = () => (
    <div className="text-center mb-12 space-y-4">
      <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
        as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>
        {config.heading || 'Our Services'}
      </FieldTap>
      {config.subheading && (
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>
          {config.subheading}
        </FieldTap>
      )}
    </div>
  );

  // ── Working category filter pills ────────────────────────────────────
  const CategoryFilter = () => config.showFilters && categories.length > 1 ? (
    <div className="flex flex-wrap gap-2 justify-center mb-10">
      <button
        onClick={() => setActiveCategory(null)}
        className="px-5 py-2 text-[10px] font-black uppercase tracking-widest transition-all duration-200"
        style={{
          background: !activeCategory ? ac(style) : 'transparent',
          color: !activeCategory ? 'white' : '#94a3b8',
          borderRadius: br(style, 2),
          border: `1.5px solid ${!activeCategory ? ac(style) : '#e2e8f0'}`,
        }}>
        All
      </button>
      {categories.map((cat) => (
        <button key={cat} onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
          className="px-5 py-2 text-[10px] font-black uppercase tracking-widest transition-all duration-200"
          style={{
            background: activeCategory === cat ? ac(style) : 'transparent',
            color: activeCategory === cat ? 'white' : '#94a3b8',
            borderRadius: br(style, 2),
            border: `1.5px solid ${activeCategory === cat ? ac(style) : '#e2e8f0'}`,
          }}>
          {cat}
        </button>
      ))}
    </div>
  ) : null;

  const Empty = () => (
    <p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">
      {allServices.length === 0 ? 'Services coming soon' : 'No services in this category'}
    </p>
  );

  const BookBtn = ({ svc, full = false }: { svc: any; full?: boolean }) => (
    <button
      onClick={e => { e.stopPropagation(); openBooking(svc); }}
      className={cn('text-[11px] font-black uppercase tracking-widest hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all', full ? 'w-full py-3.5' : 'px-6 py-3')}
      style={{ ...btnStyle(style), fontFamily: bf(style) }}>
      {config.ctaText || 'Book Now'}
    </button>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── 1. CARDS — premium image cards with hover depth ──────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'cards') {
    const cols = parseInt(config.columns) || 2;
    const gridCls = cols === 1 ? 'grid-cols-1 max-w-lg mx-auto'
      : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2';
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <Header/><CategoryFilter/>
          {services.length > 0 ? (
            <div className={`grid gap-6 ${gridCls}`}>
              {services.map((svc: any) => (
                <div key={svc.id}
                     className="group relative bg-white overflow-hidden transition-all duration-400 hover:shadow-2xl hover:-translate-y-2"
                     style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}18` }}>
                  {/* Image with overlay */}
                  {config.showImages && svc.imageUrl ? (
                    <div className="relative overflow-hidden aspect-[3/2]">
                      <img src={svc.imageUrl} alt={svc.name}
                           className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                      {/* Gradient overlay */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                           style={{ background: `linear-gradient(to top, ${ac(style)}cc 0%, transparent 60%)` }}/>
                      {/* Price badge on image */}
                      {config.showPrices !== false && svc.price && (
                        <div className="absolute top-3 right-3 px-3 py-1.5 text-white text-[11px] font-black shadow-lg"
                             style={{ background: ac(style), borderRadius: br(style) }}>
                          ${svc.price}
                        </div>
                      )}
                    </div>
                  ) : config.showImages && (
                    <div className="aspect-[3/2] flex items-center justify-center"
                         style={{ background: `linear-gradient(135deg, ${ac(style)}12 0%, ${ac(style)}06 100%)` }}>
                      <div className="w-12 h-12 rounded-full" style={{ background: ac(style) + '20' }}/>
                    </div>
                  )}
                  {/* Content */}
                  <div className="p-6 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight"
                          style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                      {config.showPrices !== false && svc.price && !config.showImages && (
                        <span className="text-lg font-light shrink-0" style={{ color: ac(style), fontFamily: hf(style) }}>
                          ${svc.price}
                        </span>
                      )}
                    </div>
                    {config.showDesc !== false && svc.description && (
                      <p className="text-sm text-slate-500 leading-relaxed line-clamp-2" style={{ fontFamily: bf(style) }}>
                        {svc.description}
                      </p>
                    )}
                    {config.showDuration !== false && svc.duration && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" style={{ color: ac(style) }}/>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {svc.duration} min
                        </p>
                      </div>
                    )}
                    {/* Accent line that grows on hover */}
                    <div className="h-px scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left mt-1"
                         style={{ background: ac(style) }}/>
                    <BookBtn svc={svc} full/>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty/>}
        </div>
      </section>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // ── 2. HORIZONTAL — alternating image + content rows ─────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'horizontal') return (
    <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="space-y-6">
            {services.map((svc: any, i: number) => {
              const imageLeft = i % 2 === 0;
              return (
                <div key={svc.id}
                     className="group grid md:grid-cols-2 overflow-hidden bg-white hover:shadow-2xl transition-all duration-400"
                     style={{ borderRadius: br(style, 2), border: `1.5px solid ${ac(style)}15` }}>
                  {/* Image */}
                  {(config.showImages || true) && (
                    <div className={cn('relative overflow-hidden', imageLeft ? 'md:order-1' : 'md:order-2')}
                         style={{ minHeight: '240px', background: ac(style) + '10' }}>
                      {svc.imageUrl
                        ? <img src={svc.imageUrl} alt={svc.name}
                               className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 absolute inset-0"/>
                        : <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-5xl font-light opacity-20" style={{ fontFamily: hf(style), color: ac(style) }}>
                              {svc.name?.[0]}
                            </div>
                          </div>}
                      {/* Category tag */}
                      {svc.category && (
                        <div className="absolute top-4 left-4 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white"
                             style={{ background: ac(style) + 'dd', borderRadius: '999px', backdropFilter: 'blur(4px)' }}>
                          {svc.category}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Content */}
                  <div className={cn('flex flex-col justify-center p-8 md:p-10 space-y-4', imageLeft ? 'md:order-2' : 'md:order-1')}>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] mb-2"
                         style={{ color: ac(style) }}>
                        {String(i + 1).padStart(2, '0')}
                      </p>
                      <h3 className="text-2xl font-light text-slate-900 mb-1"
                          style={{ fontFamily: hf(style) }}>{svc.name}</h3>
                      {config.showDuration !== false && svc.duration && (
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {svc.duration} min
                        </p>
                      )}
                    </div>
                    {config.showDesc !== false && svc.description && (
                      <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>
                        {svc.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      {config.showPrices !== false && svc.price && (
                        <span className="text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>
                          ${svc.price}
                        </span>
                      )}
                      <BookBtn svc={svc}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── 3. BENTO — modern mixed-size grid ────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'bento') return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 auto-rows-[minmax(200px,auto)]">
            {services.map((svc: any, i: number) => {
              const isFeatured = i === 0;
              return (
                <div key={svc.id}
                     className={cn(
                       'group relative overflow-hidden bg-white hover:shadow-2xl transition-all duration-400 cursor-pointer',
                       isFeatured ? 'col-span-2 row-span-2' : '',
                     )}
                     style={{ borderRadius: br(style, 2), border: `1.5px solid ${ac(style)}18` }}
                     onClick={() => openBooking(svc)}>
                  {/* Full image background */}
                  {svc.imageUrl && (
                    <>
                      <img src={svc.imageUrl} alt={svc.name}
                           className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                      <div className="absolute inset-0 transition-opacity duration-400"
                           style={{ background: isFeatured
                             ? 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)'
                             : 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.1) 100%)' }}/>
                    </>
                  )}
                  {/* No-image placeholder */}
                  {!svc.imageUrl && (
                    <div className="absolute inset-0"
                         style={{ background: isFeatured
                           ? `linear-gradient(135deg, ${ac(style)}22 0%, ${ac(style)}08 100%)`
                           : `linear-gradient(135deg, ${ac(style)}18 0%, ${ac(style)}06 100%)` }}/>
                  )}

                  {/* Content */}
                  <div className="absolute inset-0 flex flex-col justify-end p-5 md:p-6">
                    {svc.category && (
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] mb-1.5"
                            style={{ color: svc.imageUrl ? 'rgba(255,255,255,0.6)' : ac(style) + 'aa' }}>
                        {svc.category}
                      </span>
                    )}
                    <h3 className={cn('font-light leading-tight', isFeatured ? 'text-2xl md:text-3xl' : 'text-base md:text-lg')}
                        style={{ fontFamily: hf(style), color: svc.imageUrl ? 'white' : '#0f172a' }}>
                      {svc.name}
                    </h3>
                    {isFeatured && config.showDesc !== false && svc.description && (
                      <p className="text-sm mt-2 line-clamp-2"
                         style={{ color: svc.imageUrl ? 'rgba(255,255,255,0.65)' : '#64748b', fontFamily: bf(style) }}>
                        {svc.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-3">
                        {config.showPrices !== false && svc.price && (
                          <span className="font-black text-sm" style={{ color: svc.imageUrl ? 'white' : ac(style) }}>
                            ${svc.price}
                          </span>
                        )}
                        {config.showDuration !== false && svc.duration && (
                          <span className="text-[10px] font-bold uppercase tracking-widest"
                                style={{ color: svc.imageUrl ? 'rgba(255,255,255,0.55)' : '#94a3b8' }}>
                            {svc.duration}m
                          </span>
                        )}
                      </div>
                      {isFeatured && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <span className="text-[10px] font-black uppercase tracking-widest text-white px-4 py-2"
                                style={{ background: ac(style), borderRadius: br(style) }}>
                            {config.ctaText || 'Book →'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── 4. LUXURY LIST — numbered editorial list with hover image ─────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'luxury') return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="space-y-0">
            {services.map((svc: any, i: number) => (
              <div key={svc.id}
                   className="group relative"
                   onMouseEnter={() => setHoveredIdx(i)}
                   onMouseLeave={() => setHoveredIdx(null)}>
                {/* Hover image peek — right side */}
                {svc.imageUrl && hoveredIdx === i && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-40 h-28 overflow-hidden shadow-2xl z-20 pointer-events-none"
                       style={{ borderRadius: br(style, 1.5), animation: 'cf-scale-up 0.3s ease both' }}>
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover"/>
                  </div>
                )}
                <div className="flex items-center gap-6 md:gap-10 py-6 border-b transition-all duration-200 group-hover:px-4"
                     style={{ borderColor: ac(style) + '15', background: hoveredIdx === i ? ac(style) + '04' : 'transparent' }}>
                  {/* Number */}
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] shrink-0 w-8 text-right transition-all duration-200"
                        style={{ color: hoveredIdx === i ? ac(style) : '#cbd5e1' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl md:text-2xl font-light transition-all duration-200"
                        style={{ fontFamily: hf(style), color: hoveredIdx === i ? '#0f172a' : '#334155' }}>
                      {svc.name}
                    </h3>
                    {hoveredIdx === i && config.showDesc !== false && svc.description && (
                      <p className="text-sm text-slate-400 mt-1 leading-relaxed max-w-sm"
                         style={{ fontFamily: bf(style), animation: 'cf-fade-in 0.3s both' }}>
                        {svc.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-1">
                      {config.showDuration !== false && svc.duration && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {svc.duration} min
                        </span>
                      )}
                      {svc.category && (
                        <span className="text-[10px] font-bold uppercase tracking-widest"
                              style={{ color: ac(style) + '80' }}>
                          {svc.category}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Price */}
                  {config.showPrices !== false && svc.price && (
                    <span className="text-2xl font-light shrink-0 transition-all duration-200"
                          style={{ fontFamily: hf(style), color: hoveredIdx === i ? ac(style) : '#94a3b8' }}>
                      ${svc.price}
                    </span>
                  )}
                  {/* Book arrow — visible on hover */}
                  <button onClick={e => { e.stopPropagation(); openBooking(svc); }}
                          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300"
                          style={{
                            background: hoveredIdx === i ? ac(style) : 'transparent',
                            border: `1.5px solid ${hoveredIdx === i ? ac(style) : '#e2e8f0'}`,
                            opacity: hoveredIdx === i ? 1 : 0.4,
                          }}>
                    <ArrowRight className="w-4 h-4" style={{ color: hoveredIdx === i ? 'white' : '#94a3b8' }}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── 5. EDITORIAL / MAGAZINE — large feature + sidebar ────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'magazine') {
    const [feature, ...rest] = services;
    return (
      <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <Header/><CategoryFilter/>
          {services.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-5">
              {/* Feature card — 2 cols */}
              {feature && (
                <div className="md:col-span-2 group relative overflow-hidden bg-white hover:shadow-2xl transition-all duration-500 cursor-pointer"
                     style={{ borderRadius: br(style, 2), border: `1.5px solid ${ac(style)}15`, minHeight: '420px' }}
                     onClick={() => openBooking(feature)}>
                  {feature.imageUrl ? (
                    <>
                      <img src={feature.imageUrl} alt={feature.name}
                           className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                      <div className="absolute inset-0"
                           style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 55%)' }}/>
                    </>
                  ) : (
                    <div className="absolute inset-0"
                         style={{ background: `linear-gradient(135deg, ${ac(style)}18 0%, ${ac(style)}06 100%)` }}/>
                  )}
                  <div className="absolute bottom-0 inset-x-0 p-8 space-y-3">
                    {feature.category && (
                      <span className="text-[9px] font-black uppercase tracking-[0.3em]"
                            style={{ color: feature.imageUrl ? 'rgba(255,255,255,0.55)' : ac(style) }}>
                        {feature.category}
                      </span>
                    )}
                    <h3 className="text-3xl md:text-4xl font-light"
                        style={{ fontFamily: hf(style), color: feature.imageUrl ? 'white' : '#0f172a' }}>
                      {feature.name}
                    </h3>
                    {config.showDesc !== false && feature.description && (
                      <p className="text-sm max-w-sm leading-relaxed"
                         style={{ color: feature.imageUrl ? 'rgba(255,255,255,0.65)' : '#64748b', fontFamily: bf(style) }}>
                        {feature.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-4">
                        {config.showPrices !== false && feature.price && (
                          <span className="text-2xl font-light"
                                style={{ fontFamily: hf(style), color: feature.imageUrl ? 'white' : ac(style) }}>
                            ${feature.price}
                          </span>
                        )}
                        {config.showDuration !== false && feature.duration && (
                          <span className="text-[10px] font-black uppercase tracking-widest"
                                style={{ color: feature.imageUrl ? 'rgba(255,255,255,0.5)' : '#94a3b8' }}>
                            {feature.duration} min
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white px-5 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: ac(style), borderRadius: br(style) }}>
                        {config.ctaText || 'Book Now'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {/* Sidebar: remaining services */}
              <div className="flex flex-col gap-3">
                {rest.slice(0, 5).map((svc: any) => (
                  <div key={svc.id}
                       className="group flex items-center gap-4 p-4 bg-white hover:shadow-md transition-all duration-300 cursor-pointer"
                       style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}12` }}
                       onClick={() => openBooking(svc)}>
                    {svc.imageUrl && (
                      <div className="w-16 h-16 shrink-0 overflow-hidden"
                           style={{ borderRadius: br(style) }}>
                        <img src={svc.imageUrl} alt={svc.name}
                             className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"/>
                      </div>
                    )}
                    {!svc.imageUrl && (
                      <div className="w-12 h-12 shrink-0 flex items-center justify-center"
                           style={{ background: ac(style) + '12', borderRadius: br(style) }}>
                        <span className="text-lg font-light" style={{ color: ac(style), fontFamily: hf(style) }}>
                          {svc.name?.[0]}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate"
                         style={{ fontFamily: bf(style) }}>{svc.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {config.showPrices !== false && svc.price && (
                          <span className="text-sm font-light" style={{ color: ac(style), fontFamily: hf(style) }}>
                            ${svc.price}
                          </span>
                        )}
                        {config.showDuration !== false && svc.duration && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                            {svc.duration}m
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                style={{ color: ac(style) }}/>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty/>}
        </div>
      </section>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // ── 6. MASONRY — Pinterest-style varied heights ───────────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'masonry') return (
    <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-0">
            {services.map((svc: any, i: number) => (
              <div key={svc.id}
                   className="group break-inside-avoid mb-5 bg-white overflow-hidden hover:shadow-2xl transition-all duration-400 cursor-pointer block"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}15` }}
                   onClick={() => openBooking(svc)}>
                {svc.imageUrl && (
                  <div className="overflow-hidden"
                       style={{ aspectRatio: [4/3, 1, 3/4, 5/4, 1, 4/3][i % 6].toString().replace(',', '/') }}>
                    <img src={svc.imageUrl} alt={svc.name}
                         className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                  </div>
                )}
                {!svc.imageUrl && (
                  <div className="aspect-square flex items-center justify-center"
                       style={{ background: `linear-gradient(135deg, ${ac(style)}14 0%, ${ac(style)}06 100%)` }}>
                    <span className="text-5xl font-light opacity-30" style={{ fontFamily: hf(style), color: ac(style) }}>
                      {svc.name?.[0]}
                    </span>
                  </div>
                )}
                <div className="p-5 space-y-2">
                  <h3 className="text-sm font-black uppercase tracking-tight text-slate-900"
                      style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                  {config.showDesc !== false && svc.description && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-3"
                       style={{ fontFamily: bf(style) }}>{svc.description}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3">
                      {config.showPrices !== false && svc.price && (
                        <span className="text-base font-light" style={{ color: ac(style), fontFamily: hf(style) }}>
                          ${svc.price}
                        </span>
                      )}
                      {config.showDuration !== false && svc.duration && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                          {svc.duration}m
                        </span>
                      )}
                    </div>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300"
                         style={{ background: ac(style) }}>
                      <ArrowRight className="w-3 h-3 text-white"/>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── 7. LIST — refined full-width list ────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'list') return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="space-y-3">
            {services.map((svc: any) => (
              <div key={svc.id}
                   className="group flex items-center gap-5 p-5 bg-white hover:shadow-lg transition-all duration-300"
                   style={{ borderRadius: br(style), border: `1.5px solid ${ac(style)}18` }}>
                {config.showImages && svc.imageUrl && (
                  <div className="w-16 h-16 shrink-0 overflow-hidden" style={{ borderRadius: br(style) }}>
                    <img src={svc.imageUrl} alt={svc.name}
                         className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"/>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 truncate"
                        style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                    {config.showPrices !== false && svc.price && (
                      <span className="text-lg font-light shrink-0" style={{ color: ac(style), fontFamily: hf(style) }}>
                        ${svc.price}
                      </span>
                    )}
                  </div>
                  {config.showDesc !== false && svc.description && (
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-2"
                       style={{ fontFamily: bf(style) }}>{svc.description}</p>
                  )}
                  {config.showDuration !== false && svc.duration && (
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mt-1">
                      {svc.duration} min
                    </p>
                  )}
                </div>
                <BookBtn svc={svc}/>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── 8. GRID — compact uniform grid ───────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (layout === 'grid') return (
    <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {services.map((svc: any) => (
              <div key={svc.id}
                   className="group bg-white overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}15` }}
                   onClick={() => openBooking(svc)}>
                {svc.imageUrl ? (
                  <div className="aspect-square overflow-hidden">
                    <img src={svc.imageUrl} alt={svc.name}
                         className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-600"/>
                  </div>
                ) : (
                  <div className="aspect-square flex items-center justify-center"
                       style={{ background: ac(style) + '10' }}>
                    <span className="text-3xl font-light opacity-40" style={{ color: ac(style), fontFamily: hf(style) }}>
                      {svc.name?.[0]}
                    </span>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 mb-1"
                     style={{ fontFamily: bf(style) }}>{svc.name}</p>
                  <div className="flex items-center justify-between">
                    {config.showPrices !== false && svc.price && (
                      <span className="text-sm font-light" style={{ color: ac(style), fontFamily: hf(style) }}>
                        ${svc.price}
                      </span>
                    )}
                    {config.showDuration !== false && svc.duration && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                        {svc.duration}m
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  // ── FEATURED fallback → same as magazine ─────────────────────────────
  return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {services.map((svc: any) => (
              <div key={svc.id}
                   className="group p-7 bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}20` }}>
                {config.showImages && svc.imageUrl && (
                  <div className="overflow-hidden aspect-[3/2] mb-5" style={{ borderRadius: br(style) }}>
                    <img src={svc.imageUrl} alt={svc.name}
                         className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                  </div>
                )}
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2"
                    style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                {config.showDesc !== false && svc.description && (
                  <p className="text-sm text-slate-500 leading-relaxed mb-4" style={{ fontFamily: bf(style) }}>
                    {svc.description}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  {config.showPrices !== false && svc.price && (
                    <span className="text-xl font-light" style={{ color: ac(style), fontFamily: hf(style) }}>
                      ${svc.price}
                    </span>
                  )}
                  <BookBtn svc={svc}/>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );
}

// ─── TEAM SECTION — all 6 layouts fully implemented ───────────────────────────
function TeamSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const staff = data.staff;
  const layout = config.layout || 'circles';

  const Header = () => (
    <div className="text-center mb-16 space-y-4">
      <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
        as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>
        {config.heading || 'The Artists'}
      </FieldTap>
      {config.subheading && (
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>
          {config.subheading}
        </FieldTap>
      )}
    </div>
  );

  if (staff.length === 0) return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Team coming soon</p>
      </div>
    </section>
  );

  // ── circles ────────────────────────────────────────────────────────────
  if (layout === 'circles') return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">
          {staff.map((m: any) => (
            <div key={m.id} className="text-center space-y-4 group">
              <div className="relative mx-auto w-28 h-28 overflow-hidden shadow-lg group-hover:shadow-2xl group-hover:scale-105 transition-all duration-500"
                   style={{ background: ac(style) + '15', borderRadius: '50%' }}>
                {m.avatarUrl
                  ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>
                  : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light"
                          style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 &&
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{m.specialties.slice(0, 2).join(' · ')}</p>}
                {config.showBio && m.bio &&
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed" style={{ fontFamily: bf(style) }}>{m.bio}</p>}
                {config.showBookButton &&
                  <button onClick={e => { e.stopPropagation(); openBooking(); }}
                          className="mt-3 px-5 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                          style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                    {config.bookCta || 'Book'}
                  </button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── row ────────────────────────────────────────────────────────────────
  if (layout === 'row') return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="flex gap-6 overflow-x-auto pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>
          {staff.map((m: any) => (
            <div key={m.id} className="text-center space-y-3 shrink-0 snap-start group" style={{ width: '160px' }}>
              <div className="mx-auto overflow-hidden shadow-lg group-hover:scale-105 transition-all duration-500"
                   style={{ width: 96, height: 96, background: ac(style) + '15', borderRadius: br(style, 1.5) }}>
                {m.avatarUrl
                  ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>
                  : <span className="w-full h-full flex items-center justify-center text-2xl font-light"
                          style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 truncate"
                 style={{ fontFamily: bf(style) }}>{m.name}</p>
              {config.showSpecialties !== false && m.specialties?.length > 0 &&
                <p className="text-[9px] text-slate-400 uppercase tracking-wider">{m.specialties[0]}</p>}
              {config.showBookButton &&
                <button onClick={e => { e.stopPropagation(); openBooking(); }}
                        className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                        style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                  {config.bookCta || 'Book'}
                </button>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── editorial ──────────────────────────────────────────────────────────
  if (layout === 'editorial') return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {staff.map((m: any) => (
            <div key={m.id}
                 className="group overflow-hidden bg-white hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
                 style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}18` }}>
              <div className="relative aspect-[4/3] overflow-hidden" style={{ background: ac(style) + '12' }}>
                {m.avatarUrl
                  ? <img src={m.avatarUrl} alt={m.name}
                         className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                  : <span className="absolute inset-0 flex items-center justify-center text-5xl font-light"
                          style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
                {/* Shimmer on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                     style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 100%)' }}/>
              </div>
              <div className="p-5 space-y-2">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900"
                   style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 &&
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    {m.specialties.slice(0, 2).join(' · ')}
                  </p>}
                {config.showBio && m.bio &&
                  <p className="text-xs text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{m.bio}</p>}
                {config.showBookButton &&
                  <button onClick={e => { e.stopPropagation(); openBooking(); }}
                          className="w-full mt-2 py-2.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90"
                          style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                    {config.bookCta || 'Book'}
                  </button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── grid ───────────────────────────────────────────────────────────────
  if (layout === 'grid') return (
    <section id="team" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {staff.map((m: any) => (
            <div key={m.id}
                 className="group relative overflow-hidden bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                 style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}18` }}>
              {/* Square photo */}
              <div className="relative aspect-square overflow-hidden" style={{ background: ac(style) + '10' }}>
                {m.avatarUrl
                  ? <img src={m.avatarUrl} alt={m.name}
                         className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                  : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light"
                          style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}

                {/* Hover reveal bio */}
                {config.hoverReveal !== false && m.bio && (
                  <div className="absolute inset-0 flex items-end p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                       style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 50%)' }}>
                    <p className="text-[10px] text-white/80 leading-relaxed line-clamp-3"
                       style={{ fontFamily: bf(style) }}>{m.bio}</p>
                  </div>
                )}

                {/* Accent stripe on hover */}
                <div className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"
                     style={{ background: ac(style) }}/>
              </div>

              {/* Info */}
              <div className="p-4 space-y-1">
                <p className="text-[11px] font-black uppercase tracking-tight text-slate-900"
                   style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 &&
                  <p className="text-[9px] uppercase tracking-wider text-slate-400">
                    {m.specialties.slice(0, 2).join(' · ')}
                  </p>}
                {config.showBookButton &&
                  <button onClick={e => { e.stopPropagation(); openBooking(); }}
                          className="w-full mt-2 py-2 text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                          style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                    {config.bookCta || 'Book'}
                  </button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── featured ───────────────────────────────────────────────────────────
  if (layout === 'featured') {
    const [lead, ...rest] = staff;
    return (
      <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
          <div className="grid md:grid-cols-3 gap-5 items-start">

            {/* Lead artist — 2 columns wide */}
            {lead && (
              <div className="md:col-span-2 group relative overflow-hidden bg-white hover:shadow-2xl transition-all duration-500"
                   style={{ borderRadius: br(style, 2), border: `2px solid ${ac(style)}20` }}>
                <div className="relative aspect-[4/3] overflow-hidden" style={{ background: ac(style) + '10' }}>
                  {lead.avatarUrl
                    ? <img src={lead.avatarUrl} alt={lead.name}
                           className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                    : <span className="absolute inset-0 flex items-center justify-center text-8xl font-light"
                            style={{ fontFamily: hf(style), color: ac(style) + '40' }}>{lead.name?.[0]}</span>}

                  {/* Gradient on bottom */}
                  <div className="absolute inset-0"
                       style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0) 55%)' }}/>

                  {/* Info overlay */}
                  <div className="absolute bottom-0 inset-x-0 p-8 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/50">Lead Artist</p>
                    <p className="text-2xl md:text-3xl font-light text-white"
                       style={{ fontFamily: hf(style) }}>{lead.name}</p>
                    {config.showSpecialties !== false && lead.specialties?.length > 0 &&
                      <p className="text-[11px] text-white/55 uppercase tracking-wider">
                        {lead.specialties.slice(0, 3).join(' · ')}
                      </p>}
                    {config.showBio && lead.bio &&
                      <p className="text-sm text-white/45 leading-relaxed max-w-sm"
                         style={{ fontFamily: bf(style) }}>{lead.bio}</p>}
                    {config.showBookButton && (
                      <button onClick={e => { e.stopPropagation(); openBooking(); }}
                              className="mt-2 px-8 py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all"
                              style={{ background: 'white', color: ac(style), borderRadius: br(style), fontFamily: bf(style) }}>
                        {config.bookCta || 'Book with me'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Supporting team — 1 column */}
            <div className="flex flex-col gap-4">
              {rest.slice(0, 4).map((m: any) => (
                <div key={m.id}
                     className="group flex items-center gap-4 p-4 bg-white hover:shadow-md transition-all"
                     style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}15` }}>
                  <div className="w-16 h-16 shrink-0 overflow-hidden rounded-full"
                       style={{ background: ac(style) + '12' }}>
                    {m.avatarUrl
                      ? <img src={m.avatarUrl} alt={m.name}
                             className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"/>
                      : <span className="w-full h-full flex items-center justify-center text-xl font-light"
                              style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate"
                       style={{ fontFamily: bf(style) }}>{m.name}</p>
                    {config.showSpecialties !== false && m.specialties?.length > 0 &&
                      <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5 truncate">
                        {m.specialties.slice(0, 2).join(' · ')}
                      </p>}
                    {config.showBookButton && (
                      <button onClick={e => { e.stopPropagation(); openBooking(); }}
                              className="mt-2 px-4 py-1 text-[9px] font-black uppercase tracking-widest hover:opacity-90"
                              style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                        {config.bookCta || 'Book'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {rest.length > 4 && (
                <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] py-1"
                   style={{ color: ac(style) + '60' }}>
                  +{rest.length - 4} more artists
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ── minimal ────────────────────────────────────────────────────────────
  return (
    <section id="team" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="max-w-lg mx-auto space-y-0">
          {staff.map((m: any, idx: number) => (
            <div key={m.id}
                 className="flex items-center gap-4 py-4"
                 style={{ borderBottom: idx < staff.length - 1 ? `1px solid ${ac(style)}18` : 'none' }}>
              <div className="w-10 h-10 rounded-full overflow-hidden shrink-0"
                   style={{ background: ac(style) + '15' }}>
                {m.avatarUrl
                  ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>
                  : <span className="w-full h-full flex items-center justify-center text-sm font-light"
                          style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <div className="flex-1">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900"
                   style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 &&
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {m.specialties.slice(0, 2).join(' · ')}
                  </p>}
              </div>
              {config.showBookButton && (
                <button onClick={e => { e.stopPropagation(); openBooking(); }}
                        className="shrink-0 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                        style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                  {config.bookCta || 'Book'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewsSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [idx, setIdx] = useState(0);
  const layout = config.layout || 'grid';
  const reviews = [1,2,3,4,5,6].map(n=>({
    name:  config[`rev${n}Name`]  ||['Sarah M.','Jessica T.','Priya K.','Amara B.','Lena S.','Chloe W.'][n-1]||'',
    rating:config[`rev${n}Rating`]??5,
    text:  config[`rev${n}Text`]  ||['Absolutely incredible experience.','Every visit exceeds expectations.','Luxurious yet so welcoming.','Cannot recommend enough.','A gem of a studio.','Creative and professional.'][n-1]||'',
    photo: config[`rev${n}Photo`] ||'',
  })).filter(r=>r.name&&r.text);
  const Stars=({n}:{n:number})=><div className="flex gap-0.5">{Array(Math.max(1,Math.min(5,n))).fill(0).map((_,j)=><Star key={j} className="w-3.5 h-3.5 fill-current" style={{ color:ac(style) }}/>)}</div>;
  const Card=({r}:{r:typeof reviews[0]})=>(
    <div className="p-8 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300" style={{ borderRadius:br(style,1.5),border:`2px solid ${ac(style)}20` }}>
      {config.showRating!==false&&<div className="mb-4"><Stars n={r.rating}/></div>}
      {r.photo&&config.showPhotos&&<img src={r.photo} alt={r.name} className="w-10 h-10 rounded-full object-cover mb-4"/>}
      <p className="text-sm leading-relaxed text-slate-600 italic mb-4">"{r.text}"</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily:bf(style) }}>— {r.name}</p>
    </div>
  );
  if (layout==='quotes') {
    const r=reviews[idx%Math.max(1,reviews.length)];
    return (
      <section className={py(style)} style={{ background:style.bgColor }}>
        <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-10">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'What Clients Say'}</FieldTap>
          {r&&<div className="space-y-8">
            {config.showRating!==false&&<div className="flex justify-center"><Stars n={r.rating}/></div>}
            <p className="text-2xl md:text-3xl font-light italic leading-relaxed text-slate-700" style={{ fontFamily:hf(style) }}>"{r.text}"</p>
            <div className="flex items-center justify-center gap-4">{r.photo&&<img src={r.photo} alt={r.name} className="w-10 h-10 rounded-full object-cover"/>}<p className="text-[11px] font-black uppercase tracking-widest text-slate-400">— {r.name}</p></div>
            {reviews.length>1&&<div className="flex items-center justify-center gap-3">
              <button onClick={()=>setIdx(i=>(i-1+reviews.length)%reviews.length)} className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all" style={{ borderColor:ac(style)+'30' }}><ChevronLeft className="w-4 h-4"/></button>
              {reviews.map((_,i)=><div key={i} className="w-2 h-2 rounded-full transition-all cursor-pointer" style={{ background:i===idx%reviews.length?ac(style):'#cbd5e1' }} onClick={()=>setIdx(i)}/>)}
              <button onClick={()=>setIdx(i=>(i+1)%reviews.length)} className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all" style={{ borderColor:ac(style)+'30' }}><ChevronRight className="w-4 h-4"/></button>
            </div>}
          </div>}
        </div>
      </section>
    );
  }
  if (layout==='carousel') return (
    <section className={py(style)} style={{ background:'#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'What Clients Say'}</FieldTap></div>
        <div className="flex gap-6 overflow-x-auto pb-4 snap-x" style={{ scrollbarWidth:'none' }}>{reviews.map((r,i)=><div key={i} className="shrink-0 snap-start w-[320px]"><Card r={r}/></div>)}</div>
      </div>
    </section>
  );
  return (
    <section className={py(style)} style={{ background:style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'What Clients Say'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily:bf(style) }}>{config.subheading}</p>}</div>
        <div className="grid md:grid-cols-3 gap-6">{reviews.slice(0,6).map((r,i)=><Card key={i} r={r}/>)}</div>
      </div>
    </section>
  );
}

function GallerySection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [lb,setLb]=useState<string|null>(null);
  const uploaded:any[]=Array.isArray(config.images)?config.images:[];
  const layout=config.layout||'grid',cols=parseInt(config.columns)||3;
  const gridCls=cols===2?'grid-cols-2':cols===4?'grid-cols-2 md:grid-cols-4':'grid-cols-2 md:grid-cols-3';
  const shades=['08','10','14','18','12','16','0a','16','20','12'];
  const imgs=uploaded.length>0?uploaded:shades.map((s,i)=>({ id:i,url:null,caption:'',shade:s }));
  const hCls=config.hoverEffect==='fade'?'group-hover:opacity-60 transition-opacity duration-500':config.hoverEffect==='none'?'':'group-hover:scale-110 transition-transform duration-700';
  const H=()=><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Our Work'}</FieldTap>{config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{ fontFamily:bf(style) }}>{config.subheading}</FieldTap>}</div>;
  const Lb=()=>lb?(<div className="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center p-4" onClick={()=>setLb(null)}><button className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"><XIcon className="w-8 h-8"/></button><img src={lb} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={e=>e.stopPropagation()}/></div>):null;
  if (layout==='carousel') return (<section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-6xl mx-auto px-6 md:px-16"><H/><div className="flex gap-4 overflow-x-auto pb-4 snap-x" style={{ scrollbarWidth:'none' }}>{imgs.map((img:any,i:number)=><div key={i} className="shrink-0 snap-start overflow-hidden group cursor-pointer" style={{ width:'280px',height:'350px',borderRadius:br(style) }} onClick={()=>img.url&&config.lightbox!==false&&setLb(img.url)}>{img.url?<img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/>:<div className="w-full h-full" style={{ background:ac(style)+img.shade }}/>}</div>)}</div></div><Lb/></section>);
  return (<section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-6xl mx-auto px-6 md:px-16"><H/><div className={`grid ${gridCls} gap-3`}>{imgs.map((img:any,i:number)=><div key={img.id??i} className={cn('overflow-hidden group cursor-pointer aspect-square',layout==='masonry'&&(i===0||i===5)?'row-span-2':'')} style={{ borderRadius:br(style) }} onClick={()=>img.url&&config.lightbox!==false&&setLb(img.url)}>{img.url?(<div className="relative h-full"><img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/>{config.showCaptions&&img.caption&&<div className="absolute bottom-0 inset-x-0 px-3 py-2 bg-black/50 text-white text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{img.caption}</div>}</div>):<div className="w-full h-full" style={{ background:ac(style)+img.shade }}/>}</div>)}</div></div><Lb/></section>);
}

// ─── BEFORE/AFTER — Interactive drag slider widget ─────────────────────────────
function BeforeAfterSlider({ pair, sliderColor, showLabels, style }: {
  pair: any; sliderColor: string; showLabels: boolean; style: StyleConfig;
}) {
  const [pct, setPct] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const moveTo = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    setPct(Math.min(97, Math.max(3, ((clientX - left) / width) * 100)));
    setHasInteracted(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMM = (e: MouseEvent) => { moveTo(e.clientX); e.preventDefault(); };
    const onTM = (e: TouchEvent) => { moveTo(e.touches[0].clientX); e.preventDefault(); };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMM);
    window.addEventListener('touchmove', onTM, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMM);
      window.removeEventListener('touchmove', onTM);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [isDragging, moveTo]);

  const hasBefore = !!pair?.beforeUrl;
  const hasAfter  = !!pair?.afterUrl;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden select-none"
      style={{ borderRadius: br(style), aspectRatio: '4/3', cursor: 'ew-resize' }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseDown={e => { setIsDragging(true); moveTo(e.clientX); e.preventDefault(); }}
      onTouchStart={e => { setIsDragging(true); moveTo(e.touches[0].clientX); }}
    >
      {/* ── Before layer ── */}
      <div className="absolute inset-0">
        {hasBefore
          ? <img src={pair.beforeUrl} alt="Before" className="w-full h-full object-cover" draggable={false}/>
          : <div className="w-full h-full bg-slate-100 flex items-center justify-center">
              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-300">Before</span>
            </div>}
      </div>

      {/* ── After layer — clipped ── */}
      <div className="absolute inset-0 pointer-events-none"
           style={{ clipPath: `inset(0 ${100 - pct}% 0 0)`, transition: isDragging ? 'none' : 'clip-path 0.04s ease' }}>
        {hasAfter
          ? <img src={pair.afterUrl} alt="After" className="w-full h-full object-cover" draggable={false}/>
          : <div className="w-full h-full flex items-center justify-center"
                 style={{ background: ac(style) + '18' }}>
              <span className="text-[11px] font-black uppercase tracking-[0.3em]"
                    style={{ color: ac(style) + 'aa' }}>After</span>
            </div>}
        {/* Subtle edge glow */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: `linear-gradient(to right, ${sliderColor}18 0%, transparent 8%)` }}/>
      </div>

      {/* ── Divider line ── */}
      <div className="absolute top-0 bottom-0 pointer-events-none"
           style={{
             left: `${pct}%`, width: '2px',
             transform: 'translateX(-50%)',
             background: 'white',
             boxShadow: `0 0 0 1px rgba(0,0,0,0.15), 0 4px 20px rgba(0,0,0,0.3)`,
             transition: isDragging ? 'none' : 'left 0.04s ease',
           }}/>

      {/* ── Drag handle ── */}
      <div className="absolute top-1/2 pointer-events-none"
           style={{ left: `${pct}%`, transform: 'translate(-50%,-50%)', transition: isDragging ? 'none' : 'left 0.04s ease' }}>
        <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center"
             style={{
               boxShadow: `0 4px 20px rgba(0,0,0,0.25), 0 0 0 3px ${sliderColor}, 0 0 0 5px rgba(255,255,255,0.8)`,
               transform: isDragging ? 'scale(1.2)' : isHovering ? 'scale(1.08)' : 'scale(1)',
               transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)',
             }}>
          <ArrowLeftRight className="w-4 h-4" style={{ color: sliderColor }}/>
        </div>
      </div>

      {/* ── Labels ── */}
      {showLabels && (
        <>
          <div className="absolute bottom-3 left-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white pointer-events-none"
               style={{
                 background: 'rgba(0,0,0,0.55)',
                 backdropFilter: 'blur(4px)',
                 borderRadius: '5px',
                 opacity: pct < 15 ? 0 : 1,
                 transition: 'opacity 0.3s',
               }}>Before</div>
          <div className="absolute bottom-3 right-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white pointer-events-none"
               style={{
                 background: sliderColor + 'ee',
                 backdropFilter: 'blur(4px)',
                 borderRadius: '5px',
                 opacity: pct > 85 ? 0 : 1,
                 transition: 'opacity 0.3s',
               }}>After</div>
        </>
      )}

      {/* ── Drag hint — fades after first interaction ── */}
      {!hasInteracted && (
        <div className="absolute inset-x-0 bottom-10 flex justify-center pointer-events-none"
             style={{ opacity: isHovering ? 0 : 0.8, transition: 'opacity 0.4s' }}>
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-white"
               style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', borderRadius: '20px' }}>
            <ArrowLeftRight className="w-3 h-3"/>Drag to reveal
          </div>
        </div>
      )}
    </div>
  );
}

// Stack hover-reveal card
function StackRevealCard({ pair, sliderColor, showLabels, style }: {
  pair: any; sliderColor: string; showLabels: boolean; style: StyleConfig;
}) {
  const [revealed, setRevealed] = useState(false);
  const hasBefore = !!pair?.beforeUrl;
  const hasAfter  = !!pair?.afterUrl;
  return (
    <div
      className="relative overflow-hidden cursor-pointer group"
      style={{ borderRadius: br(style), aspectRatio: '4/3' }}
      onClick={() => setRevealed(r => !r)}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
    >
      {/* Before */}
      <div className="absolute inset-0">
        {hasBefore
          ? <img src={pair.beforeUrl} alt="Before" className="w-full h-full object-cover"
                 style={{ transform: revealed ? 'scale(1.04)' : 'scale(1)', transition: 'transform 0.7s cubic-bezier(0.16,1,0.3,1)' }}/>
          : <div className="w-full h-full bg-slate-100 flex items-center justify-center">
              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-300">Before</span>
            </div>}
      </div>

      {/* After — animates in */}
      <div className="absolute inset-0"
           style={{
             clipPath: revealed ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
             transition: 'clip-path 0.65s cubic-bezier(0.16,1,0.3,1)',
           }}>
        {hasAfter
          ? <img src={pair.afterUrl} alt="After" className="w-full h-full object-cover"
                 style={{ transform: revealed ? 'scale(1)' : 'scale(1.04)', transition: 'transform 0.7s cubic-bezier(0.16,1,0.3,1)' }}/>
          : <div className="w-full h-full flex items-center justify-center"
                 style={{ background: ac(style) + '20' }}>
              <span className="text-[11px] font-black uppercase tracking-[0.3em]"
                    style={{ color: ac(style) + 'aa' }}>After</span>
            </div>}
        <div className="absolute inset-0"
             style={{ background: `linear-gradient(to right, ${sliderColor}20 0%, transparent 20%)` }}/>
      </div>

      {/* Labels */}
      {showLabels && (
        <>
          <div className="absolute top-3 left-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white"
               style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', borderRadius: '5px',
                        opacity: revealed ? 0 : 1, transition: 'opacity 0.35s' }}>Before</div>
          <div className="absolute top-3 right-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white"
               style={{ background: sliderColor + 'dd', backdropFilter: 'blur(4px)', borderRadius: '5px',
                        opacity: revealed ? 1 : 0, transition: 'opacity 0.35s 0.2s' }}>After</div>
        </>
      )}

      {/* Hover prompt */}
      <div className="absolute inset-0 flex items-end justify-center pb-5 pointer-events-none"
           style={{ opacity: revealed ? 0 : 1, transition: 'opacity 0.3s' }}>
        <div className="px-4 py-2 rounded-full text-white text-[10px] font-black uppercase tracking-widest"
             style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(8px)' }}>
          Hover to reveal ✦
        </div>
      </div>
    </div>
  );
}

// ─── BEFORE/AFTER SECTION — 4 layouts ─────────────────────────────────────────
function BeforeAfterSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const pairs: any[] = Array.isArray(config.pairs) ? config.pairs : [];
  const layout      = config.layout || 'slider';
  const showLabels  = config.showLabels !== false;
  const sliderColor = config.sliderColor || ac(style);
  const [carouselIdx, setCarouselIdx] = useState(0);

  // Placeholder items for when no pairs uploaded yet
  const displayPairs = pairs.length > 0 ? pairs : [
    { id: 'ph1', beforeUrl: '', afterUrl: '', caption: 'Transformation 1' },
    { id: 'ph2', beforeUrl: '', afterUrl: '', caption: 'Transformation 2' },
  ];

  const SectionHeader = () => (
    <div className="text-center mb-16 space-y-4">
      <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
        as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>
        {config.heading || 'Transformations'}
      </FieldTap>
      {config.subheading && (
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>
          {config.subheading}
        </FieldTap>
      )}
    </div>
  );

  // ── SLIDER layout ────────────────────────────────────────────────────
  if (layout === 'slider') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className={cn('grid gap-8', displayPairs.length === 1 ? 'max-w-2xl mx-auto' : 'md:grid-cols-2')}>
          {displayPairs.map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-3">
              <BeforeAfterSlider pair={pair} sliderColor={sliderColor} showLabels={showLabels} style={style}/>
              {pair.caption && (
                <p className="text-center text-[10px] font-black uppercase tracking-[0.2em]"
                   style={{ color: ac(style) + '80', fontFamily: bf(style) }}>
                  {pair.caption}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── SIDE layout ──────────────────────────────────────────────────────
  if (layout === 'side') return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className="space-y-20">
          {displayPairs.map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:gap-6">
                {[
                  { label: 'Before', url: pair.beforeUrl, isAfter: false },
                  { label: 'After',  url: pair.afterUrl,  isAfter: true  },
                ].map(side => (
                  <div key={side.label}
                       className="group relative overflow-hidden"
                       style={{ borderRadius: br(style), aspectRatio: '3/4' }}>
                    {side.url
                      ? <img src={side.url} alt={side.label}
                             className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                             draggable={false}/>
                      : <div className="w-full h-full flex items-center justify-center"
                             style={{ background: side.isAfter ? ac(style) + '14' : '#f1f5f9' }}>
                          <span className="text-[11px] font-black uppercase tracking-[0.25em]"
                                style={{ color: side.isAfter ? ac(style) + 'aa' : '#cbd5e1' }}>
                            {side.label}
                          </span>
                        </div>}

                    {showLabels && (
                      <div className="absolute top-3 left-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white"
                           style={{
                             background: side.isAfter ? sliderColor + 'ee' : 'rgba(0,0,0,0.5)',
                             backdropFilter: 'blur(4px)',
                             borderRadius: '5px',
                           }}>
                        {side.label}
                      </div>
                    )}

                    {/* Hover shimmer */}
                    <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                         style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.07) 0%,transparent 100%)' }}/>

                    {/* Accent border reveal on hover */}
                    <div className="absolute bottom-0 left-0 right-0 h-[3px] scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"
                         style={{ background: side.isAfter ? sliderColor : ac(style) + '40' }}/>
                  </div>
                ))}
              </div>

              {pair.caption && (
                <p className="text-center text-[10px] font-black uppercase tracking-[0.2em]"
                   style={{ color: ac(style) + '80', fontFamily: bf(style) }}>
                  {pair.caption}
                </p>
              )}

              {i < displayPairs.length - 1 && (
                <div className="mt-10 flex items-center gap-4">
                  <div className="flex-1 h-px" style={{ background: ac(style) + '12' }}/>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: ac(style) + '30' }}/>
                  <div className="flex-1 h-px" style={{ background: ac(style) + '12' }}/>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── STACK layout ─────────────────────────────────────────────────────
  if (layout === 'stack') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className={cn('grid gap-6', displayPairs.length === 1 ? 'max-w-2xl mx-auto' : 'md:grid-cols-2')}>
          {displayPairs.map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-3">
              <StackRevealCard pair={pair} sliderColor={sliderColor} showLabels={showLabels} style={style}/>
              {pair.caption && (
                <p className="text-center text-[10px] font-black uppercase tracking-[0.2em]"
                   style={{ color: ac(style) + '80', fontFamily: bf(style) }}>
                  {pair.caption}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── CAROUSEL layout ───────────────────────────────────────────────────
  const current = displayPairs[carouselIdx % displayPairs.length];
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className="space-y-6">
          <BeforeAfterSlider key={carouselIdx} pair={current} sliderColor={sliderColor} showLabels={showLabels} style={style}/>

          {current?.caption && (
            <p className="text-center text-sm font-bold uppercase tracking-widest"
               style={{ color: ac(style) + '70', fontFamily: bf(style) }}>
              {current.caption}
            </p>
          )}

          {displayPairs.length > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setCarouselIdx(i => (i - 1 + displayPairs.length) % displayPairs.length)}
                className="w-10 h-10 rounded-full border-2 flex items-center justify-center hover:shadow-md transition-all"
                style={{ borderColor: ac(style) + '30', color: '#94a3b8' }}>
                <ChevronLeft className="w-4 h-4"/>
              </button>

              <div className="flex gap-2 items-center">
                {displayPairs.map((_, i) => (
                  <button key={i} onClick={() => setCarouselIdx(i)}
                          className="transition-all duration-300"
                          style={{
                            width: i === carouselIdx % displayPairs.length ? '24px' : '8px',
                            height: '8px',
                            borderRadius: '9999px',
                            background: i === carouselIdx % displayPairs.length ? ac(style) : ac(style) + '28',
                          }}/>
                ))}
              </div>

              <button
                onClick={() => setCarouselIdx(i => (i + 1) % displayPairs.length)}
                className="w-10 h-10 rounded-full border-2 flex items-center justify-center hover:shadow-md transition-all"
                style={{ borderColor: ac(style) + '30', color: '#94a3b8' }}>
                <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MembershipsSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const plans=[1,2,3].map(n=>({ name:config[`plan${n}Name`]||['Essential','Luxe','Elite'][n-1],price:config[`plan${n}Price`]||['$89','$149','$249'][n-1],period:config[`plan${n}Period`]||'/mo',features:(config[`plan${n}Features`]||['2 services/month\nPriority booking\n10% off retail','4 services/month\nVIP priority\n20% off retail\nFree upgrades','Unlimited services\nDedicated artist\n30% off retail\nExclusive events'][n-1]).split('\n').filter(Boolean),featured:n===2?(config.plan2Featured!==undefined?config.plan2Featured:true):false }));
  return (<section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Join the Club'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500" style={{ fontFamily:bf(style) }}>{config.subheading}</p>}</div><div className="grid md:grid-cols-3 gap-6 items-center">{plans.map((plan,i)=><div key={i} className={cn('p-8 space-y-6 hover:shadow-2xl transition-all',plan.featured&&'md:scale-105')} style={{ borderRadius:br(style,1.5),border:`2px solid ${plan.featured?ac(style):ac(style)+'25'}`,background:plan.featured?ac(style):'white' }}><div><p className="text-[10px] font-black uppercase tracking-widest" style={{ color:plan.featured?'rgba(255,255,255,0.65)':ac(style) }}>{plan.name}</p>{config.showBadge&&plan.featured&&<span className="inline-block mt-1 px-2 py-0.5 text-[8px] font-black uppercase text-white bg-white/20 rounded">Most Popular</span>}<div className="flex items-end gap-1 mt-2"><span className="text-4xl font-light" style={{ fontFamily:hf(style),color:plan.featured?'white':'#0f172a' }}>{plan.price}</span><span className="text-sm mb-1" style={{ color:plan.featured?'rgba(255,255,255,0.5)':'#94a3b8',fontFamily:bf(style) }}>{plan.period}</span></div></div><ul className="space-y-2.5">{plan.features.map((f:string,j:number)=><li key={j} className="flex items-center gap-2.5 text-sm" style={{ fontFamily:bf(style),color:plan.featured?'rgba(255,255,255,0.8)':'#64748b' }}><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:plan.featured?'rgba(255,255,255,0.6)':ac(style) }}/>{f}</li>)}</ul><button onClick={cta(config.ctaAction,config.ctaUrl)} className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ background:plan.featured?'white':ac(style),color:plan.featured?ac(style):'white',borderRadius:br(style),fontFamily:bf(style) }}>{config.ctaText||'Join Now'}</button></div>)}</div></div></section>);
}

function PackagesSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const pkgs=[1,2,3].map(n=>({ name:config[`pkg${n}Name`]||['5-Pack','10-Pack','20-Pack'][n-1],sessions:config[`pkg${n}Sessions`]||[5,10,20][n-1],price:config[`pkg${n}Price`]||['$199','$349','$599'][n-1],saving:config[`pkg${n}Saving`]||['Save 15%','Save 25%','Save 35%'][n-1] }));
  return (<section className={py(style)} style={{ background:style.bgColor }}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Prepaid Sessions'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500" style={{ fontFamily:bf(style) }}>{config.subheading}</p>}</div><div className="grid md:grid-cols-3 gap-6">{pkgs.map((pkg,i)=><div key={i} className="p-8 bg-white text-center space-y-5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300" style={{ borderRadius:br(style,1.5),border:`2px solid ${ac(style)}25` }}><p className="text-[10px] font-black uppercase tracking-widest" style={{ color:ac(style) }}>{pkg.name}</p><p className="text-4xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{pkg.price}</p><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>{config.showExpiry!==false&&<p className="text-xs text-slate-400">Valid 12 months</p>}{config.showSavings!==false&&<span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background:ac(style),borderRadius:br(style,2) }}>{pkg.saving}</span>}<button onClick={cta(config.ctaAction,config.ctaUrl)} className="block w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ ...btnStyle(style),fontFamily:bf(style) }}>Purchase</button></div>)}</div></div></section>);
}

function GiftCardsSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const amounts=(config.amounts||'25,50,75,100').split(',').map((a:string)=>a.trim()),hasBg=!!config.bgImage;
  return (<section className={cn(py(style),'relative')} style={{ background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:'#f8fafc' }}>{hasBg&&<div className="absolute inset-0" style={{ background:'rgba(0,0,0,0.45)' }}/>}<div className="relative max-w-2xl mx-auto px-6 md:px-16 text-center space-y-10"><div className="space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:hasBg?'white':'#0f172a' }}>{config.heading||'Give the Gift of Beauty'}</FieldTap>{config.subheading&&<p className="text-base" style={{ fontFamily:bf(style),color:hasBg?'rgba(255,255,255,0.75)':'#64748b' }}>{config.subheading}</p>}</div><div className="p-10 shadow-2xl space-y-8 text-white" style={{ background:`linear-gradient(135deg,${ac(style)} 0%,${ac(style)}cc 100%)`,borderRadius:br(style,2) }}><Gift className="w-12 h-12 mx-auto opacity-80"/><p className="text-lg font-light" style={{ fontFamily:hf(style) }}>Choose an amount</p><div className="flex flex-wrap gap-3 justify-center">{amounts.map((a:string,i:number)=><button key={i} className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{ borderRadius:br(style) }}>${a}</button>)}<button className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{ borderRadius:br(style) }}>Custom</button></div><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-12 py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all" style={{ background:'white',color:ac(style),borderRadius:br(style,3),fontFamily:bf(style) }}>{config.ctaText||'Send a Gift Card'}</button></div></div></section>);
}

// ─── QUOTE SECTION — theme-aware, no hardcoded navy ────────────────────────────
function QuoteSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const rawTags = config.tags;
  const tags: string[] = Array.isArray(rawTags) ? rawTags
    : typeof rawTags === 'string' ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];
  const hasBg  = !!config.bgImage;
  const layout = config.layout || 'centered';
  const accent = ac(style);

  // ── CENTERED layout ──────────────────────────────────────────────────
  if (layout === 'centered') {
    return (
      <section className={cn(py(style), 'relative overflow-hidden')}
               style={{ background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : accent }}>
        {/* Overlay */}
        {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)' }}/>}
        {!hasBg && <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,rgba(0,0,0,0.14) 0%,rgba(0,0,0,0.32) 100%)' }}/>}

        {/* Decorative dot grid */}
        {!hasBg && (
          <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
               style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '32px 32px' }}/>
        )}

        <div className="relative max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
            as="h2" className="text-4xl md:text-6xl font-light text-white" style={{ fontFamily: hf(style) }}>
            {config.heading || 'Need Something Bigger?'}
          </FieldTap>

          {config.subheading && (
            <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" className="text-lg max-w-2xl mx-auto leading-relaxed"
              style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.72)' }}>
              {config.subheading}
            </FieldTap>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-3 justify-center">
              {tags.map((tag: string, i: number) => (
                <span key={i}
                      className="px-5 py-2.5 border text-[11px] font-black uppercase tracking-widest text-white/75 border-white/22 hover:bg-white/10 hover:text-white transition-all cursor-default"
                      style={{ borderRadius: br(style, 3) }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
            <button
              onClick={cta(config.ctaAction, config.ctaUrl)}
              className="inline-flex items-center gap-2.5 px-12 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] active:scale-[0.98] transition-all"
              style={{
                background: 'white',
                color: accent,
                borderRadius: br(style),
                fontFamily: bf(style),
                boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
              }}>
              {config.ctaText || 'Request a Quote'}
              <ArrowRight className="w-4 h-4"/>
            </button>
          </FieldTap>
        </div>
      </section>
    );
  }

  // ── SPLIT layout ─────────────────────────────────────────────────────
  if (layout === 'split') {
    return (
      <section className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">

            {/* Left: text */}
            <div className="space-y-8">
              <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>
                {config.heading || 'Need Something Bigger?'}
              </FieldTap>

              <div className="w-14 h-[2px]" style={{ background: accent }}/>

              {config.subheading && (
                <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="p" className="text-base leading-relaxed text-slate-500" style={{ fontFamily: bf(style) }}>
                  {config.subheading}
                </FieldTap>
              )}

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2.5">
                  {tags.map((tag: string, i: number) => (
                    <span key={i}
                          className="px-4 py-2 text-[10px] font-black uppercase tracking-widest"
                          style={{
                            background: accent + '0f',
                            color: accent,
                            borderRadius: br(style, 2),
                            border: `1.5px solid ${accent}22`,
                          }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
                <button
                  onClick={cta(config.ctaAction, config.ctaUrl)}
                  className="inline-flex items-center gap-2.5 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                  {config.ctaText || 'Request a Quote'}
                  <ArrowRight className="w-4 h-4"/>
                </button>
              </FieldTap>
            </div>

            {/* Right: visual panel */}
            <div className="hidden md:block">
              {hasBg ? (
                <div className="w-full aspect-[4/5] overflow-hidden shadow-2xl"
                     style={{ borderRadius: br(style, 2) }}>
                  <img src={config.bgImage} alt="" className="w-full h-full object-cover"/>
                </div>
              ) : (
                <div className="w-full aspect-[4/5] relative overflow-hidden flex items-center justify-center"
                     style={{ background: accent + '08', borderRadius: br(style, 2), border: `2px solid ${accent}15` }}>
                  {/* Dot grid */}
                  <div className="absolute inset-0"
                       style={{ backgroundImage: `radial-gradient(${accent}30 1.5px, transparent 1.5px)`, backgroundSize: '22px 22px' }}/>

                  {/* Floating tag bubbles */}
                  <div className="relative flex flex-col gap-4 items-center p-8 w-full">
                    {(tags.length > 0 ? tags.slice(0, 4) : ['Bridal Parties','Corporate Events','Destination']).map((tag, i) => (
                      <div key={i}
                           className="px-7 py-4 text-sm font-black uppercase tracking-widest text-white shadow-2xl w-full text-center"
                           style={{
                             background: accent,
                             borderRadius: br(style, 2),
                             transform: `rotate(${([-1.5, 1, -0.8, 1.4][i] || 0)}deg) translateX(${([8,-6,4,-5][i] || 0)}px)`,
                             boxShadow: `0 12px 36px ${accent}40`,
                           }}>
                        {tag}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ── BANNER layout ────────────────────────────────────────────────────
  return (
    <section className="relative overflow-hidden"
             style={{ background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : accent }}>
      {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)' }}/>}
      {!hasBg && <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,rgba(0,0,0,0.12) 0%,rgba(0,0,0,0.28) 100%)' }}/>}
      {!hasBg && (
        <div className="absolute inset-0 opacity-[0.06]"
             style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)', backgroundSize: '28px 28px' }}/>
      )}

      <div className="relative max-w-6xl mx-auto px-6 md:px-16 py-16 md:py-20">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-14">
          <div className="space-y-4 text-center md:text-left flex-1">
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="text-3xl md:text-4xl font-light text-white" style={{ fontFamily: hf(style) }}>
              {config.heading || 'Need Something Bigger?'}
            </FieldTap>

            {config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-base max-w-lg leading-relaxed"
                style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.68)' }}>
                {config.subheading}
              </FieldTap>
            )}

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                {tags.map((tag: string, i: number) => (
                  <span key={i}
                        className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white/65 border border-white/20"
                        style={{ borderRadius: br(style, 2) }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
            <button
              onClick={cta(config.ctaAction, config.ctaUrl)}
              className="shrink-0 inline-flex items-center gap-2.5 px-10 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] active:scale-[0.98] transition-all"
              style={{
                background: 'white',
                color: accent,
                borderRadius: br(style),
                fontFamily: bf(style),
                boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
              }}>
              {config.ctaText || 'Request a Quote'}
              <ArrowRight className="w-4 h-4"/>
            </button>
          </FieldTap>
        </div>
      </div>
    </section>
  );
}

function NewClientSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const hasBg=!!config.bgImage;
  return (<section className={cn(py(style),'relative')} style={{ background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:ac(style)+'0e' }}>{hasBg&&<div className="absolute inset-0" style={{ background:'rgba(0,0,0,0.55)' }}/>}<div className="relative max-w-5xl mx-auto px-6 md:px-16"><div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12" style={{ borderRadius:br(style,2),border:`2px solid ${hasBg?'rgba(255,255,255,0.2)':ac(style)+'28'}` }}><div className={cn('text-center md:text-left space-y-3',hasBg&&'text-white')}><div className="flex items-center gap-2 justify-center md:justify-start"><Sparkles className="w-4 h-4" style={{ color:hasBg?'white':ac(style) }}/><p className="text-[11px] font-black uppercase tracking-widest" style={{ color:hasBg?'rgba(255,255,255,0.7)':ac(style) }}>First Visit</p></div><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-4xl font-light" style={{ fontFamily:hf(style),color:hasBg?'white':'#0f172a' }}>{config.heading||'First Visit Special'}</FieldTap>{config.offerText&&<FieldTap sectionId={sectionId} fieldKey="offerText" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-xl font-black" style={{ color:hasBg?'rgba(255,255,255,0.9)':ac(style),fontFamily:bf(style) }}>{config.offerText}</FieldTap>}{config.expiryText&&<p className="text-xs font-bold uppercase tracking-widest" style={{ color:hasBg?'rgba(255,255,255,0.5)':'#94a3b8' }}>{config.expiryText}</p>}{config.finePrint&&<p className="text-xs" style={{ color:hasBg?'rgba(255,255,255,0.4)':'#94a3b8' }}>{config.finePrint}</p>}</div><FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"><button onClick={cta(config.ctaAction,config.ctaUrl)} className="shrink-0 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{ ...btnStyle(style),fontFamily:bf(style) }}>{config.ctaText||'Claim Offer'}</button></FieldTap></div></div></section>);
}

function FAQSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [open,setOpen]=React.useState<number|null>(null),layout=config.layout||'accordion';
  const items=[1,2,3,4,5,6].map(n=>({ q:config[`q${n}`],a:config[`a${n}`] })).filter(i=>i.q&&i.a);
  const H=()=><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-14" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Common Questions'}</FieldTap>;
  if (layout==='two-col') return <section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-5xl mx-auto px-6 md:px-16"><H/><div className="grid md:grid-cols-2 gap-6">{items.map((item,i)=><div key={i} className="p-6 bg-white space-y-2" style={{ borderRadius:br(style),border:`2px solid ${ac(style)}20` }}><p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily:bf(style) }}>{item.q}</p><p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily:bf(style) }}>{item.a}</p></div>)}</div></div></section>;
  if (layout==='minimal') return <section className={py(style)} style={{ background:style.bgColor }}><div className="max-w-3xl mx-auto px-6 md:px-16"><H/><div className="space-y-6">{items.map((item,i)=><div key={i} className="border-b pb-6" style={{ borderColor:ac(style)+'18' }}><p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2" style={{ fontFamily:bf(style) }}>{item.q}</p><p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily:bf(style) }}>{item.a}</p></div>)}</div></div></section>;
  return <section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-3xl mx-auto px-6 md:px-16"><H/><div className="space-y-2">{items.map((item,i)=><div key={i} className="overflow-hidden bg-white" style={{ borderRadius:br(style),border:`2px solid ${ac(style)}22` }}><button onClick={()=>setOpen(open===i?null:i)} className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors"><span className="font-black text-sm uppercase tracking-tight text-slate-900 pr-4" style={{ fontFamily:bf(style) }}>{item.q}</span>{open===i?<ChevronUp className="w-4 h-4 shrink-0" style={{ color:ac(style) }}/>:<ChevronDown className="w-4 h-4 shrink-0 text-slate-300"/>}</button>{open===i&&<div className="px-6 pb-6 text-sm text-slate-500 leading-relaxed" style={{ fontFamily:bf(style) }}>{item.a}</div>}</div>)}</div></div></section>;
}

function PoliciesSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const policyItems:any[]=Array.isArray(config.policies)?config.policies:[],layout=config.layout||'cards';
  const ie:Record<string,string>={ shield:'🛡','shield-check':'✅',clock:'🕐',clock3:'⏰',alert:'⚠️',ban:'🚫',credit:'💳',heart:'❤️',badge:'🏅',info:'ℹ️',zap:'⚡',leaf:'🌿',coffee:'☕',flame:'🔥',phone:'📞',mail:'✉️' };
  return (<section className={py(style)} style={{ background:style.bgColor }}><div className="max-w-5xl mx-auto px-6 md:px-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-4" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Our Policies'}</FieldTap>{config.subheading?<p className="text-base text-slate-500 text-center mb-14" style={{ fontFamily:bf(style) }}>{config.subheading}</p>:<div className="mb-14"/>}{policyItems.length>0?(layout==='list'?(<div className="max-w-2xl mx-auto space-y-5">{policyItems.map((p:any,i:number)=><div key={p.id||i} className="flex items-start gap-4 py-4 border-b" style={{ borderColor:ac(style)+'18' }}><span className="text-xl shrink-0 mt-0.5">{ie[p.icon]||'🛡'}</span><div><p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-1" style={{ fontFamily:bf(style) }}>{p.title}</p><p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily:bf(style) }}>{p.body}</p></div></div>)}</div>):(<div className="grid md:grid-cols-3 gap-6">{policyItems.map((p:any,i:number)=><div key={p.id||i} className="p-7 bg-white space-y-3" style={{ borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22` }}><div className="flex items-center gap-2.5"><span className="text-xl">{ie[p.icon]||'🛡'}</span><p className="text-[11px] font-black uppercase tracking-widest" style={{ color:ac(style) }}>{p.title}</p></div><p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily:bf(style) }}>{p.body}</p></div>)}</div>)):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-12">No policies configured yet</p>}</div></section>);
}

function ContactSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const tenant=data.tenant,socialLinks:any[]=Array.isArray(config.socialLinks)?config.socialLinks:[],layout=config.layout||'split-map';
  const Info=()=>(
    <div className="space-y-7">
      {config.showHours!==false&&config.customHours&&<div className="space-y-2.5"><div className="flex items-center gap-2"><Clock className="w-4 h-4" style={{ color:ac(style) }}/><p className="text-[11px] font-black uppercase tracking-widest" style={{ color:ac(style) }}>Hours</p></div><p className="text-sm text-slate-500 leading-relaxed whitespace-pre-line" style={{ fontFamily:bf(style) }}>{config.customHours}</p></div>}
      {tenant?.studioAddress&&<div className="space-y-2.5"><div className="flex items-center gap-2"><MapPin className="w-4 h-4" style={{ color:ac(style) }}/><p className="text-[11px] font-black uppercase tracking-widest" style={{ color:ac(style) }}>Location</p></div><p className="text-sm text-slate-500" style={{ fontFamily:bf(style) }}>{tenant.studioAddress}</p></div>}
      {config.showPhone!==false&&tenant?.phone&&<div className="flex items-center gap-3"><Phone className="w-4 h-4" style={{ color:ac(style) }}/><a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.phone}</a></div>}
      {config.showEmail!==false&&tenant?.email&&<div className="flex items-center gap-3"><Mail className="w-4 h-4" style={{ color:ac(style) }}/><a href={`mailto:${tenant.email}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.email}</a></div>}
      {config.showSocial!==false&&socialLinks.length>0&&<div className="flex gap-3 flex-wrap">{socialLinks.map((link:any)=><a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors border rounded-full" style={{ borderColor:ac(style)+'30' }}>{link.platform}</a>)}</div>}
      {config.showSocial!==false&&tenant?.instagramHandle&&<div className="flex items-center gap-3"><Instagram className="w-4 h-4" style={{ color:ac(style) }}/><a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">@{tenant.instagramHandle}</a></div>}
      {config.ctaText&&<button onClick={cta(config.ctaAction,config.ctaUrl)} className="mt-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 hover:scale-[1.02] transition-all" style={{ ...btnStyle(style),fontFamily:bf(style) }}>{config.ctaText}</button>}
    </div>
  );
  const Map=()=>tenant?.studioLocation?(<div className="overflow-hidden shadow-xl" style={{ height:'280px',borderRadius:br(style,1.5) }}><iframe src={`https://maps.google.com/maps?q=${tenant.studioLocation.lat},${tenant.studioLocation.lng}&z=15&output=embed`} className="w-full h-full border-0" loading="lazy" title="Studio location"/></div>):null;
  return (<section id="contact" className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-5xl mx-auto px-6 md:px-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-16" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Find Us'}</FieldTap>{layout==='stacked'?(<div className="space-y-10 max-w-2xl mx-auto">{config.showMap!==false&&<Map/>}<Info/></div>):(<div className="grid md:grid-cols-2 gap-14 items-start"><Info/>{config.showMap!==false&&<Map/>}</div>)}</div></section>);
}

function EventsSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const events=data.events;
  return (<section className={py(style)} style={{ background:style.bgColor }}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Upcoming Events'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500" style={{ fontFamily:bf(style) }}>{config.subheading}</p>}</div>{events.length>0?(<div className="space-y-4">{events.map((event:any)=>{const d=event.date?new Date(event.date?.toDate?.()??event.date):null;return(<div key={event.id} className="flex items-center gap-6 p-6 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all" style={{ borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22` }}>{d&&<div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-white" style={{ background:ac(style),borderRadius:br(style) }}><span className="text-[9px] font-black uppercase">{d.toLocaleString('default',{month:'short'})}</span><span className="text-xl font-black leading-none">{d.getDate()}</span></div>}<div className="flex-1 min-w-0"><p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{ fontFamily:bf(style) }}>{event.title||event.name}</p>{event.description&&<p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}</div><button onClick={cta(config.ctaAction,config.ctaUrl)} className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest" style={{ ...btnStyle(style),fontFamily:bf(style) }}>{config.ctaText||'RSVP'}</button></div>);})}</div>):(<div className="text-center py-16 space-y-4"><Calendar className="w-12 h-12 mx-auto text-slate-200"/><p className="text-[11px] font-black uppercase tracking-widest text-slate-300">{config.emptyText||'Check back soon!'}</p></div>)}</div></section>);
}

function ReferralSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  return (<section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12"><div className="space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Refer a Friend'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily:bf(style) }}>{config.subheading}</p>}</div><div className="grid grid-cols-2 gap-5 max-w-md mx-auto">{[{l:'You get',v:config.rewardYou,k:'rewardYou'},{l:'Friend gets',v:config.rewardFriend,k:'rewardFriend'}].map((item,i)=><div key={i} className="p-6 bg-white space-y-2" style={{ borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22` }}><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.l}</p><FieldTap sectionId={sectionId} fieldKey={item.k} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-2xl font-black" style={{ fontFamily:hf(style),color:ac(style) }}>{item.v}</FieldTap></div>)}</div><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{ ...btnStyle(style),fontFamily:bf(style) }}>{config.ctaText||'Get My Referral Link'}</button></div></section>);
}

function StorySection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const hasImage=!!config.image;
  return (<section className={py(style)} style={{ background:style.bgColor }}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className={cn('grid gap-14 items-center',hasImage?'md:grid-cols-2':'max-w-2xl mx-auto')}><div className="space-y-8"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Our Story'}</FieldTap><div className="w-12 h-px" style={{ background:ac(style) }}/>{config.pullQuote&&<FieldTap sectionId={sectionId} fieldKey="pullQuote" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-2xl font-light italic" style={{ fontFamily:hf(style),color:ac(style) }}>"{config.pullQuote}"</FieldTap>}<FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 leading-relaxed" style={{ fontFamily:bf(style) }}>{config.body}</FieldTap>{config.ctaText&&<button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btnStyle(style,'secondary'),fontFamily:bf(style) }}>{config.ctaText}</button>}</div>{hasImage&&<img src={config.image} alt="Our Story" className="w-full aspect-square object-cover shadow-2xl" style={{ borderRadius:br(style,2) }}/>}</div></div></section>);
}

function InstagramSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const uploaded:any[]=Array.isArray(config.images)?config.images:[],layout=config.layout||'grid',cols=parseInt(config.columns)||4;
  const gridCls=cols===3?'grid-cols-3':cols===6?'grid-cols-3 md:grid-cols-6':'grid-cols-2 md:grid-cols-4';
  const shades=['10','14','18','12','16','1a'],imgs=uploaded.length>0?uploaded.slice(0,8):shades.map((s,i)=>({ id:i,url:null,shade:s }));
  const Head=()=><div className="space-y-3"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily:hf(style),color:'#0f172a' }}>{config.heading||'Follow Along'}</FieldTap><FieldTap sectionId={sectionId} fieldKey="handle" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-400">{config.handle||'@studio'}</FieldTap></div>;
  if (layout==='banner') return (<section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-6xl mx-auto px-6 md:px-16 text-center space-y-10"><Head/><div className="flex gap-3 overflow-x-auto snap-x pb-2" style={{ scrollbarWidth:'none' }}>{[...imgs,...imgs].map((item:any,i:number)=><div key={i} className="shrink-0 snap-start w-48 h-48 overflow-hidden rounded-xl group">{item.url?<img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>:<div className="w-full h-full" style={{ background:ac(style)+item.shade }}/>}</div>)}</div><a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btnStyle(style,'secondary'),fontFamily:bf(style) }}><Instagram className="w-4 h-4"/>{config.ctaText||'Follow us'}</a></div></section>);
  return (<section className={py(style)} style={{ background:'#f8fafc' }}><div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12"><Head/><div className={`grid ${gridCls} gap-2`}>{imgs.map((item:any,i:number)=><div key={i} className="aspect-square overflow-hidden group" style={{ borderRadius:br(style) }}>{item.url?<img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>:<div className="w-full h-full" style={{ background:ac(style)+item.shade }}/>}</div>)}</div><a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btnStyle(style,'secondary'),fontFamily:bf(style) }}><Instagram className="w-4 h-4"/>{config.ctaText||'Follow us on Instagram'}</a></div></section>);
}

function WaitlistSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const hasBg=!!config.bgImage;
  return (<section className={cn(py(style),'relative')} style={{ background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:style.bgColor }}>{hasBg&&<div className="absolute inset-0" style={{ background:'rgba(0,0,0,0.55)' }}/>}<div className="relative max-w-lg mx-auto px-6 md:px-16 text-center space-y-8"><div className="space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-5xl font-light" style={{ fontFamily:hf(style),color:hasBg?'white':'#0f172a' }}>{config.heading||'Fully Booked?'}</FieldTap>{config.subheading&&<p className="text-base" style={{ fontFamily:bf(style),color:hasBg?'rgba(255,255,255,0.75)':'#64748b' }}>{config.subheading}</p>}</div><div className="flex gap-2"><input type="email" placeholder="your@email.com" className="flex-1 px-4 py-3 text-sm focus:outline-none" style={{ borderRadius:br(style),border:`2px solid ${hasBg?'rgba(255,255,255,0.3)':ac(style)+'40'}`,fontFamily:bf(style),background:hasBg?'rgba(255,255,255,0.1)':'white',color:hasBg?'white':'inherit' }}/><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-6 py-3 font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all" style={{ ...btnStyle(style),fontFamily:bf(style) }}>{config.ctaText||'Join'}</button></div></div></section>);
}

function Footer({ tenant, style }: { tenant: any; style: StyleConfig }) {
  return (
    <footer className="py-8 border-t text-center" style={{ borderColor: ac(style)+'20' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>
        {tenant?.name||'Studio'} · Powered by ClarityFlow
      </p>
    </footer>
  );
}

function SectionRenderer(p: { section: PageSection; style: StyleConfig; data: PageData; isPreview: boolean; onFieldTap: (s:string,f:string)=>void }) {
  const { section, style, data, isPreview, onFieldTap } = p;
  const sp: SectionProps = { config: section.config, style, data, isPreview, sectionId: section.id, onFieldTap };
  switch (section.type) {
    case 'nav':         return <NavSection         {...sp}/>;
    case 'hero':        return <HeroSection        {...sp}/>;
    case 'trust':       return <TrustSection       {...sp}/>;
    case 'services':    return <ServicesSection    {...sp}/>;
    case 'team':        return <TeamSection        {...sp}/>;
    case 'reviews':     return <ReviewsSection     {...sp}/>;
    case 'gallery':     return <GallerySection     {...sp}/>;
    case 'beforeafter': return <BeforeAfterSection {...sp}/>;
    case 'memberships': return <MembershipsSection {...sp}/>;
    case 'packages':    return <PackagesSection    {...sp}/>;
    case 'giftcards':   return <GiftCardsSection   {...sp}/>;
    case 'quote':       return <QuoteSection       {...sp}/>;
    case 'newclient':   return <NewClientSection   {...sp}/>;
    case 'faq':         return <FAQSection         {...sp}/>;
    case 'policies':    return <PoliciesSection    {...sp}/>;
    case 'contact':     return <ContactSection     {...sp}/>;
    case 'events':      return <EventsSection      {...sp}/>;
    case 'referral':    return <ReferralSection    {...sp}/>;
    case 'story':       return <StorySection       {...sp}/>;
    case 'instagram':   return <InstagramSection   {...sp}/>;
    case 'waitlist':    return <WaitlistSection    {...sp}/>;
    default:            return null;
  }
}


// ─── Exports ──────────────────────────────────────────────────────────────────
export type { StyleConfig, SectionProps, PageData };
export {
  STACKS, GFONTS, ANIM_CSS, DS,
  ac, hf, bf, br, py, btnStyle, hexToHsl, openBooking, cta, injectFonts,
  ANIM_MAP, useInView,
  FieldTap, EditOverlay, SectionWrapper,
  isBuilderConfig, buildDefaults,
  SectionRenderer, Footer,
};