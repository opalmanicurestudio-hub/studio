'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type PageSection } from '@/lib/data';
import { cn } from '@/lib/utils';
import {
  Calendar, Clock, Clock3, MapPin, Phone, Mail, Instagram,
  ChevronDown, ChevronUp, Star, Gift, Sparkles, Pencil,
  ChevronLeft, ChevronRight, X as XIcon, ArrowRight, ArrowLeftRight,
  Users, Award, Heart, Scissors, Zap, Crown, Shield, TrendingUp,
  CheckCircle, ThumbsUp, Smile, Coffee, Menu, BookOpen,
  LayoutDashboard, HelpCircle, Package, Camera,
  ShieldCheck, BadgeCheck, AlertTriangle, Ban, CreditCard, Leaf, Flame, Info,
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
@keyframes cf-hscroll    { from{transform:translateX(0)} to{transform:translateX(-33.333%)} }
@media (hover: hover) {
  .cf-scroll-wrap:hover .cf-scroll-track { animation-play-state:paused !important; }
}
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

const SECTION_LABEL_MAP: Record<string, string> = {
  hero: 'Home', services: 'Services', team: 'Team', gallery: 'Gallery',
  reviews: 'Reviews', contact: 'Contact', story: 'About', events: 'Events',
  faq: 'FAQ', beforeafter: 'Gallery', memberships: 'Memberships',
  packages: 'Packages', giftcards: 'Gift Cards', instagram: 'Insta',
  trust: 'Trust', quote: 'Quote', newclient: 'Offers', referral: 'Refer',
  waitlist: 'Waitlist', policies: 'Policies',
};

const SECTION_ICON_MAP: Record<string, React.ElementType> = {
  hero: BookOpen, services: Scissors, team: Users, gallery: LayoutDashboard,
  reviews: Star, contact: MapPin, story: BookOpen, events: Calendar,
  faq: HelpCircle, beforeafter: LayoutDashboard, memberships: Crown,
  packages: Package, giftcards: Gift, instagram: Camera,
  quote: Mail, newclient: Sparkles, referral: Users, waitlist: Clock,
};

// ─── NavSection ────────────────────────────────────────────────────────────────
function NavSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'centered';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled]     = useState(false);

  useEffect(() => {
    if (!config.transparent || isPreview) return;
    const handler = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, [config.transparent, isPreview]);

  const isDark =
    config.navTheme === 'dark' ||
    (config.transparent && !scrolled && config.navTheme !== 'light');

  const resolveLogoSrc = (): string | null => {
    if (isDark  && config.logoLightUrl) return config.logoLightUrl;
    if (!isDark && config.logoDarkUrl)  return config.logoDarkUrl;
    return config.logoUrl || null;
  };

  const logoFilter = (): string =>
    isDark && !config.logoLightUrl && config.logoUrl ? 'brightness(0) invert(1)' : 'none';

  const navBg = (): string => {
    const custom = config.navBgColor as string | undefined;
    if (custom) return custom;
    if (!config.transparent) return 'rgba(255,255,255,0.95)';
    if (scrolled)             return 'rgba(255,255,255,0.97)';
    return 'transparent';
  };

  const navBorderColor = (): string => {
    if (config.navBgColor) return 'transparent';
    if (!config.transparent || scrolled) return ac(style) + '18';
    return 'transparent';
  };

  const textColor  = isDark ? 'rgba(255,255,255,0.92)' : '#0f172a';
  const mutedColor = isDark ? 'rgba(255,255,255,0.58)' : '#64748b';
  const logoMaxH   = parseInt(config.logoMaxHeight || '40');
  const logoSrc    = resolveLogoSrc();
  const navTransition = 'background 0.35s ease, border-color 0.35s ease, backdrop-filter 0.35s ease';
  const navZ: React.CSSProperties = { zIndex: 100, isolation: 'isolate' };

  const rawEnabledSections = config._enabledSections as string[] | undefined;

  const navLinks: string[] = (config.navLinks as string[] | undefined)?.length
    ? (config.navLinks as string[])
    : rawEnabledSections
        ?.filter(t => t !== 'nav' && t !== 'trust' && t !== 'waitlist' && SECTION_LABEL_MAP[t])
        .map(t => SECTION_LABEL_MAP[t])
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 6)
      ?? ['Services', 'Team', 'Gallery', 'Reviews', 'Contact'];

  const labelToType = useMemo(() => {
    const map: Record<string, string> = {};
    rawEnabledSections?.forEach(t => { if (SECTION_LABEL_MAP[t]) map[SECTION_LABEL_MAP[t]] = t; });
    return map;
  }, [rawEnabledSections]);

  const linkHref = (label: string) => {
    const type = labelToType[label];
    return type ? `#${type}` : `#${label.toLowerCase().replace(/\s+/g, '-')}`;
  };

  const solidNavStyle: React.CSSProperties = {
    background:           navBg(),
    borderColor:          navBorderColor(),
    backdropFilter:       !config.navBgColor && (!config.transparent || scrolled) ? 'blur(20px) saturate(1.8)' : 'none',
    WebkitBackdropFilter: !config.navBgColor && (!config.transparent || scrolled) ? 'blur(20px) saturate(1.8)' : 'none',
    transition:           navTransition,
  };

  // ── Logo ───────────────────────────────────────────────────────────────────
  const Logo = () => logoSrc ? (
    <img src={logoSrc} alt={config.logoText || 'Logo'}
      style={{ height: logoMaxH, width: 'auto', maxWidth: 180, objectFit: 'contain',
        filter: logoFilter(), transition: 'filter 0.3s ease', display: 'block' }}/>
  ) : (
    <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
      style={{ fontFamily: hf(style), color: isDark ? 'rgba(255,255,255,0.9)' : ac(style),
        fontSize: '20px', fontWeight: 900, letterSpacing: '-0.05em', transition: 'color 0.3s ease' }}>
      {config.logoText || 'Studio'}
    </FieldTap>
  );

  // ── Desktop links ──────────────────────────────────────────────────────────
  const Links = ({ className = '' }: { className?: string }) =>
    config.showLinks !== false ? (
      <div className={cn('flex items-center gap-6 md:gap-8', className)}>
        {navLinks.map(l => (
          <a key={l} href={linkHref(l)}
            className="text-[11px] font-black uppercase tracking-widest transition-colors flex-shrink-0 hover:opacity-100"
            style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
        ))}
      </div>
    ) : null;

  // ── CTA button ─────────────────────────────────────────────────────────────
  const Cta = ({ size = 'default', className = '' }: { size?: 'default' | 'sm'; className?: string }) => (
    <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
      <button onClick={cta(config.ctaAction, config.ctaUrl)}
        className={cn('font-black uppercase tracking-widest hover:opacity-90 transition-all active:scale-95 whitespace-nowrap', className,
          size === 'sm' ? 'px-4 py-2 text-[10px]' : 'px-6 py-2.5 text-[11px]')}
        style={{
          ...(isDark ? { background: 'rgba(255,255,255,0.15)', color: 'white',
              border: '1.5px solid rgba(255,255,255,0.35)',
              borderRadius: style.buttonStyle === 'pill' ? '999px' : br(style, 0.6) }
            : { ...btnStyle(style) }),
          fontFamily: bf(style),
        }}>
        {config.ctaText || 'Book Now'}
      </button>
    </FieldTap>
  );

  // ── Hamburger button ───────────────────────────────────────────────────────
  // Thinner lines, no border-radius on lines, subtler pill background.
// ─────────────────────────────────────────────────────────────────────────────
 
  const HamburgerBtn = ({ className = '' }: { className?: string }) => {
    const iconStyle = (config.drawerIconStyle as string) || 'hamburger';
    const pillBg    = isDark ? 'rgba(255,255,255,0.10)' : `${ac(style)}08`;
    const iconColor = isDark ? '#ffffff' : '#111827';
 
    return (
      <button
        onClick={() => setDrawerOpen(true)}
        className={cn(
          'w-10 h-10 flex items-center justify-center rounded-xl transition-all active:scale-95',
          className
        )}
        style={{ background: pillBg }}
        aria-label="Open menu">
 
        {/* hamburger — 3 thin lines, middle shorter */}
        {(!iconStyle || iconStyle === 'hamburger') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ display: 'block', width: 20, height: 1.5, background: iconColor }}/>
            <span style={{ display: 'block', width: 13, height: 1.5, background: iconColor }}/>
            <span style={{ display: 'block', width: 20, height: 1.5, background: iconColor }}/>
          </div>
        )}
 
        {/* minimal — 2 equal thin lines */}
        {iconStyle === 'minimal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'block', width: 20, height: 1.5, background: iconColor }}/>
            <span style={{ display: 'block', width: 20, height: 1.5, background: iconColor }}/>
          </div>
        )}
 
        {/* bold — 3 slightly thicker rounded lines */}
        {iconStyle === 'bold' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ display: 'block', width: 20, height: 2.5, borderRadius: 2, background: iconColor }}/>
            <span style={{ display: 'block', width: 20, height: 2.5, borderRadius: 2, background: iconColor }}/>
            <span style={{ display: 'block', width: 20, height: 2.5, borderRadius: 2, background: iconColor }}/>
          </div>
        )}
 
        {/* dots — 3 small circles */}
        {iconStyle === 'dots' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {[0,1,2].map(i => (
              <span key={i} style={{ display: 'block', width: 4, height: 4, borderRadius: '50%', background: iconColor }}/>
            ))}
          </div>
        )}
 
        {/* grid — 2×2 small squares */}
        {iconStyle === 'grid' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {[0,1,2,3].map(i => (
              <span key={i} style={{ display: 'block', width: 6, height: 6, borderRadius: 1, background: iconColor }}/>
            ))}
          </div>
        )}
      </button>
    );
  };
 

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const Drawer = () => !drawerOpen ? null : (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" style={{ zIndex: 200 }}
        onClick={() => setDrawerOpen(false)}/>
      <div className="fixed inset-y-0 right-0 flex flex-col bg-white"
        style={{ zIndex: 201, width: '100%', maxWidth: '360px',
          boxShadow: '-20px 0 80px rgba(0,0,0,0.20)',
          animation: 'cf-slide-right 0.32s cubic-bezier(0.16,1,0.3,1) both' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 shrink-0"
          style={{ borderBottom: `1.5px solid ${ac(style)}10` }}>
          {config.logoDarkUrl || config.logoUrl
            ? <img src={config.logoDarkUrl || config.logoUrl} alt={config.logoText || 'Logo'}
                style={{ height: Math.min(logoMaxH, 40), width: 'auto', maxWidth: 160, objectFit: 'contain' }}/>
            : <span style={{ fontFamily: hf(style), color: ac(style), fontSize: '18px', fontWeight: 900, letterSpacing: '-0.04em' }}>
                {config.logoText || 'Studio'}
              </span>}
          <button onClick={() => setDrawerOpen(false)}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
            style={{ background: `${ac(style)}0e`, border: `1.5px solid ${ac(style)}18` }}>
            <XIcon className="w-4 h-4" style={{ color: ac(style) }}/>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-4 py-3">
            {navLinks.map((link, i) => (
              <a key={link} href={linkHref(link)} onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-between py-4 px-3 -mx-1 rounded-xl border-b last:border-0 group transition-all active:scale-[0.99]"
                style={{ borderColor: `${ac(style)}08`, animation: `cf-fade-up 0.32s ${i * 0.04}s both` }}>
                <span className="text-base font-black uppercase tracking-tight"
                  style={{ fontFamily: hf(style), color: '#0f172a' }}>{link}</span>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  style={{ background: `${ac(style)}12` }}>
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: ac(style) }}/>
                </div>
              </a>
            ))}
          </div>

          {/* Extra sections */}
          {rawEnabledSections && rawEnabledSections.filter(t => t !== 'nav').length > navLinks.length && (
            <div className="px-4 py-4" style={{ borderTop: `1px solid ${ac(style)}08` }}>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-3 px-3"
                style={{ color: `${ac(style)}70`, fontFamily: bf(style) }}>More</p>
              <div className="flex flex-wrap gap-1.5">
                {rawEnabledSections
                  .filter(t => t !== 'nav' && SECTION_LABEL_MAP[t] && !navLinks.includes(SECTION_LABEL_MAP[t]))
                  .map((t, i) => {
                    const SIcon = SECTION_ICON_MAP[t];
                    return (
                      <a key={t} href={`#${t}`} onClick={() => setDrawerOpen(false)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all active:scale-95"
                        style={{ borderColor: `${ac(style)}18`, background: `${ac(style)}06`,
                          animation: `cf-fade-up 0.28s ${i * 0.03}s both` }}>
                        {SIcon && <SIcon className="w-3 h-3" style={{ color: ac(style) }}/>}
                        <span className="text-[11px] font-black uppercase tracking-widest"
                          style={{ color: ac(style), fontFamily: bf(style) }}>
                          {SECTION_LABEL_MAP[t]}
                        </span>
                      </a>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Quick book */}
          {config.showQuickBook !== false && data.services.length > 0 && (
            <div className="px-4 py-4" style={{ borderTop: `1px solid ${ac(style)}08` }}>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-3 px-3"
                style={{ color: ac(style), fontFamily: bf(style) }}>Quick Book</p>
              <div className="space-y-0.5">
                {data.services.slice(0, parseInt(config.quickBookLimit || '6')).map((svc: any) => (
                  <button key={svc.id} onClick={() => { openBooking(svc); setDrawerOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors text-left group"
                    style={{ WebkitTapHighlightColor: 'transparent' }}>
                    <span className="text-sm font-bold text-slate-700 truncate" style={{ fontFamily: bf(style) }}>
                      {svc.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {svc.price && (
                        <span className="text-sm font-black" style={{ color: ac(style), fontFamily: hf(style) }}>
                          ${svc.price}
                        </span>
                      )}
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                        style={{ background: `${ac(style)}10` }}>
                        <ArrowRight className="w-3 h-3" style={{ color: ac(style) }}/>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Book CTA */}
        <div className="px-5 shrink-0"
          style={{ borderTop: `1.5px solid ${ac(style)}10`,
            paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))', paddingTop: '16px' }}>
          <button
            onClick={() => { cta(config.ctaAction, config.ctaUrl)({ stopPropagation: () => {} } as any); setDrawerOpen(false); }}
            className="w-full py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all whitespace-nowrap"
            style={{ ...btnStyle(style), fontFamily: bf(style), borderRadius: `${Math.min((style.borderRadius || 4), 16)}px` }}>
            {config.ctaText || 'Book Now'}
          </button>
          {data.tenant?.phone && (
            <a href={`tel:${data.tenant.phone}`}
              className="block w-full py-3 text-center text-[11px] font-black uppercase tracking-widest"
              style={{ color: `${ac(style)}60`, fontFamily: bf(style) }}>
              {data.tenant.phone}
            </a>
          )}
        </div>
      </div>
    </>
  );

  // ── floating pill ──────────────────────────────────────────────────────────
  if (layout === 'floating') return (
    <>
      <div className={cn('flex justify-center px-4 pt-3', config.sticky !== false && 'sticky top-3')} style={navZ}>
        <nav className="flex items-center gap-3 md:gap-4 px-4 md:px-6 py-2.5 md:py-3 w-full max-w-2xl"
          style={{ background: config.transparent && !scrolled ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: '999px', border: '1.5px solid rgba(0,0,0,0.07)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.10)', transition: navTransition }}>
          <Logo/>
          {config.showLinks !== false && (
            <div className="flex items-center gap-6 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {navLinks.map(l => (
                <a key={l} href={linkHref(l)} className="text-[11px] font-black uppercase tracking-widest flex-shrink-0"
                  style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Cta size="sm" className="hidden md:inline-flex"/>
            <HamburgerBtn className="md:hidden"/>
          </div>
        </nav>
      </div>
      <Drawer/>
    </>
  );

  // ── bold ───────────────────────────────────────────────────────────────────
  if (layout === 'bold') return (
    <>
      <nav className={cn('w-full border-b', config.sticky !== false && 'sticky top-0')} style={{ ...navZ, ...solidNavStyle }}>
        <div className="flex flex-col items-center gap-1 py-4 px-6">
          <Logo/>
          <div className="flex items-center gap-4 md:gap-6 flex-wrap justify-center mt-1">
            <Links className="hidden md:flex"/>
            <Cta size="sm"/>
            <HamburgerBtn className="md:hidden"/>
          </div>
        </div>
      </nav>
      <Drawer/>
    </>
  );

  // ── split ──────────────────────────────────────────────────────────────────
  if (layout === 'split') return (
    <>
      <nav className={cn('grid grid-cols-3 items-center px-8 py-4 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <div className="hidden md:flex items-center gap-6 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {navLinks.slice(0, 3).map(l => (
            <a key={l} href={linkHref(l)} className="text-[11px] font-black uppercase tracking-widest flex-shrink-0"
              style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
          ))}
        </div>
        <div className="flex items-center justify-between md:justify-center"><Logo/><HamburgerBtn className="md:hidden"/></div>
        <div className="hidden md:flex items-center justify-end gap-6">
          {navLinks.slice(3, 6).map(l => (
            <a key={l} href={linkHref(l)} className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
          ))}
          <Cta size="sm"/>
        </div>
      </nav>
      <Drawer/>
    </>
  );

  // ── logo-top ───────────────────────────────────────────────────────────────
  if (layout === 'logo-top') return (
    <>
      <nav className={cn('flex flex-col items-center gap-1.5 py-4 px-6 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo/>
        <div className="flex items-center gap-4 md:gap-6">
          <Links className="hidden md:flex"/>
          <Cta size="sm"/>
          <HamburgerBtn className="md:hidden"/>
        </div>
      </nav>
      <Drawer/>
    </>
  );

  // ── drawer only ────────────────────────────────────────────────────────────
  if (layout === 'drawer') return (
    <>
      <nav className={cn('flex items-center justify-between px-6 py-4 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo/>
        <div className="flex items-center gap-3">
          <Cta size="sm" className="hidden sm:inline-flex"/>
          <HamburgerBtn/>
        </div>
      </nav>
      <Drawer/>
    </>
  );

  // ── minimal ────────────────────────────────────────────────────────────────
  if (layout === 'minimal') return (
    <>
      <nav className={cn('flex items-center justify-between px-6 md:px-14 py-4', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo/>
        <div className="flex items-center gap-3">
          <Cta/>
          <HamburgerBtn className="md:hidden"/>
        </div>
      </nav>
      <Drawer/>
    </>
  );


  // ── centered (default) ─────────────────────────────────────────────────────
  return (
    <>
      <nav className={cn('flex items-center justify-between px-6 md:px-14 py-4 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo/>
        <div className="overflow-x-auto hidden md:block" style={{ scrollbarWidth: 'none' }}>
          <Links className="flex"/>
        </div>
        <div className="flex items-center gap-3">
          <Cta className="hidden md:inline-flex"/>
          <HamburgerBtn className="md:hidden"/>
        </div>
      </nav>
      <Drawer/>
    </>
  );
}

// ─── HeroSection ──────────────────────────────────────────────────────────────
function HeroSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout   = config.layout || 'centered';
  const hasBg    = !!config.bgImage;
  const hasVideo = !!config.videoUrl;
  const hasMedia = hasBg || hasVideo;
  const opacity  = (config.overlayOpacity ?? 50) / 100;
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 60); return () => clearTimeout(t); }, []);

  const headline = config.headline    || 'Book Your Experience';
  const subline  = config.subheadline || 'A sanctuary of craft, curated for those who appreciate the details.';
  const words    = headline.split(' ');

  const Img = ({ cls = 'absolute inset-0 w-full h-full object-cover' }: { cls?: string }) =>
    hasBg  ? <img src={config.bgImage!} alt="" className={cls} draggable={false}/> :
    hasVideo ? <video autoPlay muted loop playsInline className={cls}><source src={config.videoUrl}/></video> : null;

  const PrimaryBtn = ({ dark = false }: { dark?: boolean }) => (
    <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
      <button onClick={cta(config.ctaAction, config.ctaUrl)}
              className="inline-flex items-center gap-2 px-8 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.04] active:scale-[0.97] transition-all"
              style={dark ? { background:'white', color:ac(style), borderRadius:br(style), fontFamily:bf(style), boxShadow:'0 16px 48px rgba(0,0,0,0.25)' }
                          : { ...btnStyle(style), fontFamily:bf(style), boxShadow:`0 12px 40px ${ac(style)}40` }}>
        {config.ctaText || 'Book Now'} <ArrowRight className="w-3.5 h-3.5"/>
      </button>
    </FieldTap>
  );

  const GhostBtn = ({ dark = false }: { dark?: boolean }) => config.showWalkIn !== false ? (
    <FieldTap sectionId={sectionId} fieldKey="cta2Text" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
      <button onClick={cta(config.cta2Action)}
              className="px-8 py-4 font-black text-sm uppercase tracking-widest border-2 hover:opacity-75 transition-all"
              style={{ borderColor: dark ? 'rgba(255,255,255,0.35)' : ac(style), color: dark ? 'white' : ac(style), borderRadius:br(style), fontFamily:bf(style) }}>
        {config.cta2Text || 'Walk In'}
      </button>
    </FieldTap>
  ) : null;

  const Btns = ({ dark = false, center = false }: { dark?: boolean; center?: boolean }) => (
    <div className={cn('flex flex-wrap gap-3', center && 'justify-center')}>
      <PrimaryBtn dark={dark}/><GhostBtn dark={dark}/>
    </div>
  );

  const TrustBadge = ({ dark = false }: { dark?: boolean }) => config.showBadge && config.badgeText ? (
    <div className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.25em]',
                       dark ? 'bg-white/12 text-white/70 border border-white/20' : 'border')}
         style={dark ? {} : { background: ac(style)+'10', color: ac(style), borderColor: ac(style)+'25' }}>
      <Star className="w-3 h-3 fill-current"/> {config.badgeText}
    </div>
  ) : null;

  if (layout === 'vogue') return (
    <section className="relative overflow-hidden" style={{ minHeight: '100svh', background: '#fafafa' }}>
      <div className="absolute right-0 top-0 bottom-0 w-full md:w-[55%] overflow-hidden" style={{ background: ac(style)+'0a' }}>
        <Img cls="w-full h-full object-cover object-top"/>
        <div className="hidden md:block absolute inset-y-0 left-0 w-24" style={{ background: 'linear-gradient(to right, #fafafa, transparent)' }}/>
      </div>
      <div className="md:hidden absolute inset-0" style={{ background: `rgba(0,0,0,${opacity + 0.2})` }}/>
      <div className="relative z-10 flex flex-col justify-between min-h-[100svh] max-w-7xl mx-auto px-8 md:px-14 py-10 md:py-12">
        <div className="flex items-center justify-between">
          <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
            style={{ fontFamily: hf(style), color: hasMedia ? 'white' : ac(style), fontSize: 13, fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase' }}>
            {config.logoText || 'Studio'}
          </FieldTap>
          <TrustBadge dark={!!(hasBg || hasVideo)}/>
        </div>
        <div className="md:max-w-[45%] space-y-6 py-12">
          <div className="flex items-start gap-4">
            <div className="w-1 self-stretch shrink-0 mt-1" style={{ background: ac(style) }}/>
            <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h1" className="font-light leading-[0.87]"
              style={{ fontSize: 'clamp(52px,7.5vw,108px)', fontFamily: hf(style), color: hasMedia ? 'white' : '#0f172a', animation: loaded ? 'cf-fade-up 1s both' : 'none' }}>
              {headline}
            </FieldTap>
          </div>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-base leading-relaxed max-w-sm"
            style={{ fontFamily: bf(style), color: hasMedia ? 'rgba(255,255,255,0.65)' : '#64748b', animation: loaded ? 'cf-fade-up 1s 0.15s both' : 'none' }}>
            {subline}
          </FieldTap>
          <div style={{ animation: loaded ? 'cf-fade-up 1s 0.3s both' : 'none' }}><Btns dark={!!(hasBg || hasVideo)}/></div>
        </div>
        <div className="h-px w-full md:w-[45%]" style={{ background: hasMedia ? 'rgba(255,255,255,0.2)' : ac(style)+'20' }}/>
      </div>
    </section>
  );

  if (layout === 'immersive') return (
    <section className="relative overflow-hidden" style={{ height: '100svh', minHeight: 620 }}>
      <Img/>
      {!hasBg && !hasVideo && <div className="absolute inset-0" style={{ background: `linear-gradient(135deg,#0a0a0a,${ac(style)}55)` }}/>}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.05) 100%)' }}/>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.45) 0%, transparent 60%)' }}/>
      <div className="absolute top-0 inset-x-0 px-8 md:px-14 py-7 flex items-center justify-between z-10">
        <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
          style={{ color: 'rgba(255,255,255,0.75)', fontFamily: hf(style), fontSize: 13, letterSpacing: '0.25em', fontWeight: 700, textTransform: 'uppercase' }}>
          {config.logoText || 'Studio'}
        </FieldTap>
        <TrustBadge dark/>
      </div>
      <div className="absolute bottom-0 inset-x-0 px-8 md:px-14 pb-12 z-10">
        <div className="w-12 h-px bg-white/30 mb-8"/>
        <div className="grid md:grid-cols-[1.6fr_1fr] gap-8 items-end max-w-5xl">
          <div>
            <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h1" className="font-light leading-[0.87] text-white"
              style={{ fontSize: 'clamp(40px,6vw,80px)', fontFamily: hf(style) }}>{headline}</FieldTap>
          </div>
          <div className="space-y-5">
            <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" className="text-sm leading-relaxed text-white/60" style={{ fontFamily: bf(style) }}>{subline}</FieldTap>
            <Btns dark/>
          </div>
        </div>
      </div>
      <div className="absolute bottom-8 right-10 hidden md:flex flex-col items-center gap-2 opacity-35">
        <div className="w-px h-12 bg-white" style={{ animation: 'cf-count-up 2s ease-in-out infinite alternate' }}/>
        <span className="text-[8px] font-black uppercase tracking-[0.3em] text-white" style={{ writingMode: 'vertical-rl' }}>Scroll</span>
      </div>
    </section>
  );

  if (layout === 'oversized') return (
    <section className="relative overflow-hidden flex items-center" style={{ minHeight: '90svh', background: style.bgColor }}>
      <div className="absolute -right-20 -top-20 w-[40vw] h-[40vw] rounded-full pointer-events-none"
           style={{ background: ac(style)+'0c', filter: 'blur(60px)' }}/>
      <div className="absolute -left-10 bottom-0 w-[30vw] h-[30vw] rounded-full pointer-events-none"
           style={{ background: ac(style)+'07', filter: 'blur(80px)' }}/>
      {(hasBg || config.heroImage) && (
        <div className="hidden lg:block absolute right-12 top-1/2 -translate-y-1/2 shadow-2xl overflow-hidden"
             style={{ width: 220, height: 300, borderRadius: br(style, 3), border: `2px solid ${ac(style)}18` }}>
          <img src={config.bgImage || config.heroImage} alt="" className="w-full h-full object-cover"/>
        </div>
      )}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-8 md:px-14 py-20 space-y-8">
        <TrustBadge/>
        <h1 className="font-light leading-[0.82] -tracking-[0.02em]"
            style={{ fontSize: 'clamp(58px,14vw,190px)', fontFamily: hf(style), color: '#0f172a' }}>{headline}</h1>
        <div className="flex items-center gap-6 max-w-md">
          <div className="w-10 h-px shrink-0" style={{ background: ac(style) }}/>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-sm leading-relaxed text-slate-500" style={{ fontFamily: bf(style) }}>{subline}</FieldTap>
        </div>
        <Btns/>
      </div>
    </section>
  );

  if (layout === 'split') return (
    <section className="relative grid md:grid-cols-2 overflow-hidden" style={{ minHeight: '90svh', background: style.bgColor }}>
      <div className="flex flex-col justify-center px-8 md:px-14 py-20 space-y-8 order-2 md:order-1">
        <TrustBadge/>
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="font-light leading-[0.9]"
          style={{ fontSize: 'clamp(40px,5vw,68px)', fontFamily: hf(style), color: '#0f172a' }}>{headline}</FieldTap>
        <div className="h-0.5 w-14" style={{ background: ac(style), animation: loaded ? 'cf-line-grow 0.8s 0.2s both' : 'none' }}/>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-base leading-relaxed max-w-sm text-slate-500" style={{ fontFamily: bf(style) }}>{subline}</FieldTap>
        <Btns/>
      </div>
      <div className="relative overflow-hidden min-h-[50vw] md:min-h-0 order-1 md:order-2" style={{ background: ac(style)+'0a' }}>
        {hasBg && <img src={config.bgImage!} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
        {!hasBg && config.heroImage && <img src={config.heroImage} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
        {!hasBg && !config.heroImage && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[160px] font-light opacity-[0.06]" style={{ color: ac(style), fontFamily: hf(style) }}>{(config.logoText||'S')[0]}</span>
          </div>
        )}
      </div>
    </section>
  );

  if (layout === 'editorial') return (
    <section className="relative overflow-hidden" style={{ minHeight: '90svh', background: style.bgColor }}>
      <div className="w-full h-px" style={{ background: ac(style)+'22' }}/>
      <div className="max-w-7xl mx-auto px-8 md:px-14 py-10 md:py-14">
        <div className="grid md:grid-cols-[280px_1fr] gap-8 md:gap-14 items-start">
          <div className="space-y-6">
            <div className="space-y-0.5">
              <p className="text-[9px] font-black uppercase tracking-[0.35em] text-slate-400">Vol. I</p>
              <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: ac(style) }}>{config.logoText || 'Studio'}</p>
            </div>
            {(hasBg || config.heroImage) ? (
              <div className="overflow-hidden" style={{ aspectRatio: '3/4', borderRadius: br(style, 1.5) }}>
                <img src={config.bgImage||config.heroImage!} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"/>
              </div>
            ) : (
              <div className="aspect-[3/4] flex items-center justify-center" style={{ background: ac(style)+'0e', borderRadius: br(style, 1.5) }}>
                <div className="w-20 h-20 rounded-full" style={{ background: ac(style)+'1a' }}/>
              </div>
            )}
            <div className="space-y-4">
              <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{subline}</FieldTap>
              <TrustBadge/><Btns/>
            </div>
          </div>
          <div className="pt-0 md:pt-8">
            <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h1" className="font-light leading-[0.86]"
              style={{ fontSize: 'clamp(60px,9vw,130px)', fontFamily: hf(style), color: '#0f172a' }}>{headline}</FieldTap>
            <div className="mt-8 h-px" style={{ background: ac(style)+'1a' }}/>
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 w-full h-px" style={{ background: ac(style)+'22' }}/>
    </section>
  );

  if (layout === 'dark') return (
    <section className="relative flex items-center overflow-hidden" style={{ minHeight: '92svh', background: '#0c0c0e' }}>
      {hasBg && (<><img src={config.bgImage!} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25"/><div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)' }}/></>)}
      <div className="absolute top-[10%] right-[5%] rounded-full pointer-events-none"
           style={{ width: 400, height: 400, background: ac(style)+'20', filter: 'blur(100px)', animation: 'cf-drift-a 12s ease-in-out infinite' }}/>
      <div className="absolute bottom-[15%] left-[0%] rounded-full pointer-events-none"
           style={{ width: 320, height: 320, background: ac(style)+'12', filter: 'blur(80px)', animation: 'cf-drift-b 15s ease-in-out infinite 3s' }}/>
      <div className="relative z-10 w-full max-w-7xl mx-auto px-8 md:px-14 py-20 space-y-8">
        <TrustBadge dark/>
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="font-light leading-[0.88] text-white"
          style={{ fontSize: 'clamp(48px,8vw,100px)', fontFamily: hf(style) }}>
          {words.map((w, i) => (
            <span key={i} className="overflow-hidden inline-block mr-[0.22em]">
              <span className="inline-block" style={{ animation: loaded ? `cf-word-up 0.9s cubic-bezier(0.16,1,0.3,1) ${i * 0.1}s both` : 'none' }}>
                {i === Math.floor(words.length / 2) ? <span style={{ color: ac(style) }}>{w}</span> : w}
              </span>
            </span>
          ))}
        </FieldTap>
        <div className="flex items-center gap-4">
          <div className="h-px w-10" style={{ background: ac(style)+'60' }}/>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-sm leading-relaxed max-w-md" style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.5)' }}>{subline}</FieldTap>
        </div>
        <Btns dark/>
      </div>
    </section>
  );

  if (layout === 'glass') return (
    <section className="relative flex items-center justify-center overflow-hidden px-4" style={{ minHeight: '95svh', background: '#111' }}>
      <Img/>
      {!hasBg && !hasVideo && (<div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${ac(style)}25 0%, #1a0a1e 100%)` }}/>)}
      <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${Math.max(opacity, 0.3)})` }}/>
      <div className="relative z-10 w-full max-w-lg mx-auto text-center space-y-7 py-12 px-8 md:px-12"
           style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(28px) saturate(1.4)', WebkitBackdropFilter: 'blur(28px) saturate(1.4)', borderRadius: br(style, 4), border: '1px solid rgba(255,255,255,0.16)', boxShadow: '0 40px 100px rgba(0,0,0,0.5)' }}>
        {config.logoUrl
          ? <img src={config.logoUrl} alt="Logo" className="h-9 mx-auto object-contain filter brightness-0 invert opacity-80"/>
          : <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="p"
              className="text-[11px] font-black uppercase tracking-[0.3em] text-white/60" style={{ fontFamily: hf(style) }}>
              {config.logoText || 'Studio'}
            </FieldTap>}
        <div className="h-px w-10 mx-auto bg-white/20"/>
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="font-light leading-[0.93] text-white"
          style={{ fontSize: 'clamp(30px,5vw,54px)', fontFamily: hf(style) }}>{headline}</FieldTap>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-sm leading-relaxed max-w-xs mx-auto"
          style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.55)' }}>{subline}</FieldTap>
        <TrustBadge dark/>
        <div className="flex flex-col sm:flex-row gap-3 justify-center"><Btns dark center/></div>
      </div>
    </section>
  );

  if (layout === 'kinetic') return (
    <section className="relative flex flex-col items-center justify-center overflow-hidden"
             style={{ minHeight: '92svh', background: hasBg ? 'transparent' : style.bgColor }}>
      {hasBg && <img src={config.bgImage!} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
      {hasVideo && <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      {hasMedia && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${opacity})` }}/>}
      <div className="absolute top-[12%] left-[6%] rounded-full pointer-events-none"
           style={{ width: 280, height: 280, background: ac(style), opacity: 0.11, filter: 'blur(70px)', animation: 'cf-drift-a 9s ease-in-out infinite' }}/>
      <div className="absolute bottom-[15%] right-[8%] rounded-full pointer-events-none"
           style={{ width: 360, height: 360, background: ac(style), opacity: 0.08, filter: 'blur(90px)', animation: 'cf-drift-b 12s ease-in-out infinite 2s' }}/>
      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto space-y-10">
        <div style={{ animation: 'cf-fade-in 0.6s both' }}><TrustBadge dark={hasMedia}/></div>
        <h1 className="flex flex-wrap justify-center gap-x-[0.25em] leading-[0.87]"
            style={{ fontSize: 'clamp(44px,8vw,96px)', fontFamily: hf(style) }}>
          {words.map((word, i) => (
            <span key={i} className="overflow-hidden inline-block">
              <span className="inline-block"
                    style={{ color: hasMedia ? 'white' : '#0f172a', animation: `cf-word-up 0.85s cubic-bezier(0.16,1,0.3,1) ${0.08 + i * 0.1}s both` }}>{word}</span>
            </span>
          ))}
        </h1>
        <div className="flex flex-col items-center gap-2.5" style={{ animation: `cf-fade-in 1s ${0.15 + words.length * 0.1}s both` }}>
          <div className="h-px w-14 origin-left" style={{ background: hasMedia ? 'rgba(255,255,255,0.4)' : ac(style), animation: `cf-line-grow 0.8s ${0.25 + words.length * 0.1}s both` }}/>
          <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-base max-w-xl leading-relaxed text-center"
            style={{ fontFamily: bf(style), color: hasMedia ? 'rgba(255,255,255,0.62)' : '#64748b' }}>{subline}</FieldTap>
        </div>
        <div style={{ animation: `cf-float-up 0.9s cubic-bezier(0.34,1.56,0.64,1) ${0.4 + words.length * 0.1}s both` }}>
          <Btns dark={hasMedia} center/>
        </div>
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="absolute pointer-events-none rounded-full opacity-50"
             style={{ width: [6,4,8,5,3][i], height: [6,4,8,5,3][i], top: ['20%','72%','42%','82%','30%'][i], left: ['12%','80%','4%','55%','88%'][i],
               background: hasMedia ? 'rgba(255,255,255,0.5)' : ac(style),
               animation: `${['cf-drift-a','cf-drift-b','cf-drift-c','cf-drift-a','cf-drift-b'][i]} ${[7,9,11,8,10][i]}s ease-in-out infinite ${i * 1.3}s` }}/>
      ))}
    </section>
  );

  if (layout === 'layers') {
    const handleMM = (e: React.MouseEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setMouse({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
    };
    return (
      <section className="relative flex items-center overflow-hidden"
               style={{ minHeight: '96svh', background: '#0d0d10', cursor: 'crosshair' }}
               onMouseMove={handleMM}>
        <div className="absolute inset-[-8%] transition-transform duration-700 ease-out pointer-events-none"
             style={{ transform: `translate(${mouse.x * 30}px, ${mouse.y * 18}px)` }}>
          {hasBg ? <img src={config.bgImage!} alt="" className="w-full h-full object-cover" style={{ filter: 'brightness(0.4)' }}/>
                 : <div className="w-full h-full" style={{ background: `radial-gradient(ellipse at 40% 50%, ${ac(style)}30 0%, #000 65%)` }}/>}
        </div>
        <div className="absolute inset-0 pointer-events-none transition-transform duration-500 ease-out"
             style={{ transform: `translate(${mouse.x * 15}px, ${mouse.y * 10}px)` }}>
          <div className="absolute top-1/4 right-1/3 rounded-full" style={{ width:380, height:380, background: ac(style)+'1c', filter:'blur(90px)' }}/>
          <div className="absolute bottom-1/3 left-1/5 rounded-full" style={{ width:280, height:280, background: ac(style)+'14', filter:'blur(70px)' }}/>
        </div>
        <div className="relative z-10 w-full max-w-7xl mx-auto px-8 md:px-14 transition-transform duration-700 ease-out"
             style={{ transform: `translate(${mouse.x * 5}px, ${mouse.y * 3}px)`, animation: 'cf-blur-in 1.2s 0.1s both' }}>
          <div className="max-w-3xl space-y-8">
            <TrustBadge dark/>
            <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h1" className="font-light leading-[0.88] text-white"
              style={{ fontSize: 'clamp(48px,8vw,100px)', fontFamily: hf(style) }}>{headline}</FieldTap>
            <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" className="text-lg max-w-md leading-relaxed"
              style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.52)' }}>{subline}</FieldTap>
            <Btns dark/>
          </div>
        </div>
        <div className="absolute rounded-full pointer-events-none transition-all duration-300"
             style={{ width:380, height:380, left:`calc(${(mouse.x+0.5)*100}% - 190px)`, top:`calc(${(mouse.y+0.5)*100}% - 190px)`,
               background:`radial-gradient(circle, ${ac(style)}1c 0%, transparent 70%)` }}/>
      </section>
    );
  }

  return (
    <section className="relative flex items-center overflow-hidden"
             style={{ minHeight: '85svh', background: hasBg ? 'transparent' : style.bgColor }}>
      {hasBg && <img src={config.bgImage!} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
      {hasVideo && <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      {hasMedia && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${opacity})` }}/>}
      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 md:px-14 py-24 text-center space-y-8">
        <TrustBadge dark={hasMedia}/>
        <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h1" className="font-light leading-[0.92]"
          style={{ fontSize: 'clamp(44px,8vw,100px)', fontFamily: hf(style), color: hasMedia ? 'white' : '#0f172a' }}>{headline}</FieldTap>
        <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-lg max-w-2xl mx-auto leading-relaxed"
          style={{ fontFamily: bf(style), color: hasMedia ? 'rgba(255,255,255,0.68)' : '#64748b' }}>{subline}</FieldTap>
        <Btns dark={hasMedia} center/>
      </div>
    </section>
  );
}

// ─── JackpotNumber ────────────────────────────────────────────────────────────
function JackpotNumber({ target, visible, delay = 0, className = '', style: s }: {
  target: string; visible: boolean; delay?: number; className?: string; style?: React.CSSProperties;
}) {
  const [display, setDisplay] = useState('—');
  const numStr  = target.replace(/[^0-9.]/g, '');
  const numVal  = parseFloat(numStr) || 0;
  const prefix  = target.match(/^[^0-9]*/)?.[0] || '';
  const suffix  = target.slice(prefix.length + numStr.length);

  useEffect(() => {
    if (!visible) return;
    const tid = setTimeout(() => {
      let step = 0;
      const total = 28;
      const id = setInterval(() => {
        step++;
        if (step < Math.floor(total * 0.65)) {
          const rand = Math.floor(Math.random() * Math.max(numVal * 1.5, 99));
          setDisplay(`${prefix}${rand}${suffix}`);
        } else if (step < total) {
          const p = (step - Math.floor(total * 0.65)) / (total * 0.35);
          setDisplay(`${prefix}${Math.floor(numVal * p)}${suffix}`);
        } else {
          setDisplay(target || '—');
          clearInterval(id);
        }
      }, 55);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(tid);
  }, [visible, target, delay]);

  return <span className={className} style={s}>{display}</span>;
}

const TRUST_ICON_MAP: Record<string, React.ElementType> = {
  star: Star, users: Users, heart: Heart, award: Award, scissors: Scissors,
  zap: Zap, crown: Crown, shield: Shield, trending: TrendingUp,
  check: CheckCircle, thumbs: ThumbsUp, smile: Smile, coffee: Coffee,
  sparkles: Sparkles, clock: Clock, calendar: Calendar,
};

// ─── TrustSection ─────────────────────────────────────────────────────────────
function TrustSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const { ref, visible } = useInView(0.2);
  const layout = config.layout || 'strip';

  const stats = [1,2,3,4].map(n => ({
    v: config[`stat${n}v`] || ['500+','4.9','6','20+'][n-1],
    l: config[`stat${n}l`] || ['Happy Clients','Avg Rating','Years Open','Services'][n-1],
    i: config[`stat${n}i`] || ['smile','star','clock','scissors'][n-1],
  })).filter(s => s.v);

  // ── shared mobile-scroll wrapper ──────────────────────────────────────────
  // Used by every layout except 'ticker'.
  // On mobile: true horizontal strip (flex, overflow-x-auto, snap).
  // On md+: switches to whatever grid the layout wants.
  const MobileStrip = ({
    children,
    desktopCls = 'md:grid md:grid-cols-4',
    outerCls   = '',
  }: {
    children: React.ReactNode;
    desktopCls?: string;
    outerCls?: string;
  }) => (
    <div className={cn('overflow-x-auto md:overflow-visible', outerCls)}
         style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none' }}>
      <div className={cn('flex md:grid snap-x snap-mandatory w-max md:w-auto', desktopCls)}>
        {children}
      </div>
    </div>
  );

  // ── STRIP ─────────────────────────────────────────────────────────────────
  if (layout === 'strip') return (
    <div ref={ref} className="border-y overflow-hidden" style={{ borderColor: ac(style) + '18' }}>
      <div className="max-w-5xl mx-auto px-4 py-0 md:py-8">
        <MobileStrip desktopCls="md:grid md:grid-cols-4">
          {stats.map((s, i) => {
            const Icon = TRUST_ICON_MAP[s.i] || Star;
            return (
              <div key={i}
                   className="flex flex-col items-center gap-1 text-center snap-start shrink-0
                              py-6 md:py-4"
                   style={{
                     minWidth: 112,
                     paddingLeft: 18, paddingRight: 18,
                     borderRight: i < stats.length - 1
                       ? `1px dashed ${ac(style)}22`
                       : 'none',
                   }}>
                <Icon className="w-4 h-4 md:w-5 md:h-5 mb-1" style={{ color: ac(style), opacity: 0.7 }}/>
                <JackpotNumber target={s.v} visible={visible} delay={i * 120}
                  className="text-2xl md:text-4xl font-light tabular-nums"
                  style={{ fontFamily: hf(style), color: ac(style) }}/>
                <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}l`}
                  isPreview={isPreview} onFieldTap={onFieldTap}
                  as="p"
                  className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.18em] leading-tight text-center mt-0.5"
                  style={{ color: '#94a3b8', fontFamily: bf(style) }}>
                  {s.l}
                </FieldTap>
              </div>
            );
          })}
        </MobileStrip>
      </div>
    </div>
  );

  // ── CARDS ─────────────────────────────────────────────────────────────────
  if (layout === 'cards') return (
    <div ref={ref} className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-10">
        <div className="overflow-x-auto md:overflow-visible"
             style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none' }}>
          <div className="flex md:grid md:grid-cols-4 gap-3 md:gap-5 w-max md:w-auto snap-x snap-mandatory pb-3 md:pb-0">
            {stats.map((s, i) => {
              const Icon = TRUST_ICON_MAP[s.i] || Star;
              return (
                <div key={i}
                     className="bg-white p-5 md:p-7 text-center space-y-3
                                hover:shadow-xl hover:-translate-y-1 transition-all duration-300
                                snap-start shrink-0 md:shrink"
                     style={{
                       borderRadius: br(style, 1.5),
                       border: `1.5px solid ${ac(style)}15`,
                       minWidth: 140,
                     }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto"
                       style={{ background: ac(style) + '12' }}>
                    <Icon className="w-5 h-5" style={{ color: ac(style) }}/>
                  </div>
                  <JackpotNumber target={s.v} visible={visible} delay={i * 150}
                    className="block text-3xl md:text-4xl font-light tabular-nums"
                    style={{ fontFamily: hf(style), color: ac(style) }}/>
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400"
                     style={{ fontFamily: bf(style) }}>{s.l}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── BANNER ────────────────────────────────────────────────────────────────
  if (layout === 'banner') return (
    <div ref={ref} className="relative overflow-hidden py-12 md:py-16"
         style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b3a 100%)' }}>
      <div className="absolute inset-0 pointer-events-none"
           style={{ background: `radial-gradient(ellipse at center, ${ac(style)}18 0%, transparent 70%)` }}/>
      <div className="relative max-w-5xl mx-auto px-4 md:px-10">
        <div className="overflow-x-auto md:overflow-visible"
             style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none' }}>
          <div className="flex md:grid md:grid-cols-4 gap-6 md:gap-10 w-max md:w-auto snap-x snap-mandatory">
            {stats.map((s, i) => {
              const Icon = TRUST_ICON_MAP[s.i] || Star;
              return (
                <div key={i}
                     className="text-center space-y-2 snap-start shrink-0 md:shrink px-4 md:px-0"
                     style={{ minWidth: 120 }}>
                  <Icon className="w-6 h-6 mx-auto mb-2" style={{ color: ac(style) + 'aa' }}/>
                  <JackpotNumber target={s.v} visible={visible} delay={i * 130}
                    className="block text-4xl md:text-5xl font-light tabular-nums text-white"
                    style={{ fontFamily: hf(style) }}/>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em]"
                     style={{ color: ac(style) + 'aa', fontFamily: bf(style) }}>{s.l}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── TICKER (already a strip — no changes needed) ───────────────────────────
  if (layout === 'ticker') return (
    <div className="py-3 border-y overflow-hidden" style={{ borderColor: ac(style) + '18' }}>
      <div className="flex" style={{ animation: 'cf-marquee 24s linear infinite', width: 'max-content' }}>
        {[...stats,...stats,...stats,...stats].map((s, i) => {
          const Icon = TRUST_ICON_MAP[s.i] || Star;
          return (
            <div key={i} className="flex items-center gap-2 px-8 shrink-0">
              <Icon className="w-4 h-4 shrink-0" style={{ color: ac(style) }}/>
              <span className="text-xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{s.v}</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.l}</span>
              <span className="w-1 h-1 rounded-full ml-6" style={{ background: ac(style) + '40' }}/>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── COUNTER ───────────────────────────────────────────────────────────────
  if (layout === 'counter') return (
    <div ref={ref} className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-4 md:px-10">
        <div className="overflow-x-auto md:overflow-visible"
             style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none' }}>
          <div className="flex md:grid md:grid-cols-4 md:divide-x md:divide-y-0 w-max md:w-auto snap-x snap-mandatory"
               style={{ '--tw-divide-opacity': 1 } as any}>
            {stats.map((s, i) => {
              const Icon = TRUST_ICON_MAP[s.i] || Star;
              return (
                <div key={i}
                     className="flex flex-col items-center gap-3 p-6 md:p-8 text-center group snap-start shrink-0 md:shrink"
                     style={{
                       minWidth: 130,
                       borderRight: i < stats.length - 1
                         ? `1px solid ${ac(style)}12`
                         : 'none',
                     }}>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center
                                  transition-all duration-300 group-hover:scale-110"
                       style={{ background: ac(style) + '10' }}>
                    <Icon className="w-6 h-6" style={{ color: ac(style) }}/>
                  </div>
                  <JackpotNumber target={s.v} visible={visible} delay={i * 140}
                    className="block font-light tabular-nums leading-none"
                    style={{ fontSize: 'clamp(28px,5vw,56px)', fontFamily: hf(style), color: '#0f172a' }}/>
                  <div className="h-0.5 w-8 mx-auto rounded-full transition-all duration-500 group-hover:w-14"
                       style={{ background: ac(style) }}/>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400"
                     style={{ fontFamily: bf(style) }}>{s.l}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── FALLBACK ──────────────────────────────────────────────────────────────
  return (
    <div ref={ref} className="py-12 border-y" style={{ borderColor: ac(style) + '18' }}>
      <div className="max-w-5xl mx-auto px-4">
        <div className="overflow-x-auto md:overflow-visible"
             style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none' }}>
          <div className="flex md:grid md:grid-cols-4 gap-6 text-center w-max md:w-auto snap-x snap-mandatory">
            {stats.map((s, i) => {
              const Icon = TRUST_ICON_MAP[s.i] || Star;
              return (
                <div key={i} className="snap-start shrink-0 md:shrink" style={{ minWidth: 120 }}>
                  <Icon className="w-5 h-5 mx-auto mb-2" style={{ color: ac(style), opacity: 0.6 }}/>
                  <JackpotNumber target={s.v} visible={visible} delay={i * 120}
                    className="block text-3xl md:text-4xl font-light tabular-nums"
                    style={{ fontFamily: hf(style), color: ac(style) }}/>
                  <p className="text-[9px] font-black uppercase tracking-widest mt-1 text-slate-400"
                     style={{ fontFamily: bf(style) }}>{s.l}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
// ─── ServicesSection ──────────────────────────────────────────────────────────
function ServicesSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'cards';
  const accent = ac(style);
  const { ref, visible } = useInView(0.06);
  const services = data.services || [];
 
  const showHeading    = config.showHeading    !== false;
  const showSubheading = config.showSubheading !== false;
 
  const Header = () => (showHeading || showSubheading) ? (
    <div className="text-center space-y-3 mb-10 md:mb-14">
      {showHeading && (
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h2" className="font-light"
          style={{ fontFamily: hf(style), fontSize: 'clamp(26px,5vw,56px)', color: '#0f172a' }}>
          {config.heading || 'Our Services'}
        </FieldTap>
      )}
      {showSubheading && config.subheading && (
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="font-light leading-relaxed mx-auto"
          style={{ fontFamily: bf(style), color: '#64748b',
            fontSize: 'clamp(14px,1.8vw,16px)', maxWidth: '32rem' }}>
          {config.subheading}
        </FieldTap>
      )}
    </div>
  ) : null;
 
  const BookBtn = ({ svc }: { svc: any }) => (
    <button
      onClick={() => openBooking(svc)}
      className="w-full font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.98]
                 transition-all whitespace-nowrap"
      style={{
        ...btnStyle(style), fontFamily: bf(style),
        padding: 'clamp(10px,2vw,13px) 0',
        fontSize: 'clamp(9px,1.8vw,11px)',
        letterSpacing: '0.12em',
      }}>
      {config.ctaText || 'Book this service'}
    </button>
  );
 
  // ── cards ──────────────────────────────────────────────────────────────────
  if (layout === 'cards') {
    const cols = parseInt(config.columns || '2');
    const gridCls = cols === 3
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : cols === 1
        ? 'grid-cols-1 max-w-lg mx-auto'
        : 'grid-cols-1 sm:grid-cols-2';
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className={cn('grid gap-4 md:gap-6', gridCls)}>
            {services.map((svc: any, i: number) => (
              <div key={svc.id}
                className="flex flex-col overflow-hidden"
                style={{
                  border: `1.5px solid ${accent}15`, borderRadius: br(style, 2),
                  background: '#fff',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  animation: visible ? `cf-fade-up 0.55s ${i * 0.07}s both` : 'none',
                }}>
                {config.showImages && svc.imageUrl && (
                  <div className="overflow-hidden" style={{ aspectRatio: '16/9' }}>
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover"/>
                  </div>
                )}
                <div className="flex flex-col flex-1 p-5 md:p-6 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-black uppercase tracking-tight text-slate-900 leading-tight flex-1"
                      style={{ fontFamily: bf(style), fontSize: 'clamp(13px,2vw,15px)' }}>
                      {svc.name}
                    </h3>
                    {config.showPrices !== false && svc.price && (
                      <span className="font-light shrink-0"
                        style={{ fontFamily: hf(style), color: accent, fontSize: 'clamp(18px,3vw,24px)' }}>
                        ${svc.price}
                      </span>
                    )}
                  </div>
                  {config.showDuration !== false && svc.duration && (
                    <p className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: `${accent}70`, fontFamily: bf(style) }}>
                      {svc.duration} min
                    </p>
                  )}
                  {config.showDesc !== false && svc.description && (
                    <p className="text-sm text-slate-500 leading-relaxed flex-1 font-light"
                      style={{ fontFamily: bf(style) }}>
                      {svc.description}
                    </p>
                  )}
                  <div className="pt-2 mt-auto"><BookBtn svc={svc}/></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // ── luxury list (numbered editorial rows) ──────────────────────────────────
  if (layout === 'luxury') {
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-4xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className="space-y-0">
            {services.map((svc: any, i: number) => (
              <div key={svc.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-4 md:gap-8 py-5 md:py-6 border-b group cursor-pointer hover:bg-slate-50/60 transition-colors px-2 -mx-2 rounded-lg"
                style={{
                  borderColor: `${accent}10`,
                  animation: visible ? `cf-fade-up 0.55s ${i * 0.07}s both` : 'none',
                }}
                onClick={() => openBooking(svc)}>
                <span className="text-[11px] font-black tabular-nums shrink-0"
                  style={{ color: accent, fontFamily: bf(style), letterSpacing: '0.1em' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="font-black uppercase tracking-tight text-slate-900 truncate"
                    style={{ fontFamily: bf(style), fontSize: 'clamp(13px,2vw,16px)' }}>
                    {svc.name}
                  </p>
                  {config.showDuration !== false && svc.duration && (
                    <p className="text-[10px] font-black uppercase tracking-widest mt-0.5"
                      style={{ color: `${accent}65`, fontFamily: bf(style) }}>
                      {svc.duration} min
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {config.showPrices !== false && svc.price && (
                    <span className="font-light"
                      style={{ fontFamily: hf(style), color: accent, fontSize: 'clamp(18px,2.5vw,24px)' }}>
                      ${svc.price}
                    </span>
                  )}
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all translate-x-0 group-hover:translate-x-1"
                    style={{ color: accent }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // ── grid ───────────────────────────────────────────────────────────────────
  if (layout === 'grid') {
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {services.map((svc: any, i: number) => (
              <button key={svc.id}
                onClick={() => openBooking(svc)}
                className="text-left p-5 hover:shadow-lg active:scale-[0.98] transition-all"
                style={{
                  border: `1.5px solid ${accent}15`, borderRadius: br(style, 2),
                  background: '#fff',
                  animation: visible ? `cf-fade-up 0.5s ${i * 0.06}s both` : 'none',
                }}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="font-black uppercase tracking-tight text-slate-900 leading-tight"
                    style={{ fontFamily: bf(style), fontSize: 'clamp(12px,2vw,14px)' }}>
                    {svc.name}
                  </h3>
                  {config.showPrices !== false && svc.price && (
                    <span className="font-light shrink-0"
                      style={{ fontFamily: hf(style), color: accent, fontSize: 'clamp(16px,2.5vw,20px)' }}>
                      ${svc.price}
                    </span>
                  )}
                </div>
                {config.showDuration !== false && svc.duration && (
                  <p className="text-[9px] font-black uppercase tracking-widest"
                    style={{ color: `${accent}65`, fontFamily: bf(style) }}>
                    {svc.duration} min
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // ── list ───────────────────────────────────────────────────────────────────
  if (layout === 'list') {
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-2xl mx-auto" style={{ padding: '0 clamp(16px,5vw,48px)' }}>
          <Header/>
          <div ref={ref} className="space-y-2">
            {services.map((svc: any, i: number) => (
              <button key={svc.id}
                onClick={() => openBooking(svc)}
                className="w-full flex items-center justify-between gap-4 p-4 md:p-5 text-left hover:shadow-md active:scale-[0.98] transition-all"
                style={{
                  border: `1.5px solid ${accent}15`, borderRadius: br(style, 1.5),
                  background: '#fff',
                  animation: visible ? `cf-fade-up 0.5s ${i * 0.06}s both` : 'none',
                }}>
                <div className="flex-1 min-w-0">
                  <p className="font-black uppercase tracking-tight text-slate-900 truncate"
                    style={{ fontFamily: bf(style), fontSize: 'clamp(12px,2vw,14px)' }}>
                    {svc.name}
                  </p>
                  {config.showDuration !== false && svc.duration && (
                    <p className="text-[9px] font-black uppercase tracking-widest mt-0.5"
                      style={{ color: `${accent}65`, fontFamily: bf(style) }}>
                      {svc.duration} min
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {config.showPrices !== false && svc.price && (
                    <span className="font-light"
                      style={{ fontFamily: hf(style), color: accent, fontSize: 'clamp(17px,2.5vw,22px)' }}>
                      ${svc.price}
                    </span>
                  )}
                  <ArrowRight className="w-4 h-4" style={{ color: `${accent}60` }}/>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // ── carousel ───────────────────────────────────────────────────────────────
  if (layout === 'carousel') {
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto">
          <div style={{ padding: '0 clamp(16px,5vw,64px)' }}><Header/></div>
          <div ref={ref}
            className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory"
            style={{
              padding: '0 clamp(16px,5vw,64px)',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
            }}>
            {services.map((svc: any, i: number) => (
              <div key={svc.id}
                className="flex flex-col shrink-0 snap-start overflow-hidden"
                style={{
                  // Responsive card width: fills most of viewport on mobile, fixed on desktop
                  width: 'clamp(240px, 72vw, 300px)',
                  border: `1.5px solid ${accent}15`, borderRadius: br(style, 2),
                  background: '#fff',
                  animation: visible ? `cf-fade-up 0.5s ${i * 0.06}s both` : 'none',
                }}>
                {config.showImages && svc.imageUrl && (
                  <div style={{ aspectRatio: '4/3', overflow: 'hidden' }}>
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover"/>
                  </div>
                )}
                <div className="flex flex-col flex-1 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-black uppercase tracking-tight text-slate-900 leading-tight flex-1 text-sm"
                      style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                    {config.showPrices !== false && svc.price && (
                      <span className="font-light shrink-0"
                        style={{ fontFamily: hf(style), color: accent, fontSize: 22 }}>
                        ${svc.price}
                      </span>
                    )}
                  </div>
                  {config.showDuration !== false && svc.duration && (
                    <p className="text-[9px] font-black uppercase tracking-widest"
                      style={{ color: `${accent}65`, fontFamily: bf(style) }}>{svc.duration} min</p>
                  )}
                  <div className="mt-auto pt-2"><BookBtn svc={svc}/></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // ── horizontal ─────────────────────────────────────────────────────────────
  if (layout === 'horizontal') {
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-5xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className="space-y-4 md:space-y-6">
            {services.map((svc: any, i: number) => (
              <div key={svc.id}
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-4 p-5 md:p-6"
                style={{
                  border: `1.5px solid ${accent}15`, borderRadius: br(style, 2),
                  background: '#fff',
                  animation: visible ? `cf-fade-up 0.55s ${i * 0.08}s both` : 'none',
                }}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-black uppercase tracking-tight text-slate-900"
                      style={{ fontFamily: bf(style), fontSize: 'clamp(13px,2vw,15px)' }}>
                      {svc.name}
                    </h3>
                    {config.showPrices !== false && svc.price && (
                      <span className="font-light"
                        style={{ fontFamily: hf(style), color: accent, fontSize: 'clamp(18px,2.5vw,22px)' }}>
                        ${svc.price}
                      </span>
                    )}
                  </div>
                  {config.showDuration !== false && svc.duration && (
                    <p className="text-[9px] font-black uppercase tracking-widest"
                      style={{ color: `${accent}65`, fontFamily: bf(style) }}>{svc.duration} min</p>
                  )}
                  {config.showDesc !== false && svc.description && (
                    <p className="text-sm text-slate-500 leading-relaxed font-light"
                      style={{ fontFamily: bf(style) }}>{svc.description}</p>
                  )}
                </div>
                <div className="shrink-0 w-full sm:w-auto sm:min-w-[140px]">
                  <BookBtn svc={svc}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // ── masonry (fallback as grid) ─────────────────────────────────────────────
  return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
        <Header/>
        <div ref={ref} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {services.map((svc: any, i: number) => (
            <div key={svc.id}
              className="flex flex-col p-5 md:p-6 space-y-3 cursor-pointer hover:shadow-md transition-all"
              style={{
                border: `1.5px solid ${accent}15`, borderRadius: br(style, 2), background: '#fff',
                animation: visible ? `cf-fade-up 0.5s ${i * 0.06}s both` : 'none',
              }}
              onClick={() => openBooking(svc)}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-black uppercase tracking-tight text-slate-900 leading-tight flex-1 text-sm"
                  style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                {config.showPrices !== false && svc.price && (
                  <span className="font-light shrink-0"
                    style={{ fontFamily: hf(style), color: accent, fontSize: 20 }}>${svc.price}</span>
                )}
              </div>
              {config.showDuration !== false && svc.duration && (
                <p className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: `${accent}65`, fontFamily: bf(style) }}>{svc.duration} min</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
 
// ─── TeamSection ──────────────────────────────────────────────────────────────
function TeamSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const staff = data.staff;
  const layout = config.layout || 'circles';
  const { ref: soloRef, visible: soloVis } = useInView(0.08);

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
                  : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{m.specialties.slice(0, 2).join(' · ')}</p>}
                {config.showBio && m.bio && <p className="text-xs text-slate-500 mt-2 leading-relaxed" style={{ fontFamily: bf(style) }}>{m.bio}</p>}
                {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="mt-3 px-5 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  if (layout === 'row') return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="flex gap-6 overflow-x-auto pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>
          {staff.map((m: any) => (
            <div key={m.id} className="text-center space-y-3 shrink-0 snap-start group" style={{ width: '160px' }}>
              <div className="mx-auto overflow-hidden shadow-lg group-hover:scale-105 transition-all duration-500"
                   style={{ width: 96, height: 96, background: ac(style) + '15', borderRadius: br(style, 1.5) }}>
                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>
                  : <span className="w-full h-full flex items-center justify-center text-2xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 truncate" style={{ fontFamily: bf(style) }}>{m.name}</p>
              {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[9px] text-slate-400 uppercase tracking-wider">{m.specialties[0]}</p>}
              {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  if (layout === 'editorial') return (
    <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {staff.map((m: any) => (
            <div key={m.id} className="group overflow-hidden bg-white hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
                 style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}18` }}>
              <div className="relative aspect-[4/3] overflow-hidden" style={{ background: ac(style) + '12' }}>
                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                  : <span className="absolute inset-0 flex items-center justify-center text-5xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <div className="p-5 space-y-2">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[10px] uppercase tracking-wider text-slate-400">{m.specialties.slice(0, 2).join(' · ')}</p>}
                {config.showBio && m.bio && <p className="text-xs text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{m.bio}</p>}
                {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="w-full mt-2 py-2.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  if (layout === 'grid') return (
    <section id="team" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {staff.map((m: any) => (
            <div key={m.id} className="group relative overflow-hidden bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                 style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}18` }}>
              <div className="relative aspect-square overflow-hidden" style={{ background: ac(style) + '10' }}>
                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                  : <span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
                {config.hoverReveal !== false && m.bio && (
                  <div className="absolute inset-0 flex items-end p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                       style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 50%)' }}>
                    <p className="text-[10px] text-white/80 leading-relaxed line-clamp-3" style={{ fontFamily: bf(style) }}>{m.bio}</p>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left" style={{ background: ac(style) }}/>
              </div>
              <div className="p-4 space-y-1">
                <p className="text-[11px] font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[9px] uppercase tracking-wider text-slate-400">{m.specialties.slice(0, 2).join(' · ')}</p>}
                {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="w-full mt-2 py-2 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  if (layout === 'featured') {
    const [lead, ...rest] = staff;
    return (
      <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
          <div className="grid md:grid-cols-3 gap-5 items-start">
            {lead && (
              <div className="md:col-span-2 group relative overflow-hidden bg-white hover:shadow-2xl transition-all duration-500"
                   style={{ borderRadius: br(style, 2), border: `2px solid ${ac(style)}20` }}>
                <div className="relative aspect-[4/3] overflow-hidden" style={{ background: ac(style) + '10' }}>
                  {lead.avatarUrl ? <img src={lead.avatarUrl} alt={lead.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                    : <span className="absolute inset-0 flex items-center justify-center text-8xl font-light" style={{ fontFamily: hf(style), color: ac(style) + '40' }}>{lead.name?.[0]}</span>}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0) 55%)' }}/>
                  <div className="absolute bottom-0 inset-x-0 p-8 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/50">Lead Artist</p>
                    <p className="text-2xl md:text-3xl font-light text-white" style={{ fontFamily: hf(style) }}>{lead.name}</p>
                    {config.showSpecialties !== false && lead.specialties?.length > 0 && <p className="text-[11px] text-white/55 uppercase tracking-wider">{lead.specialties.slice(0, 3).join(' · ')}</p>}
                    {config.showBio && lead.bio && <p className="text-sm text-white/45 leading-relaxed max-w-sm" style={{ fontFamily: bf(style) }}>{lead.bio}</p>}
                    {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="mt-2 px-8 py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ background: 'white', color: ac(style), borderRadius: br(style), fontFamily: bf(style) }}>{config.bookCta || 'Book with me'}</button>}
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {rest.slice(0, 4).map((m: any) => (
                <div key={m.id} className="group flex items-center gap-4 p-4 bg-white hover:shadow-md transition-all" style={{ borderRadius: br(style, 1.5), border: `2px solid ${ac(style)}15` }}>
                  <div className="w-16 h-16 shrink-0 overflow-hidden rounded-full" style={{ background: ac(style) + '12' }}>
                    {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"/>
                      : <span className="w-full h-full flex items-center justify-center text-xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 truncate" style={{ fontFamily: bf(style) }}>{m.name}</p>
                    {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5 truncate">{m.specialties.slice(0, 2).join(' · ')}</p>}
                    {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="mt-2 px-4 py-1 text-[9px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
                  </div>
                </div>
              ))}
              {rest.length > 4 && <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] py-1" style={{ color: ac(style) + '60' }}>+{rest.length - 4} more artists</p>}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (layout === 'minimal') return (
    <section id="team" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="max-w-lg mx-auto space-y-0">
          {staff.map((m: any, idx: number) => (
            <div key={m.id} className="flex items-center gap-4 py-4" style={{ borderBottom: idx < staff.length - 1 ? `1px solid ${ac(style)}18` : 'none' }}>
              <div className="w-10 h-10 rounded-full overflow-hidden shrink-0" style={{ background: ac(style) + '15' }}>
                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>
                  : <span className="w-full h-full flex items-center justify-center text-sm font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <div className="flex-1">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[10px] text-slate-400 uppercase tracking-wider">{m.specialties.slice(0, 2).join(' · ')}</p>}
              </div>
              {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="shrink-0 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ── SOLO CINEMATIC ─────────────────────────────────────────────────────────
  if (layout === 'solo-cinematic') {
    const solo      = staff[0];
    const words     = (solo?.name || 'Artist').split(' ');
    const showBio   = !!(config.showBio && solo?.bio);
    const showBtn   = !!config.showBookButton;
    const showSpecs = !!(config.showSpecialties !== false && solo?.specialties?.length > 0);
    const hasBelow  = showBio || showBtn;

    return (
      <section id="team" ref={soloRef}
        className="relative overflow-hidden flex flex-col justify-end"
        style={{ minHeight: '100svh', background: '#07070d' }}>

        {solo?.avatarUrl ? (
          <>
            <img src={solo.avatarUrl} alt={solo?.name || ''}
              className="absolute inset-0 w-full h-full object-cover object-top"
              style={{
                filter: 'brightness(0.44) saturate(0.8)',
                transform: soloVis ? 'scale(1)' : 'scale(1.06)',
                transition: 'transform 1.8s cubic-bezier(0.16,1,0.3,1)',
              }}/>
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.50) 55%, rgba(0,0,0,0.12) 100%)' }}/>
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.12) 42%, transparent 68%)' }}/>
          </>
        ) : (
          <div className="absolute inset-0"
            style={{ background: `radial-gradient(ellipse 75% 85% at 65% 35%, ${ac(style)}28 0%, #07070d 75%)` }}/>
        )}

        <div className="absolute pointer-events-none"
          style={{ top: '10%', right: '5%', width: 260, height: 260,
            background: `${ac(style)}16`, filter: 'blur(80px)', borderRadius: '50%',
            animation: 'cf-drift-a 14s ease-in-out infinite' }}/>
        <div className="absolute pointer-events-none"
          style={{ bottom: '28%', left: '0%', width: 180, height: 180,
            background: `${ac(style)}0e`, filter: 'blur(60px)', borderRadius: '50%',
            animation: 'cf-drift-b 11s ease-in-out infinite 2s' }}/>

        <div className="absolute bottom-0 right-4 select-none pointer-events-none hidden md:block"
          style={{ fontSize: '32vw', fontFamily: hf(style),
            color: 'rgba(255,255,255,0.022)', lineHeight: 0.85, userSelect: 'none' }}>
          {solo?.name?.[0] ?? 'A'}
        </div>

        <div className="relative z-10 w-full max-w-5xl mx-auto px-6 md:px-16"
          style={{ paddingBottom: 'max(52px, env(safe-area-inset-bottom, 52px))', paddingTop: '120px' }}>

          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-5"
            style={{ animation: soloVis ? 'cf-fade-in 0.6s 0.05s both' : 'none' }}>
            <div className="h-px w-8"
              style={{ background: ac(style), animation: soloVis ? 'cf-line-grow 0.6s 0.1s both' : 'none' }}/>
            <span className="text-[10px] font-black uppercase tracking-[0.35em]" style={{ color: ac(style) }}>
              {config.heading || 'The Artist'}
            </span>
          </div>

          {/* Name */}
          <h2 className="font-light leading-[0.87] text-white"
            style={{
              fontSize: 'clamp(40px,9vw,92px)',
              fontFamily: hf(style),
              marginBottom: showSpecs || hasBelow ? '20px' : '0',
            }}>
            {words.map((w: string, i: number) => (
              <span key={i} className="overflow-hidden inline-block mr-[0.22em]">
                <span className="inline-block"
                  style={{ animation: soloVis ? `cf-word-up 0.85s cubic-bezier(0.16,1,0.3,1) ${0.15 + i * 0.12}s both` : 'none' }}>
                  {w}
                </span>
              </span>
            ))}
          </h2>

          {/* Accent line when nothing else follows */}
          {!showSpecs && !hasBelow && (
            <div className="mt-5"
              style={{ animation: soloVis ? 'cf-line-grow 0.8s 0.55s both' : 'none' }}>
              <div className="h-px w-24" style={{ background: `linear-gradient(to right, ${ac(style)}90, transparent)` }}/>
            </div>
          )}

          {/* Specialties */}
          {showSpecs && (
            <div className="flex flex-wrap gap-2" style={{ marginBottom: hasBelow ? '20px' : '0' }}>
              {solo.specialties.map((s: string, i: number) => (
                <span key={i}
                  className="px-3 md:px-4 py-1.5 text-[10px] font-black uppercase tracking-widest"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: 'rgba(255,255,255,0.72)',
                    borderRadius: br(style, 3),
                    backdropFilter: 'blur(8px)',
                    animation: soloVis ? `cf-float-up 0.5s ${0.45 + i * 0.07}s both` : 'none',
                  }}>
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* Divider between specs and bio */}
          {showSpecs && showBio && (
            <div className="mb-5 h-px w-12" style={{ background: 'rgba(255,255,255,0.12)' }}/>
          )}

          {/* Bio */}
          {showBio && (
            <p className="text-sm md:text-base leading-relaxed max-w-sm"
              style={{
                color: 'rgba(255,255,255,0.52)',
                fontFamily: bf(style),
                marginBottom: showBtn ? '24px' : '0',
                animation: soloVis ? 'cf-fade-up 0.7s 0.5s both' : 'none',
              }}>
              {solo.bio}
            </p>
          )}

          {/* Book button */}
          {showBtn && (
            <div style={{ animation: soloVis ? 'cf-float-up 0.9s cubic-bezier(0.34,1.56,0.64,1) 0.6s both' : 'none' }}>
              <button
                onClick={e => { e.stopPropagation(); openBooking(); }}
                className="inline-flex items-center gap-3 px-8 md:px-10 py-3.5 md:py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.04] active:scale-[0.97] transition-transform"
                style={{
                  background: ac(style), color: '#fff',
                  borderRadius: br(style), fontFamily: bf(style),
                  boxShadow: `0 0 50px ${ac(style)}45, 0 16px 40px rgba(0,0,0,0.4)`,
                }}>
                {config.bookCta || 'Book with me'}
                <ArrowRight className="w-4 h-4"/>
              </button>
            </div>
          )}
        </div>

        <div className="absolute bottom-8 right-10 hidden md:flex flex-col items-center gap-2 opacity-30 pointer-events-none"
          style={{ animation: soloVis ? 'cf-fade-in 1s 1s both' : 'none' }}>
          <div className="w-px h-10 bg-white" style={{ animation: 'cf-count-up 2s ease-in-out infinite alternate' }}/>
          <span className="text-[8px] font-black uppercase tracking-[0.3em] text-white" style={{ writingMode: 'vertical-rl' }}>Scroll</span>
        </div>
      </section>
    );
  }

  // ── SOLO MAGAZINE ──────────────────────────────────────────────────────────
  if (layout === 'solo-magazine') {
    const solo      = staff[0];
    const showBio   = !!(config.showBio && solo?.bio);
    const showBtn   = !!config.showBookButton;
    const showSpecs = !!(config.showSpecialties !== false && solo?.specialties?.length > 0);
    const sparse    = !showBio && !showSpecs;

    return (
      <section id="team" ref={soloRef} className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <Header/>
          {solo ? (
            <div className="grid md:grid-cols-[1.1fr_1fr] overflow-hidden shadow-2xl"
              style={{ borderRadius: br(style, 2) }}>

              {/* Portrait */}
              <div className="relative overflow-hidden" style={{ aspectRatio: '3/4' }}>
                {solo.avatarUrl
                  ? <img src={solo.avatarUrl} alt={solo.name}
                      className="absolute inset-0 w-full h-full object-cover object-top"
                      style={{
                        transform: soloVis ? 'scale(1)' : 'scale(1.06)',
                        transition: 'transform 1.4s cubic-bezier(0.16,1,0.3,1)',
                      }}/>
                  : <div className="absolute inset-0 flex items-center justify-center"
                      style={{ background: `${ac(style)}0e` }}>
                      <span className="font-light select-none"
                        style={{ fontSize: 'clamp(80px,18vw,160px)', fontFamily: hf(style), color: ac(style) + '20', lineHeight: 1 }}>
                        {solo.name?.[0]}
                      </span>
                    </div>}

                {/* Vertical label — desktop only */}
                <div className="absolute left-3 inset-y-0 hidden md:flex items-center pointer-events-none"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                    fontSize: '9px', fontWeight: 900, letterSpacing: '0.4em',
                    color: 'rgba(255,255,255,0.16)', textTransform: 'uppercase', fontFamily: bf(style) }}>
                  {config.heading || 'The Artist'}
                </div>

                {/* Bottom gradient + specialty chips */}
                <div className="absolute bottom-0 inset-x-0"
                  style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.08) 65%, transparent 100%)' }}>
                  {showSpecs && (
                    <div className="flex flex-wrap gap-1.5 p-4 md:p-6">
                      {solo.specialties.map((s: string, i: number) => (
                        <span key={i}
                          className="px-3 py-1 text-[9px] font-black uppercase tracking-widest"
                          style={{
                            background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
                            border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.82)',
                            borderRadius: br(style, 2),
                            animation: soloVis ? `cf-fade-up 0.5s ${0.2 + i * 0.08}s both` : 'none',
                          }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {!showSpecs && <div className="h-6"/>}
                </div>
              </div>

              {/* Editorial panel */}
              <div className="bg-white flex flex-col p-6 md:p-10 lg:p-12"
                style={{ justifyContent: sparse && !showBtn ? 'center' : 'space-between' }}>

                {/* Top block */}
                <div style={{ animation: soloVis ? 'cf-fade-up 0.6s 0.1s both' : 'none' }}>
                  <div className="flex items-baseline gap-2 mb-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.45em]"
                      style={{ color: ac(style) + '55', fontFamily: bf(style) }}>Vol. I</p>
                    <div className="h-px flex-1" style={{ background: ac(style) + '18' }}/>
                  </div>

                  <h2 className="font-light leading-[0.9]"
                    style={{
                      fontSize: sparse ? 'clamp(28px,6vw,52px)' : 'clamp(22px,4vw,40px)',
                      fontFamily: hf(style), color: '#0f172a',
                    }}>
                    {solo.name}
                  </h2>

                  {sparse && (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-[0.3em]"
                      style={{ color: ac(style), fontFamily: bf(style) }}>
                      {config.heading || 'The Artist'}
                    </p>
                  )}

                  <div className="mt-4 h-px"
                    style={{ background: ac(style) + '20', animation: soloVis ? 'cf-line-grow 0.8s 0.3s both' : 'none' }}/>
                </div>

                {/* Middle */}
                {showBio ? (
                  <p className="mt-5 text-sm text-slate-500 leading-relaxed flex-1"
                    style={{ fontFamily: bf(style), animation: soloVis ? 'cf-fade-up 0.7s 0.4s both' : 'none' }}>
                    {solo.bio}
                  </p>
                ) : sparse ? (
                  <div className="flex-1 flex items-center pointer-events-none select-none py-2"
                    style={{ animation: soloVis ? 'cf-fade-in 1s 0.5s both' : 'none' }}>
                    <span className="font-light"
                      style={{ fontSize: 'clamp(80px,12vw,120px)', fontFamily: hf(style), color: ac(style) + '10', lineHeight: 1 }}>
                      01
                    </span>
                  </div>
                ) : null}

                {/* Book button */}
                {showBtn && (
                  <div className="mt-6 space-y-3"
                    style={{ animation: soloVis ? 'cf-fade-up 0.7s 0.5s both' : 'none' }}>
                    <div className="h-px" style={{ background: ac(style) + '12' }}/>
                    <button
                      onClick={e => { e.stopPropagation(); openBooking(); }}
                      className="w-full py-3.5 md:py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                      style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                      {config.bookCta || 'Book an appointment'}
                      <ArrowRight className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : <p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Artist profile coming soon</p>}
        </div>
      </section>
    );
  }

  // ── SOLO SPOTLIGHT ─────────────────────────────────────────────────────────
  if (layout === 'solo-spotlight') {
    const solo      = staff[0];
    const showBio   = !!(config.showBio && solo?.bio);
    const showBtn   = !!config.showBookButton;
    const showSpecs = !!(config.showSpecialties !== false && solo?.specialties?.length > 0);

    return (
      <section id="team" ref={soloRef} className={py(style)}
        style={{ background: '#f8fafc', position: 'relative', overflow: 'hidden' }}>

        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 60% 50% at 50% 35%, ${ac(style)}09 0%, transparent 65%)` }}/>

        <div className="relative max-w-xl mx-auto px-6 md:px-10 text-center">
          <Header/>
          {solo ? (
            <div className="flex flex-col items-center">

              {/* Halo + portrait — padding absorbs ring overflow so nothing clips on mobile */}
              <div className="relative inline-flex items-center justify-center"
                style={{
                  padding: 'clamp(28px, 7vw, 44px)',
                  marginBottom: 'clamp(24px, 5vw, 36px)',
                  animation: soloVis ? 'cf-scale-up 0.8s cubic-bezier(0.16,1,0.3,1) 0.05s both' : 'none',
                }}>

                {/* Outer conic ring */}
                <div className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    background: `conic-gradient(from 0deg, ${ac(style)}06, ${ac(style)}18, ${ac(style)}04, ${ac(style)}18, ${ac(style)}06)`,
                    animation: 'cf-drift-c 22s linear infinite',
                  }}/>

                {/* Dashed ring */}
                <div className="absolute rounded-full pointer-events-none"
                  style={{
                    inset: 'clamp(10px, 2.5vw, 14px)',
                    border: `1.5px dashed ${ac(style)}20`,
                    borderRadius: '50%',
                    animation: 'cf-drift-a 14s ease-in-out infinite',
                  }}/>

                {/* Portrait */}
                <div className="relative overflow-hidden"
                  style={{
                    width: 'clamp(130px, 38vw, 180px)',
                    height: 'clamp(130px, 38vw, 180px)',
                    borderRadius: '50%',
                    border: `2.5px solid ${ac(style)}30`,
                    boxShadow: `0 0 0 5px ${ac(style)}07, 0 0 0 12px ${ac(style)}04, 0 20px 56px ${ac(style)}20, 0 6px 20px rgba(0,0,0,0.09)`,
                    zIndex: 1,
                  }}>
                  {solo.avatarUrl
                    ? <img src={solo.avatarUrl} alt={solo.name}
                        className="w-full h-full object-cover object-top"
                        style={{
                          transform: soloVis ? 'scale(1)' : 'scale(1.1)',
                          transition: 'transform 1s cubic-bezier(0.16,1,0.3,1)',
                        }}/>
                    : <div className="w-full h-full flex items-center justify-center"
                        style={{ background: `${ac(style)}14` }}>
                        <span className="text-4xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>
                          {solo.name?.[0]}
                        </span>
                      </div>}
                </div>
              </div>

              {/* Name */}
              <div style={{
                marginBottom: showSpecs || showBio || showBtn ? 'clamp(16px,3vw,24px)' : '0',
                animation: soloVis ? 'cf-fade-up 0.7s 0.25s both' : 'none',
              }}>
                <h2 className="font-light"
                  style={{
                    fontSize: !showSpecs && !showBio && !showBtn
                      ? 'clamp(32px,7vw,54px)'
                      : 'clamp(26px,5.5vw,44px)',
                    fontFamily: hf(style), color: '#0f172a', lineHeight: 1.0,
                    marginBottom: '12px',
                  }}>
                  {solo.name}
                </h2>
                <div className="flex items-center justify-center gap-2.5">
                  <div className="h-px w-8 md:w-10"
                    style={{ background: ac(style) + '35', animation: soloVis ? 'cf-line-grow 0.6s 0.4s both' : 'none' }}/>
                  <div className="w-1.5 h-1.5 rounded-full"
                    style={{ background: ac(style), animation: soloVis ? 'cf-scale-up 0.4s 0.5s both' : 'none' }}/>
                  <div className="h-px w-8 md:w-10"
                    style={{ background: ac(style) + '35', animation: soloVis ? 'cf-line-grow 0.6s 0.4s both' : 'none' }}/>
                </div>
              </div>

              {/* Specialties */}
              {showSpecs && (
                <div className="flex flex-wrap gap-2 justify-center w-full"
                  style={{ marginBottom: showBio || showBtn ? 'clamp(16px,3vw,22px)' : '0' }}>
                  {solo.specialties.map((s: string, i: number) => (
                    <span key={i}
                      className="px-3 md:px-4 py-1.5 md:py-2 text-[10px] font-black uppercase tracking-widest"
                      style={{
                        background: `${ac(style)}0e`, color: ac(style),
                        border: `1.5px solid ${ac(style)}22`, borderRadius: br(style, 3),
                        animation: soloVis
                          ? `cf-float-up 0.6s cubic-bezier(0.34,1.56,0.64,1) ${0.35 + i * 0.08}s both`
                          : 'none',
                      }}>
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Bio */}
              {showBio && (
                <p className="text-sm md:text-base text-slate-500 leading-relaxed max-w-sm mx-auto w-full"
                  style={{
                    fontFamily: bf(style),
                    marginBottom: showBtn ? 'clamp(16px,3vw,24px)' : '0',
                    animation: soloVis ? 'cf-fade-up 0.7s 0.5s both' : 'none',
                  }}>
                  {solo.bio}
                </p>
              )}

              {/* Book button */}
              {showBtn && (
                <div style={{
                  animation: soloVis ? 'cf-float-up 0.9s cubic-bezier(0.34,1.56,0.64,1) 0.6s both' : 'none',
                  display: 'flex', justifyContent: 'center', width: '100%',
                }}>
                  <button
                    onClick={e => { e.stopPropagation(); openBooking(); }}
                    className="inline-flex items-center justify-center gap-2 font-black uppercase tracking-widest hover:scale-[1.04] active:scale-[0.97] transition-transform whitespace-nowrap"
                    style={{
                      background: ac(style), color: '#fff',
                      borderRadius: br(style, 3), fontFamily: bf(style),
                      fontSize: 'clamp(10px, 2.5vw, 13px)',
                      padding: 'clamp(12px, 3.5vw, 16px) clamp(28px, 8vw, 48px)',
                      boxShadow: `0 12px 40px ${ac(style)}28, 0 4px 12px ${ac(style)}16`,
                      maxWidth: '100%',
                    }}>
                    {config.bookCta || 'Book with me'}
                    <ArrowRight style={{ width: 14, height: 14, flexShrink: 0 }}/>
                  </button>
                </div>
              )}

            </div>
          ) : <p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Artist profile coming soon</p>}
        </div>
      </section>
    );
  }

if (layout === 'solo-hero') {
    const solo      = staff[0];
    const showBio   = !!(config.showBio && solo?.bio);
    const showBtn   = !!config.showBookButton;
    const showSpecs = !!(config.showSpecialties !== false && solo?.specialties?.length > 0);
 
    return (
      <section id="team" className="relative overflow-hidden"
        style={{ background: style.bgColor, minHeight: 'clamp(520px, 80vh, 900px)' }}>
 
        {/* Subtle accent wash behind content side */}
        <div className="absolute inset-y-0 left-0 w-full md:w-[48%] pointer-events-none"
          style={{ background: `${ac(style)}04` }}/>
 
        <div className="absolute inset-0 grid md:grid-cols-[1fr_1.15fr]">
 
          {/* ── Content panel (left) ── */}
          <div className="relative z-10 flex flex-col justify-center
                          px-8 md:px-12 lg:px-20
                          pt-24 pb-16 md:py-0
                          order-2 md:order-1">
 
            {/* Eyebrow */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8" style={{ background: ac(style) }}/>
              <span className="text-[10px] font-black uppercase tracking-[0.35em]"
                style={{ color: ac(style), fontFamily: bf(style) }}>
                {config.heading || 'The Artist'}
              </span>
            </div>
 
            {/* Name — the hero element */}
            <h2 className="font-light leading-[0.87] mb-6"
              style={{
                fontFamily: hf(style),
                color: '#0f172a',
                fontSize: 'clamp(44px, 7vw, 88px)',
              }}>
              {solo?.name || 'Artist Name'}
            </h2>
 
            {/* Thick accent rule */}
            <div className="h-[3px] w-14 mb-8" style={{ background: ac(style) }}/>
 
            {/* Specialties */}
            {showSpecs && (
              <div className="flex flex-wrap gap-2 mb-7">
                {solo.specialties.map((s: string, i: number) => (
                  <span key={i}
                    className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                    style={{
                      background: `${ac(style)}0e`,
                      color: ac(style),
                      border: `1.5px solid ${ac(style)}22`,
                      borderRadius: br(style, 3),
                      fontFamily: bf(style),
                    }}>
                    {s}
                  </span>
                ))}
              </div>
            )}
 
            {/* Bio */}
            {showBio && (
              <p className="text-base text-slate-500 leading-relaxed max-w-sm mb-8"
                style={{ fontFamily: bf(style) }}>
                {solo.bio}
              </p>
            )}
 
            {/* Book button */}
            {showBtn && (
              <div>
                <button
                  onClick={e => { e.stopPropagation(); openBooking(); }}
                  className="inline-flex items-center gap-3 font-black text-sm uppercase tracking-widest
                             hover:scale-[1.03] active:scale-[0.97] transition-transform
                             whitespace-nowrap"
                  style={{
                    ...btnStyle(style),
                    fontFamily: bf(style),
                    padding: '14px 36px',
                    boxShadow: `0 12px 40px ${ac(style)}28`,
                  }}>
                  {config.bookCta || 'Book with me'}
                  <ArrowRight className="w-4 h-4 shrink-0"/>
                </button>
              </div>
            )}
          </div>
 
          {/* ── Portrait panel (right) ── */}
          <div className="relative overflow-hidden order-1 md:order-2"
            style={{
              // Mobile: fixed aspect ratio. Desktop: fills the grid cell height.
              aspectRatio: '4/3',
              minHeight: 0,
            }}>
            <style>{`@media (min-width: 768px) {
              .solo-hero-portrait { aspect-ratio: unset !important; position: absolute; inset: 0; }
            }`}</style>
            <div className="solo-hero-portrait relative w-full h-full"
              style={{ aspectRatio: '4/3' }}>
              {solo?.avatarUrl
                ? <img
                    src={solo.avatarUrl}
                    alt={solo?.name || ''}
                    className="w-full h-full object-cover object-top"
                    style={{ transform: 'scale(1.01)' }}
                  />
                : <div className="absolute inset-0 flex items-center justify-center"
                    style={{ background: `${ac(style)}0a` }}>
                    <span className="font-light select-none pointer-events-none"
                      style={{ fontSize: 'clamp(80px, 18vw, 160px)', fontFamily: hf(style),
                        color: ac(style) + '20', lineHeight: 1 }}>
                      {solo?.name?.[0] ?? 'A'}
                    </span>
                  </div>}
 
              {/* Gradient bleed into content panel — desktop only */}
              <div className="absolute inset-y-0 left-0 w-16 hidden md:block"
                style={{ background: `linear-gradient(to right, ${style.bgColor}, transparent)` }}/>
              {/* Bottom gradient on mobile */}
              <div className="absolute bottom-0 inset-x-0 h-24 md:hidden"
                style={{ background: `linear-gradient(to top, ${style.bgColor}, transparent)` }}/>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (layout === 'solo-card') {
    const solo      = staff[0];
    const showBio   = !!(config.showBio && solo?.bio);
    const showBtn   = !!config.showBookButton;
    const showSpecs = !!(config.showSpecialties !== false && solo?.specialties?.length > 0);
 
    return (
      <section id="team" className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-sm mx-auto px-6 md:px-0">
          <Header/>
          {solo ? (
            <div className="bg-white overflow-hidden"
              style={{
                borderRadius: br(style, 2),
                border: `1.5px solid ${ac(style)}18`,
                boxShadow: `0 32px 80px rgba(0,0,0,0.12), 0 0 0 6px ${ac(style)}06`,
              }}>
 
              {/* Portrait with mat-frame treatment */}
              <div className="relative overflow-hidden m-3"
                style={{
                  aspectRatio: '3/4',
                  borderRadius: `${Math.max((style.borderRadius || 4) - 2, 2)}px`,
                  background: `${ac(style)}0a`,
                }}>
                {solo.avatarUrl
                  ? <img
                      src={solo.avatarUrl}
                      alt={solo.name}
                      className="w-full h-full object-cover object-top"
                    />
                  : <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-light select-none"
                        style={{ fontSize: 'clamp(60px,22vw,100px)',
                          fontFamily: hf(style), color: ac(style) + '22', lineHeight: 1 }}>
                        {solo.name?.[0]}
                      </span>
                    </div>}
 
                {/* Photography mat inner border */}
                <div className="absolute inset-[8px] pointer-events-none"
                  style={{ border: '1px solid rgba(255,255,255,0.30)', borderRadius: '2px' }}/>
 
                {/* Bottom gradient */}
                <div className="absolute bottom-0 inset-x-0"
                  style={{ height: '40%', background: 'linear-gradient(to top, rgba(0,0,0,0.60) 0%, transparent 100%)' }}/>
 
                {/* Name overlaid on portrait bottom */}
                <div className="absolute bottom-0 inset-x-0 px-5 pb-4 text-center">
                  <h2 className="font-light text-white leading-tight"
                    style={{
                      fontFamily: hf(style),
                      fontSize: 'clamp(20px, 6vw, 28px)',
                    }}>
                    {solo.name}
                  </h2>
                </div>
              </div>
 
              {/* Card body below portrait */}
              <div className="px-6 pb-6 pt-4 space-y-4">
 
                {/* Accent rule + specialties */}
                {showSpecs ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1" style={{ background: `${ac(style)}18` }}/>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: ac(style) }}/>
                      <div className="h-px flex-1" style={{ background: `${ac(style)}18` }}/>
                    </div>
                    <p className="text-center text-[10px] font-black uppercase tracking-widest"
                      style={{ color: ac(style), fontFamily: bf(style) }}>
                      {solo.specialties.slice(0, 3).join(' · ')}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1" style={{ background: `${ac(style)}18` }}/>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: `${ac(style)}40` }}/>
                    <div className="h-px flex-1" style={{ background: `${ac(style)}18` }}/>
                  </div>
                )}
 
                {/* Bio */}
                {showBio && (
                  <p className="text-sm text-slate-500 leading-relaxed text-center"
                    style={{ fontFamily: bf(style) }}>
                    {solo.bio}
                  </p>
                )}
 
                {/* Book button */}
                {showBtn && (
                  <button
                    onClick={e => { e.stopPropagation(); openBooking(); }}
                    className="w-full py-4 font-black text-sm uppercase tracking-widest
                               hover:opacity-90 active:scale-[0.99] transition-all
                               whitespace-nowrap overflow-hidden"
                    style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                    {config.bookCta || 'Book an appointment'}
                  </button>
                )}
              </div>
            </div>
          ) : <p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Artist profile coming soon</p>}
        </div>
      </section>
    );
  }
 

  if (layout === 'solo-split') {
    const solo = staff[0];
    return (
      <section id="team" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <Header/>
          {solo ? (
            <div className="grid md:grid-cols-[1.2fr_1fr] gap-0 overflow-hidden shadow-2xl" style={{ borderRadius: br(style,2) }}>
              <div className="relative overflow-hidden" style={{ aspectRatio: '4/5', background: ac(style)+'12' }}>
                {solo.avatarUrl ? <img src={solo.avatarUrl} alt={solo.name} className="absolute inset-0 w-full h-full object-cover object-top"/> : <div className="absolute inset-0 flex items-center justify-center"><span className="text-[180px] font-light opacity-10" style={{ fontFamily: hf(style), color: ac(style) }}>{solo.name?.[0]}</span></div>}
              </div>
              <div className="bg-white p-8 md:p-12 flex flex-col justify-center space-y-6">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] mb-2" style={{ color: ac(style) }}>{config.heading || 'The Artist'}</p>
                  <h2 className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{solo.name}</h2>
                </div>
                <div className="w-10 h-px" style={{ background: ac(style) }}/>
                {config.showSpecialties !== false && solo.specialties?.length > 0 && <div className="flex flex-wrap gap-2">{solo.specialties.map((s: string, i: number) => <span key={i} className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border" style={{ color: '#64748b', borderColor: ac(style)+'25', borderRadius: br(style) }}>{s}</span>)}</div>}
                {config.showBio && solo.bio && <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{solo.bio}</p>}
                {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="inline-flex items-center gap-2 px-8 py-4 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 transition-all w-fit" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book with me'} <ArrowRight className="w-3.5 h-3.5"/></button>}
              </div>
            </div>
          ) : <p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Artist profile coming soon</p>}
        </div>
      </section>
    );
  }

  return (
    <section id="team" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><Header/>
        <div className="max-w-lg mx-auto space-y-0">
          {staff.map((m: any, idx: number) => (
            <div key={m.id} className="flex items-center gap-4 py-4" style={{ borderBottom: idx < staff.length - 1 ? `1px solid ${ac(style)}18` : 'none' }}>
              <div className="w-10 h-10 rounded-full overflow-hidden shrink-0" style={{ background: ac(style) + '15' }}>
                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>
                  : <span className="w-full h-full flex items-center justify-center text-sm font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{m.name?.[0]}</span>}
              </div>
              <div className="flex-1">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{m.name}</p>
                {config.showSpecialties !== false && m.specialties?.length > 0 && <p className="text-[10px] text-slate-400 uppercase tracking-wider">{m.specialties.slice(0, 2).join(' · ')}</p>}
              </div>
              {config.showBookButton && <button onClick={e => { e.stopPropagation(); openBooking(); }} className="shrink-0 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.bookCta || 'Book'}</button>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
// ─── ReviewsSection ───────────────────────────────────────────────────────────
function ReviewsSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'grid';
  const accent = ac(style);
  const { ref, visible } = useInView(0.06);
 
  const showHeading    = config.showHeading    !== false;
  const showSubheading = config.showSubheading !== false;
 
  const Header = () => (showHeading || showSubheading) ? (
    <div className="text-center space-y-3 mb-10 md:mb-14">
      {showHeading && (
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h2" className="font-light"
          style={{ fontFamily: hf(style), fontSize: 'clamp(26px,5vw,56px)', color: '#0f172a' }}>
          {config.heading || 'What Clients Say'}
        </FieldTap>
      )}
      {showSubheading && config.subheading && (
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="font-light leading-relaxed mx-auto"
          style={{ fontFamily: bf(style), color: '#64748b',
            fontSize: 'clamp(14px,1.8vw,16px)', maxWidth: '32rem' }}>
          {config.subheading}
        </FieldTap>
      )}
    </div>
  ) : null;
 
  const reviews = [
    { name: config.rev1Name || 'Sarah M.',   rating: config.rev1Rating ?? 5, text: config.rev1Text || 'Absolutely incredible experience.' },
    { name: config.rev2Name || 'Jessica T.', rating: config.rev2Rating ?? 5, text: config.rev2Text || 'Every visit exceeds my expectations.' },
    { name: config.rev3Name || 'Priya K.',   rating: config.rev3Rating ?? 5, text: config.rev3Text || 'Luxurious yet so welcoming.' },
  ].filter(r => r.text);
 
  const Stars = ({ count, light = false }: { count: number; light?: boolean }) => (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ color: i < count ? (light ? '#fbbf24' : accent) : 'rgba(0,0,0,0.14)', fontSize: 13 }}>★</span>
      ))}
    </div>
  );
 
  if (layout === 'grid') {
    return (
      <section id="reviews" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
            {reviews.map((r, i) => (
              <div key={i}
                className="flex flex-col p-5 md:p-6 space-y-4"
                style={{
                  border: `1.5px solid ${accent}12`, borderRadius: br(style, 2), background: '#fff',
                  animation: visible ? `cf-fade-up 0.55s ${i * 0.1}s both` : 'none',
                }}>
                {config.showRating !== false && <Stars count={r.rating}/>}
                <p className="text-sm text-slate-600 leading-relaxed flex-1 font-light italic"
                  style={{ fontFamily: bf(style) }}>
                  "{r.text}"
                </p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                  style={{ fontFamily: bf(style) }}>{r.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  if (layout === 'quotes') {
    return (
      <section id="reviews" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-3xl mx-auto" style={{ padding: '0 clamp(20px,7vw,80px)' }}>
          <Header/>
          <div ref={ref} className="space-y-12 md:space-y-16">
            {reviews.map((r, i) => (
              <div key={i} className="text-center space-y-5"
                style={{ animation: visible ? `cf-fade-up 0.7s ${i * 0.15}s both` : 'none' }}>
                {/* Large quote mark */}
                <div className="font-light select-none" style={{ fontFamily: hf(style), fontSize: 80, color: `${accent}20`, lineHeight: 0.8 }}>
                  "
                </div>
                <p className="font-light leading-relaxed text-slate-700"
                  style={{ fontFamily: hf(style), fontSize: 'clamp(16px,2.5vw,22px)' }}>
                  {r.text}
                </p>
                {config.showRating !== false && <div className="flex justify-center"><Stars count={r.rating}/></div>}
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400"
                  style={{ fontFamily: bf(style) }}>{r.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // carousel
  return (
    <section id="reviews" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto">
        <div style={{ padding: '0 clamp(16px,5vw,64px)' }}><Header/></div>
        <div ref={ref}
          className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory"
          style={{ padding: '0 clamp(16px,5vw,64px)', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {reviews.map((r, i) => (
            <div key={i}
              className="flex flex-col shrink-0 snap-start p-5 space-y-4"
              style={{
                width: 'clamp(260px,75vw,320px)',
                border: `1.5px solid ${accent}12`, borderRadius: br(style, 2), background: '#fff',
                animation: visible ? `cf-fade-up 0.5s ${i * 0.08}s both` : 'none',
              }}>
              {config.showRating !== false && <Stars count={r.rating}/>}
              <p className="text-sm text-slate-600 leading-relaxed flex-1 font-light italic"
                style={{ fontFamily: bf(style) }}>"{r.text}"</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                style={{ fontFamily: bf(style) }}>{r.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── GallerySection ───────────────────────────────────────────────────────────
function GallerySection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [lb, setLb] = useState<string|null>(null);
  const uploaded: any[] = Array.isArray(config.images) ? config.images : [];
  const layout = config.layout || 'grid', cols = parseInt(config.columns) || 3;
  const gridCls = cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3';
  const shades = ['08','10','14','18','12','16','0a','16','20','12'];
  const imgs = uploaded.length > 0 ? uploaded : shades.map((s,i) => ({ id:i, url:null, caption:'', shade:s }));
  const hCls = config.hoverEffect === 'fade' ? 'group-hover:opacity-60 transition-opacity duration-500' : config.hoverEffect === 'none' ? '' : 'group-hover:scale-110 transition-transform duration-700';
  const H = () => <div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Work'}</FieldTap>{config.subheading && <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</FieldTap>}</div>;
  const Lb = () => lb ? (<div className="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center p-4" onClick={() => setLb(null)}><button className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"><XIcon className="w-8 h-8"/></button><img src={lb} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={e => e.stopPropagation()}/></div>) : null;
  if (layout === 'carousel') return (<section className={py(style)} style={{ background: '#f8fafc' }}><div className="max-w-6xl mx-auto px-6 md:px-16"><H/><div className="flex gap-4 overflow-x-auto pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>{imgs.map((img:any,i:number) => <div key={i} className="shrink-0 snap-start overflow-hidden group cursor-pointer" style={{ width:'280px', height:'350px', borderRadius: br(style) }} onClick={() => img.url && config.lightbox !== false && setLb(img.url)}>{img.url ? <img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/> : <div className="w-full h-full" style={{ background: ac(style)+img.shade }}/>}</div>)}</div></div><Lb/></section>);

  if (layout === 'bento') {
    const bentoImgs = imgs.slice(0, 9);
    const bentoPattern = ['col-span-2 row-span-2','col-span-1 row-span-1','col-span-1 row-span-1','col-span-1 row-span-1','col-span-1 row-span-1','col-span-1 row-span-2','col-span-2 row-span-1','col-span-1 row-span-1','col-span-1 row-span-1'];
    return (
      <section className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16"><H/>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-3 auto-rows-[180px] md:auto-rows-[200px]">
            {bentoImgs.map((img:any, i:number) => (
              <div key={img.id??i} className={cn('overflow-hidden group cursor-pointer relative', bentoPattern[i] || 'col-span-1 row-span-1')} style={{ borderRadius: br(style, 2) }}
                   onClick={() => img.url && config.lightbox !== false && setLb(img.url)}>
                {img.url
                  ? <><img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/><div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-400"/>{config.showCaptions && img.caption && <div className="absolute bottom-0 inset-x-0 px-4 py-3 bg-gradient-to-t from-black/70 to-transparent text-white text-[11px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{img.caption}</div>}</>
                  : <div className="w-full h-full" style={{ background: ac(style)+img.shade }}/>}
              </div>
            ))}
          </div>
        </div><Lb/>
      </section>
    );
  }

  if (layout === 'spotlight') {
    const [hero, ...rest] = imgs;
    return (
      <section className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16"><H/>
          <div className="space-y-3">
            {hero && (
              <div className="relative overflow-hidden group cursor-pointer w-full" style={{ height: '480px', borderRadius: br(style, 2) }}
                   onClick={() => hero.url && config.lightbox !== false && setLb(hero.url)}>
                {hero.url
                  ? <><img src={hero.url} alt={hero.caption||''} className={`w-full h-full object-cover ${hCls}`}/><div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-all"/>{config.showCaptions && hero.caption && <div className="absolute bottom-0 inset-x-0 px-8 py-6 bg-gradient-to-t from-black/70 to-transparent"><p className="text-white text-sm font-black uppercase tracking-widest">{hero.caption}</p></div>}</>
                  : <div className="w-full h-full" style={{ background: ac(style)+hero.shade }}/>}
                <div className="absolute top-4 left-4 px-3 py-1 text-[9px] font-black uppercase tracking-[0.3em] text-white" style={{ background: ac(style), borderRadius: br(style) }}>Featured</div>
              </div>
            )}
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {rest.map((img:any, i:number) => (
                <div key={img.id??i} className="overflow-hidden group cursor-pointer aspect-square relative" style={{ borderRadius: br(style) }}
                     onClick={() => img.url && config.lightbox !== false && setLb(img.url)}>
                  {img.url ? <img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/> : <div className="w-full h-full" style={{ background: ac(style)+img.shade }}/>}
                </div>
              ))}
            </div>
          </div>
        </div><Lb/>
      </section>
    );
  }

  if (layout === 'polaroid') return (
    <section className={cn(py(style), 'overflow-hidden')} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16"><H/>
        <div className="flex flex-wrap justify-center gap-6 md:gap-8">
          {imgs.map((img:any, i:number) => {
            const rotations = [-3, 1.5, -1, 2.5, -2, 1, -1.5, 2, -0.5, 1.8, -2.2, 0.8];
            const rot = rotations[i % rotations.length];
            return (
              <div key={img.id??i} className="group cursor-pointer bg-white shadow-xl hover:shadow-2xl transition-all duration-400 hover:-translate-y-3 p-3 pb-10"
                   style={{ borderRadius: '4px', transform: `rotate(${rot}deg)`, transformOrigin: 'center' }}
                   onClick={() => img.url && config.lightbox !== false && setLb(img.url)}>
                <div className="overflow-hidden" style={{ width: 180, height: 200, background: ac(style)+(img.shade||'10') }}>
                  {img.url ? <img src={img.url} alt={img.caption||''} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-600"/> : <div className="w-full h-full"/>}
                </div>
                {config.showCaptions && img.caption && <p className="mt-3 text-center text-xs text-slate-500" style={{ fontFamily: 'cursive', fontSize: '13px' }}>{img.caption}</p>}
              </div>
            );
          })}
        </div>
      </div><Lb/>
    </section>
  );

  if (layout === 'filmstrip') return (
    <section className={py(style)} style={{ background: '#0c0c0e' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-12 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light text-white" style={{ fontFamily: hf(style) }}>{config.heading || 'Our Work'}</FieldTap>
          {config.subheading && <p className="text-base text-white/50" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="border-y-2 py-4" style={{ borderColor: ac(style)+'40' }}>
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {[...imgs,...imgs].map((img:any, i:number) => (
              <div key={i} className="shrink-0 overflow-hidden group cursor-pointer relative" style={{ width: 220, height: 300, borderRadius: br(style) }}
                   onClick={() => img.url && config.lightbox !== false && setLb(img.url)}>
                {img.url
                  ? <><img src={img.url} alt={img.caption||''} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/><div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"/></>
                  : <div className="w-full h-full" style={{ background: ac(style)+img.shade+'aa' }}/>}
                <div className="absolute top-2 left-2 text-[9px] font-black uppercase tracking-widest text-white/40">{String(i % imgs.length + 1).padStart(2,'0')}</div>
              </div>
            ))}
          </div>
        </div>
      </div><Lb/>
    </section>
  );

  return (<section className={py(style)} style={{ background: '#f8fafc' }}><div className="max-w-6xl mx-auto px-6 md:px-16"><H/><div className={`grid ${gridCls} gap-3`}>{imgs.map((img:any,i:number) => <div key={img.id??i} className={cn('overflow-hidden group cursor-pointer aspect-square', layout === 'masonry' && (i===0||i===5) ? 'row-span-2' : '')} style={{ borderRadius: br(style) }} onClick={() => img.url && config.lightbox !== false && setLb(img.url)}>{img.url ? (<div className="relative h-full"><img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/>{config.showCaptions && img.caption && <div className="absolute bottom-0 inset-x-0 px-3 py-2 bg-black/50 text-white text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{img.caption}</div>}</div>) : <div className="w-full h-full" style={{ background: ac(style)+img.shade }}/>}</div>)}</div></div><Lb/></section>);
}
// ─── BeforeAfterSlider ────────────────────────────────────────────────────────
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
    <div ref={containerRef} className="relative overflow-hidden select-none"
         style={{ borderRadius: br(style), aspectRatio: '4/3', cursor: 'ew-resize' }}
         onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}
         onMouseDown={e => { setIsDragging(true); moveTo(e.clientX); e.preventDefault(); }}
         onTouchStart={e => { setIsDragging(true); moveTo(e.touches[0].clientX); }}>
      <div className="absolute inset-0">
        {hasBefore ? <img src={pair.beforeUrl} alt="Before" className="w-full h-full object-cover" draggable={false}/>
          : <div className="w-full h-full bg-slate-100 flex items-center justify-center"><span className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-300">Before</span></div>}
      </div>
      <div className="absolute inset-0 pointer-events-none"
           style={{ clipPath: `inset(0 0 0 ${pct}%)`, transition: isDragging ? 'none' : 'clip-path 0.04s ease' }}>
        {hasAfter ? <img src={pair.afterUrl} alt="After" className="w-full h-full object-cover" draggable={false}/>
          : <div className="w-full h-full flex items-center justify-center" style={{ background: ac(style) + '18' }}><span className="text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: ac(style) + 'aa' }}>After</span></div>}
      </div>
      <div className="absolute top-0 bottom-0 pointer-events-none"
           style={{ left: `${pct}%`, width: '2px', transform: 'translateX(-50%)', background: 'white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15), 0 4px 20px rgba(0,0,0,0.3)', transition: isDragging ? 'none' : 'left 0.04s ease' }}/>
      <div className="absolute top-1/2 pointer-events-none"
           style={{ left: `${pct}%`, transform: 'translate(-50%,-50%)', transition: isDragging ? 'none' : 'left 0.04s ease' }}>
        <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center"
             style={{ boxShadow: `0 4px 20px rgba(0,0,0,0.25), 0 0 0 3px ${sliderColor}, 0 0 0 5px rgba(255,255,255,0.8)`, transform: isDragging ? 'scale(1.2)' : isHovering ? 'scale(1.08)' : 'scale(1)', transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)' }}>
          <ArrowLeftRight className="w-4 h-4" style={{ color: sliderColor }}/>
        </div>
      </div>
      {showLabels && (
        <>
          <div className="absolute bottom-3 left-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white pointer-events-none"
               style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', borderRadius: '5px', opacity: pct < 15 ? 0 : 1, transition: 'opacity 0.3s' }}>Before</div>
          <div className="absolute bottom-3 right-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white pointer-events-none"
               style={{ background: sliderColor + 'ee', backdropFilter: 'blur(4px)', borderRadius: '5px', opacity: pct > 85 ? 0 : 1, transition: 'opacity 0.3s' }}>After</div>
        </>
      )}
      {!hasInteracted && (
        <div className="absolute inset-x-0 bottom-10 flex justify-center pointer-events-none" style={{ opacity: isHovering ? 0 : 0.8, transition: 'opacity 0.4s' }}>
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-white"
               style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', borderRadius: '20px' }}>
            <ArrowLeftRight className="w-3 h-3"/>Drag to reveal
          </div>
        </div>
      )}
    </div>
  );
}

function StackRevealCard({ pair, sliderColor, showLabels, style }: { pair: any; sliderColor: string; showLabels: boolean; style: StyleConfig }) {
  const [revealed, setRevealed] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => { setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0); }, []);
  const hasBefore = !!pair?.beforeUrl;
  const hasAfter  = !!pair?.afterUrl;
  const toggle = () => setRevealed(r => !r);
  const enter  = () => { if (!isTouch) setRevealed(true); };
  const leave  = () => { if (!isTouch) setRevealed(false); };
  return (
    <div className="relative overflow-hidden cursor-pointer group" style={{ borderRadius: br(style), aspectRatio: '4/3' }}
         onClick={toggle} onMouseEnter={enter} onMouseLeave={leave}>
      <div className="absolute inset-0">
        {hasBefore ? <img src={pair.beforeUrl} alt="Before" className="w-full h-full object-cover" style={{ transform: revealed ? 'scale(1.04)' : 'scale(1)', transition: 'transform 0.7s cubic-bezier(0.16,1,0.3,1)' }}/>
          : <div className="w-full h-full bg-slate-100 flex items-center justify-center"><span className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-300">Before</span></div>}
      </div>
      <div className="absolute inset-0" style={{ clipPath: revealed ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)', transition: 'clip-path 0.65s cubic-bezier(0.16,1,0.3,1)' }}>
        {hasAfter ? <img src={pair.afterUrl} alt="After" className="w-full h-full object-cover" style={{ transform: revealed ? 'scale(1)' : 'scale(1.04)', transition: 'transform 0.7s cubic-bezier(0.16,1,0.3,1)' }}/>
          : <div className="w-full h-full flex items-center justify-center" style={{ background: ac(style) + '20' }}><span className="text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: ac(style) + 'aa' }}>After</span></div>}
      </div>
      {showLabels && (
        <>
          <div className="absolute top-3 left-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', borderRadius: '5px', opacity: revealed ? 0 : 1, transition: 'opacity 0.35s' }}>Before</div>
          <div className="absolute top-3 right-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white" style={{ background: sliderColor + 'dd', backdropFilter: 'blur(4px)', borderRadius: '5px', opacity: revealed ? 1 : 0, transition: 'opacity 0.35s 0.2s' }}>After</div>
        </>
      )}
      <div className="absolute inset-0 flex items-end justify-center pb-5 pointer-events-none" style={{ opacity: revealed ? 0 : 1, transition: 'opacity 0.3s' }}>
        <div className="px-4 py-2 rounded-full text-white text-[10px] font-black uppercase tracking-widest" style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(8px)' }}>
          {isTouch ? 'Tap to reveal ✦' : 'Hover to reveal ✦'}
        </div>
      </div>
    </div>
  );
}

// ─── BeforeAfterSection ───────────────────────────────────────────────────────
function BeforeAfterSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const pairs: any[] = Array.isArray(config.pairs) ? config.pairs : [];
  const layout      = config.layout || 'slider';
  const showLabels  = config.showLabels !== false;
  const sliderColor = config.sliderColor || ac(style);
  const [carouselIdx, setCarouselIdx] = useState(0);

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

  if (layout === 'slider') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className={cn('grid gap-8', displayPairs.length === 1 ? 'max-w-2xl mx-auto' : 'md:grid-cols-2')}>
          {displayPairs.map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-3">
              <BeforeAfterSlider pair={pair} sliderColor={sliderColor} showLabels={showLabels} style={style}/>
              {pair.caption && <p className="text-center text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ac(style) + '80', fontFamily: bf(style) }}>{pair.caption}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  if (layout === 'side') return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className="space-y-20">
          {displayPairs.map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:gap-6">
                {[{ label: 'Before', url: pair.beforeUrl, isAfter: false }, { label: 'After', url: pair.afterUrl, isAfter: true }].map(side => (
                  <div key={side.label} className="group relative overflow-hidden" style={{ borderRadius: br(style), aspectRatio: '3/4' }}>
                    {side.url ? <img src={side.url} alt={side.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" draggable={false}/>
                      : <div className="w-full h-full flex items-center justify-center" style={{ background: side.isAfter ? ac(style) + '14' : '#f1f5f9' }}>
                          <span className="text-[11px] font-black uppercase tracking-[0.25em]" style={{ color: side.isAfter ? ac(style) + 'aa' : '#cbd5e1' }}>{side.label}</span>
                        </div>}
                    {showLabels && <div className="absolute top-3 left-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-white" style={{ background: side.isAfter ? sliderColor + 'ee' : 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', borderRadius: '5px' }}>{side.label}</div>}
                    <div className="absolute bottom-0 left-0 right-0 h-[3px] scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left" style={{ background: side.isAfter ? sliderColor : ac(style) + '40' }}/>
                  </div>
                ))}
              </div>
              {pair.caption && <p className="text-center text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ac(style) + '80', fontFamily: bf(style) }}>{pair.caption}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  if (layout === 'stack') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className={cn('grid gap-6', displayPairs.length === 1 ? 'max-w-2xl mx-auto' : 'md:grid-cols-2')}>
          {displayPairs.map((pair: any, i: number) => (
            <div key={pair.id || i} className="space-y-3">
              <StackRevealCard pair={pair} sliderColor={sliderColor} showLabels={showLabels} style={style}/>
              {pair.caption && <p className="text-center text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ac(style) + '80', fontFamily: bf(style) }}>{pair.caption}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const current = displayPairs[carouselIdx % displayPairs.length];
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <SectionHeader/>
        <div className="space-y-6">
          <BeforeAfterSlider key={carouselIdx} pair={current} sliderColor={sliderColor} showLabels={showLabels} style={style}/>
          {current?.caption && <p className="text-center text-sm font-bold uppercase tracking-widest" style={{ color: ac(style) + '70', fontFamily: bf(style) }}>{current.caption}</p>}
          {displayPairs.length > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => setCarouselIdx(i => (i - 1 + displayPairs.length) % displayPairs.length)} className="w-10 h-10 rounded-full border-2 flex items-center justify-center hover:shadow-md transition-all" style={{ borderColor: ac(style) + '30', color: '#94a3b8' }}><ChevronLeft className="w-4 h-4"/></button>
              <div className="flex gap-2 items-center">
                {displayPairs.map((_, i) => (
                  <button key={i} onClick={() => setCarouselIdx(i)} className="transition-all duration-300"
                          style={{ width: i === carouselIdx % displayPairs.length ? '24px' : '8px', height: '8px', borderRadius: '9999px', background: i === carouselIdx % displayPairs.length ? ac(style) : ac(style) + '28' }}/>
                ))}
              </div>
              <button onClick={() => setCarouselIdx(i => (i + 1) % displayPairs.length)} className="w-10 h-10 rounded-full border-2 flex items-center justify-center hover:shadow-md transition-all" style={{ borderColor: ac(style) + '30', color: '#94a3b8' }}><ChevronRight className="w-4 h-4"/></button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── MembershipsSection ───────────────────────────────────────────────────────
function MembershipsSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const plans = [1,2,3].map(n => ({ name: config[`plan${n}Name`] || ['Essential','Luxe','Elite'][n-1], price: config[`plan${n}Price`] || ['$89','$149','$249'][n-1], period: config[`plan${n}Period`] || '/mo', features: (config[`plan${n}Features`] || ['2 services/month\nPriority booking\n10% off retail','4 services/month\nVIP priority\n20% off retail\nFree upgrades','Unlimited services\nDedicated artist\n30% off retail\nExclusive events'][n-1]).split('\n').filter(Boolean), featured: n === 2 ? (config.plan2Featured !== undefined ? config.plan2Featured : true) : false }));
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Join the Club'}</FieldTap>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6 items-center">
          {plans.map((plan, i) => (
            <div key={i} className={cn('p-8 space-y-6 hover:shadow-2xl transition-all', plan.featured && 'md:scale-105')} style={{ borderRadius: br(style,1.5), border: `2px solid ${plan.featured ? ac(style) : ac(style)+'25'}`, background: plan.featured ? ac(style) : 'white' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: plan.featured ? 'rgba(255,255,255,0.65)' : ac(style) }}>{plan.name}</p>
                {config.showBadge && plan.featured && <span className="inline-block mt-1 px-2 py-0.5 text-[8px] font-black uppercase text-white bg-white/20 rounded">Most Popular</span>}
                <div className="flex items-end gap-1 mt-2">
                  <span className="text-4xl font-light" style={{ fontFamily: hf(style), color: plan.featured ? 'white' : '#0f172a' }}>{plan.price}</span>
                  <span className="text-sm mb-1" style={{ color: plan.featured ? 'rgba(255,255,255,0.5)' : '#94a3b8', fontFamily: bf(style) }}>{plan.period}</span>
                </div>
              </div>
              <ul className="space-y-2.5">
                {plan.features.map((f: string, j: number) => (
                  <li key={j} className="flex items-center gap-2.5 text-sm" style={{ fontFamily: bf(style), color: plan.featured ? 'rgba(255,255,255,0.8)' : '#64748b' }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: plan.featured ? 'rgba(255,255,255,0.6)' : ac(style) }}/>{f}
                  </li>
                ))}
              </ul>
              <button onClick={cta(config.ctaAction, config.ctaUrl)} className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ background: plan.featured ? 'white' : ac(style), color: plan.featured ? ac(style) : 'white', borderRadius: br(style), fontFamily: bf(style) }}>{config.ctaText || 'Join Now'}</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── PackagesSection ──────────────────────────────────────────────────────────
function PackagesSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const pkgs = [1,2,3].map(n => ({ name: config[`pkg${n}Name`] || ['5-Pack','10-Pack','20-Pack'][n-1], sessions: config[`pkg${n}Sessions`] || [5,10,20][n-1], price: config[`pkg${n}Price`] || ['$199','$349','$599'][n-1], saving: config[`pkg${n}Saving`] || ['Save 15%','Save 25%','Save 35%'][n-1] }));
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Prepaid Sessions'}</FieldTap>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {pkgs.map((pkg, i) => (
            <div key={i} className="p-8 bg-white text-center space-y-5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300" style={{ borderRadius: br(style,1.5), border: `2px solid ${ac(style)}25` }}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(style) }}>{pkg.name}</p>
              <p className="text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{pkg.price}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>
              {config.showExpiry !== false && <p className="text-xs text-slate-400">Valid 12 months</p>}
              {config.showSavings !== false && <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: ac(style), borderRadius: br(style,2) }}>{pkg.saving}</span>}
              <button onClick={cta(config.ctaAction, config.ctaUrl)} className="block w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{ ...btnStyle(style), fontFamily: bf(style) }}>Purchase</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── QuoteSection ──────────────────────────────────────────────────────────────
// Replace the entire QuoteSection function in booking-sections.tsx
function QuoteSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout  = config.layout || 'cinematic';
  const accent  = ac(style);
  const hasBg   = !!(config.bgImage as string);
  const { ref, visible } = useInView(0.08);

  const overlayType = (config.overlayStyle as string) || 'dark';

  const imgOverlay = (): string => {
    if (!hasBg) return '';
    if (overlayType === 'none')
      return 'linear-gradient(to top, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.20) 55%, rgba(0,0,0,0.05) 100%)';
    if (overlayType === 'accent')
      return `linear-gradient(160deg, ${accent}d0 0%, rgba(0,0,0,0.60) 100%)`;
    return 'linear-gradient(160deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.48) 100%)';
  };

  const accentPanel = `linear-gradient(145deg, ${accent} 0%, ${accent}cc 100%)`;

  const tags: string[] = Array.isArray(config.tags) ? config.tags
    : typeof config.tags === 'string' ? config.tags.split(',').map((s: string) => s.trim()).filter(Boolean)
    : ['Bridal Parties', 'Corporate Events', 'Destination Services'];

  const showHeading    = config.showHeading    !== false;
  const showSubheading = config.showSubheading !== false;

  // ── Shared atoms ─────────────────────────────────────────────────────────────

  const Eyebrow = ({ light = false, text = 'Request a Quote' }: { light?: boolean; text?: string }) => (
    <div className="flex items-center gap-3">
      <div className="h-px w-8" style={{ background: light ? 'rgba(255,255,255,0.45)' : accent }}/>
      <span className="text-[9px] font-black uppercase tracking-[0.35em]"
        style={{ color: light ? 'rgba(255,255,255,0.55)' : accent, fontFamily: bf(style) }}>
        {text}
      </span>
    </div>
  );

  const PrimaryBtn = ({ light = false, full = false }: { light?: boolean; full?: boolean }) => (
    <div className={full ? 'w-full' : ''}>
      <button
        onClick={cta(config.ctaAction, config.ctaUrl)}
        className={cn(
          'group inline-flex items-center gap-3 font-black uppercase tracking-widest transition-all active:scale-[0.98] whitespace-nowrap',
          full ? 'w-full justify-center' : ''
        )}
        style={{
          ...(light
            ? { background: '#ffffff', color: accent }
            : btnStyle(style)),
          padding: '15px 40px',
          fontFamily: bf(style),
          fontSize: '11px',
          boxShadow: light
            ? '0 8px 32px rgba(0,0,0,0.20)'
            : `0 8px 32px ${accent}35`,
          borderRadius: br(style, 0.8),
          letterSpacing: '0.12em',
        }}>
        {config.ctaText || 'Request a Custom Quote'}
        <ArrowRight className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-1"/>
      </button>
      {config.ctaNote && (
        <p className="mt-3 text-[10px] font-bold uppercase tracking-widest"
          style={{ color: light ? 'rgba(255,255,255,0.45)' : `${accent}60`, fontFamily: bf(style) }}>
          {config.ctaNote}
        </p>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // CINEMATIC — full viewport, dark stage, editorial type hierarchy
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'cinematic') {
    return (
      <section id="quote" className="relative overflow-hidden"
        style={{ background: hasBg ? '#080808' : '#0c0c0c', minHeight: '100vh' }}>

        {/* Background */}
        {hasBg && (
          <>
            <img src={config.bgImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60"/>
            <div className="absolute inset-0" style={{ background: imgOverlay() }}/>
          </>
        )}

        {/* Subtle radial glow centred on heading */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 80% 55% at 50% 45%, ${accent}14 0%, transparent 68%)` }}/>

        {/* Noise grain overlay for texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.035]"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")', backgroundSize: '200px' }}/>

        {/* Content */}
        <div ref={ref}
          className="relative z-10 flex flex-col items-center justify-center text-center px-6 md:px-16"
          style={{ minHeight: '100vh', paddingTop: '10vh', paddingBottom: '10vh' }}>

          <div className="space-y-8 max-w-4xl mx-auto"
            style={{ animation: visible ? 'cf-fade-up 1s cubic-bezier(0.16,1,0.3,1) both' : 'none' }}>

            <Eyebrow light text={config.ctaNote || 'Private Event Services'}/>

            {showHeading && (
              <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="h2" className="text-white leading-[0.88]"
                style={{ fontFamily: hf(style), fontSize: 'clamp(38px,7.5vw,96px)', fontWeight: 300 }}>
                {config.heading || 'Planning Something Unforgettable?'}
              </FieldTap>
            )}

            {showSubheading && config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-lg leading-relaxed max-w-2xl mx-auto"
                style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.55)', fontWeight: 300 }}>
                {config.subheading}
              </FieldTap>
            )}

            {/* Event type pills */}
            <div className="flex flex-wrap justify-center gap-2.5">
              {tags.map((tag, i) => (
                <span key={i}
                  className="px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em]"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    color: 'rgba(255,255,255,0.70)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: br(style, 3),
                    backdropFilter: 'blur(8px)',
                    animation: visible ? `cf-fade-up 0.8s ${0.2 + i * 0.08}s both` : 'none',
                  }}>
                  {tag}
                </span>
              ))}
            </div>

            <div style={{ animation: visible ? 'cf-fade-up 0.8s 0.5s both' : 'none' }}>
              <PrimaryBtn light/>
            </div>
          </div>

          {/* Scroll hint */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-25">
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.6)', animation: 'cf-pulse 2s infinite' }}/>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EDITORIAL — architectural grid, oversized numbering, magazine feel
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'editorial') {
    return (
      <section id="quote" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">

          {/* Section label row */}
          <div className="flex items-center gap-4 mb-16">
            <div className="h-px flex-1" style={{ background: `${accent}18` }}/>
            <span className="text-[9px] font-black uppercase tracking-[0.35em]"
              style={{ color: accent, fontFamily: bf(style) }}>
              Event & Group Inquiries
            </span>
            <div className="h-px flex-1" style={{ background: `${accent}18` }}/>
          </div>

          <div ref={ref} className="grid md:grid-cols-[1fr_1.1fr] gap-12 md:gap-20 items-start">

            {/* Left — heading + CTA */}
            <div className="space-y-10"
              style={{ animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>

              {showHeading && (
                <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="h2" className="leading-[0.88]"
                  style={{ fontFamily: hf(style), fontSize: 'clamp(34px,5.5vw,68px)',
                    fontWeight: 300, color: '#0f172a' }}>
                  {config.heading || 'Planning Something Unforgettable?'}
                </FieldTap>
              )}

              {showSubheading && config.subheading && (
                <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="p" className="text-base leading-relaxed max-w-sm"
                  style={{ fontFamily: bf(style), color: '#64748b', fontWeight: 300 }}>
                  {config.subheading}
                </FieldTap>
              )}

              <PrimaryBtn/>
            </div>

            {/* Right — numbered service cards */}
            <div className="space-y-0">
              {tags.map((tag, i) => (
                <div key={i}
                  className="flex items-start gap-5 py-6 border-b group cursor-default"
                  style={{
                    borderColor: `${accent}10`,
                    animation: visible ? `cf-fade-up 0.6s ${i * 0.1}s both` : 'none',
                  }}>
                  <span className="text-[11px] font-black tabular-nums shrink-0 pt-0.5"
                    style={{ color: accent, fontFamily: bf(style), letterSpacing: '0.1em' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black uppercase tracking-widest text-sm text-slate-800 group-hover:text-slate-900 transition-colors"
                      style={{ fontFamily: bf(style) }}>
                      {tag}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-all translate-x-0 group-hover:translate-x-1"
                    style={{ color: accent }}/>
                </div>
              ))}

              {/* Decorative large number watermark */}
              <div className="relative pt-8">
                <span className="select-none pointer-events-none font-light"
                  style={{ fontSize: 'clamp(80px,14vw,120px)', fontFamily: hf(style),
                    color: `${accent}06`, lineHeight: 1, display: 'block' }}>
                  Events
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LUXURY — full-bleed split: image/dark left, structured process right
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'luxury') {
    const steps = [
      { n: '01', title: 'Submit your inquiry', body: 'Tell us about your event, group size and preferred dates.' },
      { n: '02', title: 'Receive a custom quote', body: 'We respond within 24 hours with a personalised proposal.' },
      { n: '03', title: 'Confirm & book',          body: 'Secure your date with a deposit. We handle the rest.' },
    ];
    return (
      <section id="quote" className="overflow-hidden" style={{ background: style.bgColor }}>
        <div className="grid md:grid-cols-[1.1fr_1fr]">

          {/* Left — dark/image panel */}
          <div className="relative overflow-hidden flex flex-col justify-end"
            style={{ minHeight: 560, background: '#0c0c0c' }}>
            {hasBg && (
              <>
                <img src={config.bgImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-55"/>
                <div className="absolute inset-0" style={{ background: imgOverlay() }}/>
              </>
            )}
            {!hasBg && (
              <div className="absolute inset-0" style={{ background: accentPanel, opacity: 0.18 }}/>
            )}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(ellipse 80% 60% at 30% 60%, ${accent}12 0%, transparent 65%)` }}/>

            <div ref={ref} className="relative z-10 p-8 md:p-14 space-y-6"
              style={{ animation: visible ? 'cf-fade-up 0.9s both' : 'none' }}>
              <Eyebrow light text="Private & Group Events"/>
              {showHeading && (
                <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="h2" className="font-light text-white leading-[0.88]"
                  style={{ fontFamily: hf(style), fontSize: 'clamp(26px,4vw,52px)' }}>
                  {config.heading || 'Planning Something Unforgettable?'}
                </FieldTap>
              )}
              {showSubheading && config.subheading && (
                <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="p" className="text-sm leading-relaxed max-w-sm"
                  style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.55)', fontWeight: 300 }}>
                  {config.subheading}
                </FieldTap>
              )}
              {/* Tags */}
              <div className="flex flex-wrap gap-2 pt-2">
                {tags.map((tag, i) => (
                  <span key={i}
                    className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest"
                    style={{
                      background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.70)',
                      border: '1px solid rgba(255,255,255,0.18)', borderRadius: br(style, 3),
                    }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right — process + CTA */}
          <div className="flex flex-col justify-center px-8 md:px-14 py-14 md:py-20 space-y-10 bg-white">
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase tracking-[0.3em]"
                style={{ color: accent, fontFamily: bf(style) }}>How it works</p>
              <div className="h-px w-10" style={{ background: `${accent}25` }}/>
            </div>

            <div className="space-y-6">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-5"
                  style={{ animation: visible ? `cf-fade-up 0.6s ${0.1 + i * 0.12}s both` : 'none' }}>
                  <span className="text-[11px] font-black shrink-0 pt-0.5 tabular-nums"
                    style={{ color: accent, fontFamily: bf(style), letterSpacing: '0.12em' }}>
                    {step.n}
                  </span>
                  <div>
                    <p className="text-sm font-black uppercase tracking-tight text-slate-800 mb-1"
                      style={{ fontFamily: bf(style) }}>{step.title}</p>
                    <p className="text-xs text-slate-500 leading-relaxed font-light"
                      style={{ fontFamily: bf(style) }}>{step.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <PrimaryBtn/>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SHOWCASE — elegant event-type cards + prominent full-width CTA
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'showcase') {
    return (
      <section id="quote" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16 space-y-16">

          {/* Header */}
          {(showHeading || showSubheading) && (
            <div ref={ref} className="text-center space-y-5 max-w-3xl mx-auto"
              style={{ animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>
              <Eyebrow text={config.ctaNote || 'Group & Event Services'}/>
              {showHeading && (
                <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="h2" className="font-light leading-tight"
                  style={{ fontFamily: hf(style), fontSize: 'clamp(30px,5vw,60px)', color: '#0f172a' }}>
                  {config.heading || 'Planning Something Unforgettable?'}
                </FieldTap>
              )}
              {showSubheading && config.subheading && (
                <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="p" className="text-base leading-relaxed"
                  style={{ fontFamily: bf(style), color: '#64748b', fontWeight: 300 }}>
                  {config.subheading}
                </FieldTap>
              )}
            </div>
          )}

          {/* Tag cards */}
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {tags.map((tag, i) => (
              <div key={i}
                className="relative overflow-hidden p-6 group cursor-default transition-all hover:-translate-y-1"
                style={{
                  border: `1.5px solid ${accent}18`,
                  borderRadius: br(style, 2),
                  background: `${accent}04`,
                  animation: visible ? `cf-fade-up 0.55s ${i * 0.09}s both` : 'none',
                  boxShadow: '0 2px 0 rgba(0,0,0,0.04)',
                  transition: 'transform 0.25s ease, box-shadow 0.25s ease',
                }}>
                {/* Decorative number */}
                <span className="absolute top-3 right-4 font-light select-none pointer-events-none"
                  style={{ fontSize: 48, fontFamily: hf(style), color: `${accent}06`, lineHeight: 1 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: `${accent}12` }}>
                  <Sparkles className="w-4 h-4" style={{ color: accent }}/>
                </div>
                <p className="font-black text-sm uppercase tracking-widest text-slate-800"
                  style={{ fontFamily: bf(style) }}>{tag}</p>
                <div className="h-px mt-4 w-0 group-hover:w-full transition-all duration-500"
                  style={{ background: `${accent}30` }}/>
              </div>
            ))}
          </div>

          {/* Full-width CTA strip */}
          <div className="relative overflow-hidden p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-6"
            style={{
              background: '#0f0f0f',
              borderRadius: br(style, 2),
              boxShadow: `0 24px 64px rgba(0,0,0,0.20), 0 0 0 1px rgba(255,255,255,0.05)`,
            }}>
            {hasBg && (
              <>
                <img src={config.bgImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30"/>
                <div className="absolute inset-0" style={{ background: imgOverlay() }}/>
              </>
            )}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(ellipse 60% 80% at 20% 50%, ${accent}18 0%, transparent 65%)` }}/>
            <div className="relative z-10 space-y-1">
              <p className="text-white font-light text-xl md:text-2xl" style={{ fontFamily: hf(style) }}>
                Ready to plan your event?
              </p>
              <p className="text-white/45 text-sm font-light" style={{ fontFamily: bf(style) }}>
                We respond to every inquiry within 24 hours.
              </p>
            </div>
            <div className="relative z-10 shrink-0">
              <PrimaryBtn light/>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CENTERED — ultra-refined minimalism, maximum breathing room
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'centered') {
    return (
      <section id="quote" className="relative overflow-hidden"
        style={{ background: hasBg ? '#0a0a0a' : style.bgColor, minHeight: '72vh' }}>
        {hasBg && (
          <>
            <img src={config.bgImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-45"/>
            <div className="absolute inset-0" style={{ background: imgOverlay() }}/>
          </>
        )}

        <div ref={ref}
          className="relative z-10 flex flex-col items-center justify-center text-center px-6 md:px-16"
          style={{
            minHeight: '72vh',
            paddingTop: 'clamp(60px,12vh,120px)',
            paddingBottom: 'clamp(60px,12vh,120px)',
            animation: visible ? 'cf-fade-up 1s cubic-bezier(0.16,1,0.3,1) both' : 'none',
          }}>

          <div className="space-y-10 max-w-3xl">
            <Eyebrow light={hasBg} text="Private Event Services"/>

            {showHeading && (
              <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="h2" className="leading-[0.88]"
                style={{
                  fontFamily: hf(style),
                  fontSize: 'clamp(32px,6vw,76px)',
                  fontWeight: 300,
                  color: hasBg ? '#ffffff' : '#0f172a',
                }}>
                {config.heading || 'Planning Something Unforgettable?'}
              </FieldTap>
            )}

            {/* Thin rule */}
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16" style={{ background: hasBg ? 'rgba(255,255,255,0.20)' : `${accent}25` }}/>
              <div className="w-1 h-1 rounded-full" style={{ background: hasBg ? 'rgba(255,255,255,0.35)' : accent }}/>
              <div className="h-px w-16" style={{ background: hasBg ? 'rgba(255,255,255,0.20)' : `${accent}25` }}/>
            </div>

            {showSubheading && config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-lg leading-relaxed font-light max-w-xl mx-auto"
                style={{ fontFamily: bf(style), color: hasBg ? 'rgba(255,255,255,0.50)' : '#64748b' }}>
                {config.subheading}
              </FieldTap>
            )}

            {/* Tags inline */}
            <div className="flex flex-wrap justify-center gap-2">
              {tags.map((tag, i) => (
                <span key={i}
                  className="px-4 py-2 text-[9px] font-black uppercase tracking-[0.22em]"
                  style={{
                    background: hasBg ? 'rgba(255,255,255,0.09)' : `${accent}08`,
                    color:      hasBg ? 'rgba(255,255,255,0.60)' : accent,
                    border:     `1px solid ${hasBg ? 'rgba(255,255,255,0.16)' : accent + '22'}`,
                    borderRadius: br(style, 3),
                  }}>
                  {tag}
                </span>
              ))}
            </div>

            <PrimaryBtn light={hasBg}/>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SPLIT — asymmetric, generous, image left / structured CTA right
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'split') {
    return (
      <section id="quote" className="overflow-hidden" style={{ background: style.bgColor }}>
        <div className="grid md:grid-cols-[1.15fr_1fr]">

          {/* Left — image / accent panel */}
          <div className="relative overflow-hidden" style={{ minHeight: 500 }}>
            {hasBg
              ? <img src={config.bgImage} alt="" className="absolute inset-0 w-full h-full object-cover"/>
              : <div className="absolute inset-0" style={{ background: accentPanel }}/>}
            {hasBg && <div className="absolute inset-0" style={{ background: imgOverlay() }}/>}

            {/* Overlay content */}
            <div ref={ref} className="relative z-10 flex flex-col justify-end h-full p-8 md:p-12 space-y-5"
              style={{ minHeight: 500, animation: visible ? 'cf-fade-up 0.9s both' : 'none' }}>
              {showHeading && (
                <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="h2" className="font-light text-white leading-[0.88]"
                  style={{ fontFamily: hf(style), fontSize: 'clamp(28px,4vw,54px)' }}>
                  {config.heading || 'Planning Something Unforgettable?'}
                </FieldTap>
              )}
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                  <span key={i}
                    className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest"
                    style={{
                      background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)',
                      border: '1px solid rgba(255,255,255,0.20)', borderRadius: br(style, 3),
                    }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right — CTA panel */}
          <div className="flex flex-col justify-center px-8 md:px-14 py-16 md:py-24 space-y-8 bg-white">
            <Eyebrow text="Get in touch"/>

            {showSubheading && config.subheading ? (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-base leading-relaxed font-light max-w-xs"
                style={{ fontFamily: bf(style), color: '#64748b' }}>
                {config.subheading}
              </FieldTap>
            ) : (
              <p className="text-base leading-relaxed font-light max-w-xs"
                style={{ fontFamily: bf(style), color: '#64748b' }}>
                Tell us about your event and we'll craft a personalised quote within 24 hours.
              </p>
            )}

            {/* Response time callout */}
            <div className="flex items-center gap-3 py-4 border-y"
              style={{ borderColor: `${accent}12` }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${accent}10` }}>
                <Sparkles className="w-4 h-4" style={{ color: accent }}/>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: '#0f172a', fontFamily: bf(style) }}>
                We respond to every inquiry within 24 hours
              </p>
            </div>

            <PrimaryBtn/>
          </div>
        </div>
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BANNER — refined horizontal strip, dark and premium
  // ════════════════════════════════════════════════════════════════════════════
  if (layout === 'banner') {
    return (
      <section id="quote" className="relative overflow-hidden py-20"
        style={{ background: hasBg ? '#0a0a0a' : '#0c0c0c' }}>
        {hasBg && (
          <>
            <img src={config.bgImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40"/>
            <div className="absolute inset-0" style={{ background: imgOverlay() }}/>
          </>
        )}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 55% 90% at 15% 50%, ${accent}12 0%, transparent 60%)` }}/>

        <div ref={ref}
          className="relative z-10 max-w-6xl mx-auto px-6 md:px-16
                     flex flex-col lg:flex-row items-center justify-between gap-10"
          style={{ animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>

          {/* Left text */}
          <div className="space-y-4 text-center lg:text-left">
            <Eyebrow light text="Event & Group Inquiries"/>
            {showHeading && (
              <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="h2" className="font-light text-white leading-[0.9]"
                style={{ fontFamily: hf(style), fontSize: 'clamp(24px,3.5vw,48px)' }}>
                {config.heading || 'Planning Something Unforgettable?'}
              </FieldTap>
            )}
            {/* Inline tags */}
            <div className="flex flex-wrap gap-2 justify-center lg:justify-start">
              {tags.map((tag, i) => (
                <span key={i}
                  className="px-3 py-1 text-[9px] font-black uppercase tracking-widest"
                  style={{
                    background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)',
                    border: '1px solid rgba(255,255,255,0.12)', borderRadius: br(style, 3),
                  }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Right CTA */}
          <div className="shrink-0 space-y-3 text-center lg:text-right">
            <PrimaryBtn light/>
            {showSubheading && config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-xs font-light"
                style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.35)' }}>
                {config.subheading}
              </FieldTap>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── default fallback ────────────────────────────────────────────────────────
  return (
    <section id="quote" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-3xl mx-auto px-6 text-center space-y-8">
        {showHeading && (
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
            as="h2" className="font-light"
            style={{ fontFamily: hf(style), fontSize: 'clamp(28px,5vw,56px)', color: '#0f172a' }}>
            {config.heading || 'Planning Something Unforgettable?'}
          </FieldTap>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {tags.map((tag, i) => (
            <span key={i} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest"
              style={{ background: `${accent}0e`, color: accent, border: `1.5px solid ${accent}22`, borderRadius: br(style, 3) }}>
              {tag}
            </span>
          ))}
        </div>
        <PrimaryBtn/>
      </div>
    </section>
  );
}

// ─── NewClientSection ─────────────────────────────────────────────────────────
function NewClientSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const hasBg = !!config.bgImage;
  return (
    <section className={cn(py(style), 'relative')} style={{ background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : ac(style)+'0e' }}>
      {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }}/>}
      <div className="relative max-w-5xl mx-auto px-6 md:px-16">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12" style={{ borderRadius: br(style,2), border: `2px solid ${hasBg ? 'rgba(255,255,255,0.2)' : ac(style)+'28'}` }}>
          <div className={cn('text-center md:text-left space-y-3', hasBg && 'text-white')}>
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <Sparkles className="w-4 h-4" style={{ color: hasBg ? 'white' : ac(style) }}/>
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: hasBg ? 'rgba(255,255,255,0.7)' : ac(style) }}>First Visit</p>
            </div>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: hasBg ? 'white' : '#0f172a' }}>{config.heading || 'First Visit Special'}</FieldTap>
            {config.offerText && <FieldTap sectionId={sectionId} fieldKey="offerText" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-xl font-black" style={{ color: hasBg ? 'rgba(255,255,255,0.9)' : ac(style), fontFamily: bf(style) }}>{config.offerText}</FieldTap>}
            {config.expiryText && <p className="text-xs font-bold uppercase tracking-widest" style={{ color: hasBg ? 'rgba(255,255,255,0.5)' : '#94a3b8' }}>{config.expiryText}</p>}
            {config.finePrint && <p className="text-xs" style={{ color: hasBg ? 'rgba(255,255,255,0.4)' : '#94a3b8' }}>{config.finePrint}</p>}
          </div>
          <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
            <button onClick={cta(config.ctaAction, config.ctaUrl)} className="shrink-0 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.ctaText || 'Claim Offer'}</button>
          </FieldTap>
        </div>
      </div>
    </section>
  );
}

// ─── FAQSection ───────────────────────────────────────────────────────────────
function FAQSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'accordion';
  const accent = ac(style);
  const { ref, visible } = useInView(0.06);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
 
  const showHeading = config.showHeading !== false;
 
  const items = [
    { q: config.q1, a: config.a1 }, { q: config.q2, a: config.a2 },
    { q: config.q3, a: config.a3 }, { q: config.q4, a: config.a4 },
    { q: config.q5, a: config.a5 }, { q: config.q6, a: config.a6 },
  ].filter(i => i.q && i.a) as { q: string; a: string }[];
 
  const Header = () => showHeading ? (
    <div className="text-center mb-10 md:mb-14">
      <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
        as="h2" className="font-light"
        style={{ fontFamily: hf(style), fontSize: 'clamp(26px,5vw,54px)', color: '#0f172a' }}>
        {config.heading || 'Common Questions'}
      </FieldTap>
    </div>
  ) : null;
 
  if (layout === 'accordion') {
    return (
      <section id="faq" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-3xl mx-auto" style={{ padding: '0 clamp(16px,5vw,48px)' }}>
          <Header/>
          <div ref={ref} className="space-y-0">
            {items.map((item, i) => (
              <div key={i}
                className="border-b"
                style={{
                  borderColor: `${accent}12`,
                  animation: visible ? `cf-fade-up 0.5s ${i * 0.07}s both` : 'none',
                }}>
                <button
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left group">
                  <span className="font-black uppercase tracking-tight text-slate-800 group-hover:text-slate-900 transition-colors"
                    style={{ fontFamily: bf(style), fontSize: 'clamp(12px,2vw,14px)' }}>
                    {item.q}
                  </span>
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform"
                    style={{
                      background: openIdx === i ? accent : `${accent}10`,
                      transform: openIdx === i ? 'rotate(45deg)' : 'none',
                    }}>
                    <Plus className="w-3 h-3" style={{ color: openIdx === i ? '#fff' : accent }}/>
                  </div>
                </button>
                {openIdx === i && (
                  <div className="pb-5">
                    <p className="text-sm text-slate-500 leading-relaxed font-light"
                      style={{ fontFamily: bf(style) }}>{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  if (layout === 'two-col') {
    return (
      <section id="faq" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-5xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {items.map((item, i) => (
              <div key={i}
                className="p-5 md:p-6 space-y-3"
                style={{
                  border: `1.5px solid ${accent}12`, borderRadius: br(style, 2), background: '#fff',
                  animation: visible ? `cf-fade-up 0.5s ${i * 0.07}s both` : 'none',
                }}>
                <p className="font-black uppercase tracking-tight text-slate-800"
                  style={{ fontFamily: bf(style), fontSize: 'clamp(12px,1.8vw,13px)' }}>{item.q}</p>
                <p className="text-sm text-slate-500 leading-relaxed font-light"
                  style={{ fontFamily: bf(style) }}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  if (layout === 'bold') {
    return (
      <section id="faq" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-4xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <Header/>
          <div ref={ref} className="space-y-8 md:space-y-12">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-5 md:gap-8"
                style={{ animation: visible ? `cf-fade-up 0.55s ${i * 0.09}s both` : 'none' }}>
                <span className="font-black tabular-nums text-3xl md:text-4xl leading-none"
                  style={{ color: `${accent}18`, fontFamily: hf(style) }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="space-y-2 pt-1">
                  <p className="font-black uppercase tracking-tight text-slate-800"
                    style={{ fontFamily: bf(style), fontSize: 'clamp(13px,2vw,15px)' }}>{item.q}</p>
                  <p className="text-sm text-slate-500 leading-relaxed font-light"
                    style={{ fontFamily: bf(style) }}>{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
 
  // minimal / split / cards fallback
  return (
    <section id="faq" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-3xl mx-auto" style={{ padding: '0 clamp(16px,5vw,48px)' }}>
        <Header/>
        <div ref={ref} className="space-y-4">
          {items.map((item, i) => (
            <div key={i}
              className="p-5 space-y-2"
              style={{
                border: `1.5px solid ${accent}12`, borderRadius: br(style, 2), background: '#fff',
                animation: visible ? `cf-fade-up 0.5s ${i * 0.07}s both` : 'none',
              }}>
              <p className="font-black uppercase tracking-tight text-slate-800 text-sm"
                style={{ fontFamily: bf(style) }}>{item.q}</p>
              <p className="text-sm text-slate-500 leading-relaxed font-light"
                style={{ fontFamily: bf(style) }}>{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── PoliciesSection ──────────────────────────────────────────────────────────
function PoliciesSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const { ref, visible } = useInView(0.1);

  const policyItems: any[] = Array.isArray(config.policies) ? config.policies : [];
  const layout = config.layout || 'cards';
  const pad = pCardPad(style);

const MAX_DEFAULT = config.maxItems === 'all'
    ? Infinity
    : parseInt(config.maxItems || '6', 10);
  const visibleItems = showAll ? policyItems : policyItems.slice(0, MAX_DEFAULT);
  const hasMore = policyItems.length > MAX_DEFAULT;

  const PI = ({ id, size = 'md', color }: { id: string; size?: 'sm'|'md'|'lg'; color?: string }) => {
    const C = POLICY_ICON_MAP[id] || Shield;
    const sz = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-5 h-5' }[size];
    return <C className={sz} style={{ color: color || ac(style) }} />;
  };

  const Header = () => (
    <div className="text-center mb-14 space-y-3">
      <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
        as="h2" className="text-4xl md:text-5xl font-light tracking-tight"
        style={{ fontFamily: hf(style), color: pTextPrimary(style) }}>
        {config.heading || 'Our Policies'}
      </FieldTap>
      {config.subheading && (
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="p" className="text-sm max-w-md mx-auto leading-relaxed"
          style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>
          {config.subheading}
        </FieldTap>
      )}
    </div>
  );

  const Empty = () => (
    <p className="text-center text-[10px] font-black uppercase tracking-[0.25em] py-16"
      style={{ color: pTextMuted(style) }}>
      No policies configured yet
    </p>
  );

  const ShowMoreBtn = () => !hasMore || showAll ? null : (
    <div className="text-center mt-10">
      <button
        onClick={() => setShowAll(true)}
        className="inline-flex items-center gap-2.5 px-8 py-3.5 font-black text-sm uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-95"
        style={{
          borderRadius: pbr(style, 3),
          border: `2px solid ${ac(style)}30`,
          color: ac(style),
          fontFamily: bf(style),
          background: `${ac(style)}06`,
          WebkitTapHighlightColor: 'transparent',
        }}>
        View all {policyItems.length} policies
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );

  const CollapseBtn = () => !hasMore || !showAll ? null : (
    <div className="text-center mt-10">
      <button
        onClick={() => setShowAll(false)}
        className="inline-flex items-center gap-2.5 px-8 py-3.5 font-black text-sm uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-95"
        style={{
          borderRadius: pbr(style, 3),
          border: `2px solid ${ac(style)}20`,
          color: pTextSecondary(style),
          fontFamily: bf(style),
          WebkitTapHighlightColor: 'transparent',
        }}>
        Show less
        <ChevronDown className="w-4 h-4 rotate-180" />
      </button>
    </div>
  );

  // ── CARDS ──────────────────────────────────────────────────────────────────
  if (layout === 'cards') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <Header />
        {policyItems.length > 0 ? (
          <>
            <div className="grid md:grid-cols-3 gap-5">
              {visibleItems.map((p: any, i: number) => (
                <div key={p.id || i}
                  className="group relative overflow-hidden cursor-default transition-all duration-400 hover:-translate-y-1 active:scale-[0.99] min-w-0"
                  style={{
                    borderRadius: pbr(style, 1.5),
                    background: pBg(style, true),
                    border: `1px solid ${pBorderColor(style)}`,
                    boxShadow: pBoxShadow(style, true),
                    animation: visible ? `cf-float-up 0.6s ${i * 0.09}s both` : 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  <div className="absolute left-0 top-8 bottom-8 w-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-all duration-400"
                    style={{ background: `linear-gradient(to bottom, transparent, ${ac(style)}, transparent)` }} />
                  <div className={`${pad} space-y-5 relative`}>
                    <div className="w-11 h-11 flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                      style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                      <PI id={p.icon} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em]"
                        style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                      <p className="text-sm leading-relaxed"
                        style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                    </div>
                  </div>
                  <div className="absolute bottom-4 right-5 text-[10px] font-black tabular-nums select-none"
                    style={{ color: ac(style) + '14', fontFamily: hf(style) }}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                </div>
              ))}
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );

  // ── LIST ───────────────────────────────────────────────────────────────────
  if (layout === 'list') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <Header />
        {policyItems.length > 0 ? (
          <>
            <div>
              {visibleItems.map((p: any, i: number) => (
                <div key={p.id || i}
                  className="group flex items-start gap-5 py-6 border-b transition-all duration-200 last:border-0"
                  style={{
                    borderColor: pDivider(style),
                    animation: visible ? `cf-fade-up 0.5s ${i * 0.07}s both` : 'none',
                  }}>
                  <div className="w-9 h-9 shrink-0 mt-0.5 flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                    style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                    <PI id={p.icon} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em]"
                      style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                    <p className="text-sm leading-relaxed"
                      style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                  </div>
                  <span className="text-[10px] font-black tabular-nums shrink-0 mt-0.5 select-none"
                    style={{ color: ac(style) + '28', fontFamily: hf(style) }}>
                    {String(i + 1).padStart(2, '00')}
                  </span>
                </div>
              ))}
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );

  // ── TIMELINE ───────────────────────────────────────────────────────────────
  if (layout === 'timeline') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`}
      style={{ background: style.bgColor }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16">
        <Header />
        {policyItems.length > 0 ? (
          <>
            {/* MOBILE */}
            <div className="md:hidden">
              <div className="relative" style={{ paddingLeft: '58px' }}>
                <div className="absolute top-8 bottom-8"
                  style={{
                    left: '19px', width: '2px',
                    background: `linear-gradient(to bottom, transparent, ${ac(style)}30 8%, ${ac(style)}30 92%, transparent)`,
                  }} />
                <div className="space-y-5">
                  {visibleItems.map((p: any, i: number) => (
                    <div key={p.id || i} className="relative"
                      style={{ animation: visible ? `cf-fade-up 0.5s ${i * 0.12}s both` : 'none' }}>
                      <div className="absolute flex items-center justify-center"
                        style={{
                          left: '-40px', top: '16px',
                          width: '30px', height: '30px', borderRadius: '50%',
                          background: pBg(style, true),
                          border: `2px solid ${ac(style)}55`,
                          boxShadow: `0 0 0 4px ${ac(style)}0e`,
                          zIndex: 10,
                        }}>
                        <span style={{ fontSize: '9px', fontWeight: 900, color: ac(style), fontFamily: hf(style), lineHeight: 1 }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="absolute h-px"
                        style={{ left: '-10px', top: '30px', width: '14px', background: `${ac(style)}40` }} />
                      <div className="overflow-hidden transition-all duration-300 active:scale-[0.99]"
                        style={{
                          borderRadius: pbr(style, 1.5),
                          background: pBg(style, true),
                          borderLeft: `3px solid ${ac(style)}55`,
                          borderTop: `1px solid ${pBorderColor(style)}`,
                          borderRight: `1px solid ${pBorderColor(style)}`,
                          borderBottom: `1px solid ${pBorderColor(style)}`,
                          boxShadow: pBoxShadow(style, true),
                          WebkitTapHighlightColor: 'transparent',
                        }}>
                        <div className={`${pad} space-y-2.5`}>
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 shrink-0 flex items-center justify-center"
                              style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                              <PI id={p.icon} size="sm" />
                            </div>
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] flex-1 min-w-0"
                              style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                          </div>
                          <p className="text-sm leading-relaxed"
                            style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* DESKTOP */}
            <div className="hidden md:block relative">
              <div className="absolute top-8 bottom-8"
                style={{
                  left: '50%', transform: 'translateX(-50%)', width: '2px',
                  background: `linear-gradient(to bottom, transparent, ${ac(style)}22 10%, ${ac(style)}22 90%, transparent)`,
                }} />
              <div className="space-y-0">
                {visibleItems.map((p: any, i: number) => {
                  const isLeft = i % 2 === 0;
                  return (
                    <div key={p.id || i}
                      className="relative grid grid-cols-2 items-center mb-8"
                      style={{ animation: visible ? `cf-fade-up 0.55s ${i * 0.12}s both` : 'none' }}>
                      <div className={isLeft ? 'pr-16' : 'order-2 pl-16'}>
                        <div className="group overflow-hidden transition-all duration-300 hover:-translate-y-1"
                          style={{
                            borderRadius: pbr(style, 1.5),
                            background: pBg(style, true),
                            borderTop: `1px solid ${pBorderColor(style)}`,
                            borderBottom: `1px solid ${pBorderColor(style)}`,
                            borderRight: isLeft ? `3px solid ${ac(style)}50` : `1px solid ${pBorderColor(style)}`,
                            borderLeft: !isLeft ? `3px solid ${ac(style)}50` : `1px solid ${pBorderColor(style)}`,
                            boxShadow: pBoxShadow(style, true),
                          }}>
                          <div className={`${pad} space-y-3`}>
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 shrink-0 flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                                style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                                <PI id={p.icon} size="sm" />
                              </div>
                              <p className="text-[11px] font-black uppercase tracking-[0.18em]"
                                style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                            </div>
                            <p className="text-sm leading-relaxed"
                              style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                          </div>
                        </div>
                      </div>
                      <div className="absolute z-10"
                        style={{ left: 'calc(50% - 20px)', top: '50%', transform: 'translateY(-50%)' }}>
                        <div className="absolute top-1/2 -translate-y-1/2 h-px pointer-events-none"
                          style={{
                            [isLeft ? 'right' : 'left']: '40px',
                            width: 'calc(4rem - 20px)',
                            background: `linear-gradient(${isLeft ? 'to left' : 'to right'}, ${ac(style)}40, transparent)`,
                          }} />
                        <div className="w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-300 hover:scale-110"
                          style={{
                            background: bgIsDark(style.bgColor) ? style.bgColor : 'white',
                            border: `2px solid ${ac(style)}55`,
                            boxShadow: `0 0 0 5px ${ac(style)}0e, 0 2px 14px rgba(0,0,0,0.08)`,
                          }}>
                          <span className="text-[10px] font-black tabular-nums"
                            style={{ color: ac(style), fontFamily: hf(style) }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                      {isLeft ? <div className="order-2" /> : <div className="order-1" />}
                    </div>
                  );
                })}
              </div>
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );

  // ── ACCORDION ──────────────────────────────────────────────────────────────
  if (layout === 'accordion') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-2xl mx-auto px-6 md:px-16">
        <Header />
        {policyItems.length > 0 ? (
          <>
            <div className="space-y-2">
              {visibleItems.map((p: any, i: number) => {
                const isOpen = openIdx === i;
                return (
                  <div key={p.id || i}
                    className="overflow-hidden transition-all duration-300"
                    style={{
                      borderRadius: pbr(style, 1.5),
                      background: pBg(style, true),
                      borderTop: `1px solid ${pBorderColor(style, isOpen)}`,
                      borderRight: `1px solid ${pBorderColor(style, isOpen)}`,
                      borderBottom: `1px solid ${pBorderColor(style, isOpen)}`,
                      borderLeft: `3px solid ${isOpen ? ac(style) : ac(style) + '20'}`,
                      boxShadow: isOpen ? `0 6px 28px ${ac(style)}0c` : 'none',
                      animation: visible ? `cf-fade-up 0.45s ${i * 0.07}s both` : 'none',
                    }}>
                    <button className="w-full flex items-center gap-4 px-5 py-4 text-left"
                      onClick={() => setOpenIdx(isOpen ? null : i)}
                      style={{ WebkitTapHighlightColor: 'transparent' }}>
                      <div className="w-9 h-9 shrink-0 flex items-center justify-center transition-all duration-300"
                        style={{
                          background: isOpen ? ac(style) : pIconBg(style).background,
                          border: `1px solid ${isOpen ? ac(style) : ac(style) + '18'}`,
                          borderRadius: pbr(style, 1.2),
                        }}>
                        <PI id={p.icon} size="sm" color={isOpen ? 'white' : ac(style)} />
                      </div>
                      <span className="flex-1 font-black text-sm uppercase tracking-[0.14em] pr-2 text-left"
                        style={{ fontFamily: bf(style), color: pTextPrimary(style) }}>{p.title}</span>
                      <div className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-all duration-300"
                        style={{ borderColor: isOpen ? ac(style) + '60' : pBorderColor(style) }}>
                        <ChevronDown className="w-3 h-3 transition-transform duration-300"
                          style={{ color: isOpen ? ac(style) : pTextMuted(style), transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                      </div>
                    </button>
                    <div style={{
                      maxHeight: isOpen ? '300px' : '0px',
                      overflow: 'hidden',
                      opacity: isOpen ? 1 : 0,
                      transition: 'max-height 0.4s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease',
                    }}>
                      <div className="px-5 pb-6 pt-1">
                        <div className="h-px mb-4" style={{ background: pDivider(style) }} />
                        <p className="text-sm leading-relaxed pl-[3.25rem]"
                          style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );

  // ── EDITORIAL ──────────────────────────────────────────────────────────────
  if (layout === 'editorial') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="mb-12 pb-5" style={{ borderBottom: `1px solid ${pDivider(style)}` }}>
          <div className="flex items-end justify-between gap-4">
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="text-4xl md:text-6xl font-light leading-none min-w-0"
              style={{ fontFamily: hf(style), color: pTextPrimary(style) }}>
              {config.heading || 'Our Policies'}
            </FieldTap>
            <div className="hidden md:flex flex-col items-end gap-1 shrink-0 mb-1">
              <p className="text-[9px] font-black uppercase tracking-[0.35em]"
                style={{ color: ac(style) + '70' }}>
                {policyItems.length} {policyItems.length === 1 ? 'policy' : 'policies'}
              </p>
            </div>
          </div>
          <div className="h-px mt-1.5" style={{ background: ac(style) }} />
        </div>
        {policyItems.length > 0 ? (
          <>
            <div>
              {visibleItems.map((p: any, i: number) => (
                <div key={p.id || i}
                  className="group py-6 border-b last:border-0 transition-colors"
                  style={{
                    borderColor: pDivider(style),
                    animation: visible ? `cf-fade-up 0.45s ${i * 0.07}s both` : 'none',
                  }}>
                  <div className="flex items-start gap-3 md:hidden">
                    <div className="w-8 h-8 shrink-0 mt-0.5 flex items-center justify-center"
                      style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                      <PI id={p.icon} size="sm" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em]"
                          style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                        <span className="text-[9px] font-black tabular-nums"
                          style={{ color: ac(style) + '30', fontFamily: hf(style) }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed"
                        style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                    </div>
                  </div>
                  <div className="hidden md:grid md:grid-cols-[36px_180px_1fr] gap-4 items-start">
                    <div className="w-9 h-9 flex items-center justify-center mt-0.5 transition-transform duration-300 group-hover:scale-105"
                      style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                      <PI id={p.icon} size="sm" />
                    </div>
                    <div className="border-r pr-6" style={{ borderColor: pDivider(style) }}>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] leading-snug"
                        style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                      <div className="w-5 h-px mt-2 transition-all duration-400 group-hover:w-10"
                        style={{ background: ac(style) + '40' }} />
                    </div>
                    <p className="text-sm leading-relaxed pl-2"
                      style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );

  // ── DARK ───────────────────────────────────────────────────────────────────
  if (layout === 'dark') return (
    <section ref={ref} className={`${py(style)} overflow-hidden relative`}
      style={{ background: bgIsDark(style.bgColor) ? style.bgColor : '#08080f' }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          radial-gradient(ellipse 80% 55% at 10% 0%, ${ac(style)}22 0%, transparent 58%),
          radial-gradient(ellipse 60% 45% at 90% 105%, ${ac(style)}18 0%, transparent 58%),
          radial-gradient(ellipse 35% 28% at 52% 48%, ${ac(style)}07 0%, transparent 65%)`,
      }} />
      <div className="relative max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-14 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
            as="h2" className="text-4xl md:text-5xl font-light"
            style={{ fontFamily: hf(style), color: 'rgba(255,255,255,0.92)' }}>
            {config.heading || 'Our Policies'}
          </FieldTap>
          {config.subheading && (
            <p className="text-sm max-w-md mx-auto leading-relaxed"
              style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.40)' }}>
              {config.subheading}
            </p>
          )}
          <div className="flex justify-center items-center gap-2 pt-2">
            <div className="h-px w-8" style={{ background: ac(style) + '30' }} />
            <div className="h-px w-12" style={{ background: ac(style) + '70' }} />
            <div className="w-2 h-2 rounded-full" style={{ background: ac(style) }} />
            <div className="h-px w-12" style={{ background: ac(style) + '70' }} />
            <div className="h-px w-8" style={{ background: ac(style) + '30' }} />
          </div>
        </div>
        {policyItems.length > 0 ? (
          <>
            <div className="grid md:grid-cols-3 gap-4">
              {visibleItems.map((p: any, i: number) => (
                <div key={p.id || i}
                  className="group relative overflow-hidden cursor-default transition-all duration-300 hover:-translate-y-2 active:-translate-y-1 active:scale-[0.99] min-w-0"
                  style={{
                    borderRadius: pbr(style, 1.5),
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    WebkitTapHighlightColor: 'transparent',
                    animation: visible ? `cf-float-up 0.65s ${i * 0.1}s both` : 'none',
                  }}>
                  <div className="absolute top-0 inset-x-0 h-px opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-400"
                    style={{ background: `linear-gradient(to right, transparent 10%, ${ac(style)} 50%, transparent 90%)` }} />
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 group-active:opacity-60 transition-opacity duration-400 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at 50% 0%, ${ac(style)}12 0%, transparent 65%)` }} />
                  <div className={`relative ${pad} space-y-4`}>
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105 group-active:scale-95"
                        style={{
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.14)',
                          borderRadius: pbr(style, 1.5),
                        }}>
                        <PI id={p.icon} size="md" color="rgba(255,255,255,0.78)" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] leading-snug"
                          style={{ color: 'rgba(255,255,255,0.88)', fontFamily: bf(style) }}>{p.title}</p>
                        <div className="h-px w-6 mt-1.5 transition-all duration-500 group-hover:w-full"
                          style={{ background: `linear-gradient(to right, ${ac(style)}, transparent)` }} />
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed"
                      style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.62)' }}>{p.body}</p>
                  </div>
                  <div className="absolute bottom-4 right-4 text-[10px] font-black tabular-nums opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                    style={{ color: 'rgba(255,255,255,0.18)', fontFamily: hf(style) }}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-10 text-center">
              {!showAll && hasMore && (
                <button onClick={() => setShowAll(true)}
                  className="inline-flex items-center gap-2.5 px-8 py-3.5 font-black text-sm uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-95"
                  style={{
                    borderRadius: pbr(style, 3),
                    border: `2px solid rgba(255,255,255,0.15)`,
                    color: 'rgba(255,255,255,0.60)',
                    fontFamily: bf(style),
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  View all {policyItems.length} policies
                  <ChevronDown className="w-4 h-4" />
                </button>
              )}
              {showAll && hasMore && (
                <button onClick={() => setShowAll(false)}
                  className="inline-flex items-center gap-2.5 px-8 py-3.5 font-black text-sm uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-95"
                  style={{
                    borderRadius: pbr(style, 3),
                    border: `2px solid rgba(255,255,255,0.10)`,
                    color: 'rgba(255,255,255,0.35)',
                    fontFamily: bf(style),
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  Show less
                  <ChevronDown className="w-4 h-4 rotate-180" />
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="text-center text-[10px] font-black uppercase tracking-[0.25em] py-16"
            style={{ color: 'rgba(255,255,255,0.18)' }}>No policies configured yet</p>
        )}
      </div>
    </section>
  );

  // ── SPOTLIGHT ──────────────────────────────────────────────────────────────
  if (layout === 'spotlight') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16">
        <Header />
        {policyItems.length > 0 ? (
          <>
            <div>
              {visibleItems.map((p: any, i: number) => (
                <div key={p.id || i}
                  className="group relative flex items-center gap-5 md:gap-8 py-6 border-b last:border-0 transition-all duration-300 cursor-default"
                  style={{
                    borderColor: pDivider(style),
                    paddingLeft: '16px',
                    animation: visible ? `cf-fade-up 0.5s ${i * 0.08}s both` : 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  <div className="absolute left-0 top-3 bottom-3 rounded-full transition-all duration-300"
                    style={{ width: '3px', background: ac(style), opacity: 0.25 }} />
                  <div className="absolute left-0 top-3 bottom-3 rounded-full scale-y-0 group-hover:scale-y-100 transition-transform duration-400 origin-top"
                    style={{ width: '3px', background: ac(style) }} />
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center transition-all duration-300 group-hover:scale-105"
                    style={{ ...pIconBg(style), borderRadius: pbr(style, 1.5) }}>
                    <PI id={p.icon} size="md" />
                  </div>
                  <span className="text-2xl md:text-4xl font-light tabular-nums shrink-0 select-none"
                    style={{ fontFamily: hf(style), color: ac(style) + '18', lineHeight: 1, minWidth: '2.5rem', textAlign: 'right' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em]"
                      style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                    <div className="h-px w-7 transition-all duration-500 group-hover:w-14"
                      style={{ background: `${ac(style)}30` }} />
                    <p className="text-sm leading-relaxed"
                      style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                  </div>
                  <div className="hidden md:flex shrink-0 w-8 h-8 items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-2 group-hover:translate-x-0"
                    style={{ background: ac(style), borderRadius: pbr(style, 3), boxShadow: `0 4px 16px ${ac(style)}30` }}>
                    <ArrowRight className="w-3.5 h-3.5 text-white" />
                  </div>
                </div>
              ))}
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );

  // ── FROSTED ────────────────────────────────────────────────────────────────
  if (layout === 'frosted') {
    const frostedDark = bgIsDark(style.bgColor);
    return (
      <section ref={ref} className={`${py(style)} overflow-hidden relative`}
        style={{ background: style.bgColor }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: frostedDark
            ? `radial-gradient(ellipse at 20% 20%, ${ac(style)}15 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, ${ac(style)}10 0%, transparent 50%)`
            : `radial-gradient(ellipse at 20% 20%, ${ac(style)}0d 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, ${ac(style)}08 0%, transparent 50%)` }} />
        <div className="relative max-w-5xl mx-auto px-6 md:px-16">
          <Header />
          {policyItems.length > 0 ? (
            <>
              <div className="grid md:grid-cols-3 gap-4">
                {visibleItems.map((p: any, i: number) => (
                  <div key={p.id || i}
                    className="group relative overflow-hidden cursor-default transition-all duration-500 hover:-translate-y-1 active:scale-[0.99] min-w-0"
                    style={{
                      borderRadius: pbr(style, 1.5),
                      background: frostedDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.70)',
                      border: frostedDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(255,255,255,0.85)',
                      backdropFilter: 'blur(20px) saturate(1.3)',
                      WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
                      boxShadow: frostedDark ? '0 4px 20px rgba(0,0,0,0.3)' : '0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
                      WebkitTapHighlightColor: 'transparent',
                      animation: visible ? `cf-float-up 0.65s ${i * 0.09}s both` : 'none',
                    }}>
                    <div className="absolute top-0 inset-x-0 h-px"
                      style={{ background: frostedDark
                        ? 'linear-gradient(to right, transparent, rgba(255,255,255,0.12), transparent)'
                        : 'linear-gradient(to right, transparent, rgba(255,255,255,0.9), transparent)' }} />
                    <div className={`relative ${pad} space-y-4`}>
                      <div className="flex items-center justify-between">
                        <div className="w-11 h-11 flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                          style={{
                            background: frostedDark ? `${ac(style)}1c` : 'rgba(255,255,255,0.9)',
                            border: `1px solid ${ac(style)}18`,
                            borderRadius: pbr(style, 1.5),
                            boxShadow: frostedDark ? 'none' : `0 2px 8px ${ac(style)}0e`,
                          }}>
                          <PI id={p.icon} />
                        </div>
                        <span className="text-[10px] font-black tabular-nums select-none"
                          style={{ color: ac(style) + '30', fontFamily: hf(style) }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em]"
                          style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                        <p className="text-sm leading-relaxed"
                          style={{ fontFamily: bf(style), color: frostedDark ? 'rgba(255,255,255,0.55)' : pTextSecondary(style) }}>{p.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <ShowMoreBtn />
              <CollapseBtn />
            </>
          ) : <Empty />}
        </div>
      </section>
    );
  }

  // ── SCROLL ─────────────────────────────────────────────────────────────────
  // Scroll uses all items always — no show more needed
  if (layout === 'scroll') {
    const duration = Math.max(20, policyItems.length * 6);
    const looped = policyItems.length > 0
      ? [...policyItems, ...policyItems, ...policyItems]
      : [];
    return (
      <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
        <div className="max-w-5xl mx-auto px-6 md:px-16 mb-10">
          <div className="flex items-end justify-between gap-4">
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="text-4xl md:text-5xl font-light min-w-0"
              style={{ fontFamily: hf(style), color: pTextPrimary(style) }}>
              {config.heading || 'Our Policies'}
            </FieldTap>
            <p className="hidden md:block text-[9px] font-black uppercase tracking-[0.3em] mb-1 shrink-0"
              style={{ color: ac(style) + '55', fontFamily: bf(style) }}>Scroll to explore</p>
          </div>
          {config.subheading && (
            <p className="text-sm mt-2"
              style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{config.subheading}</p>
          )}
          <div className="h-px mt-5"
            style={{ background: `linear-gradient(to right, ${ac(style)}25, transparent)` }} />
        </div>
        {policyItems.length > 0 ? (
          <div className="cf-scroll-wrap relative"
            style={{
              maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
            }}>
            <div className="cf-scroll-track flex gap-4 w-max px-6"
              style={{ animation: `cf-hscroll ${duration}s linear infinite` }}>
              {looped.map((p: any, i: number) => (
                <div key={`${p.id || i}-${i}`}
                  className="group flex-shrink-0 cursor-default transition-all duration-300 hover:-translate-y-1 overflow-hidden"
                  style={{
                    width: '240px',
                    borderRadius: pbr(style, 1.5),
                    background: pBg(style, true),
                    border: `1px solid ${pBorderColor(style)}`,
                    boxShadow: pBoxShadow(style, true),
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  <div className={`${pad} space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                        style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                        <PI id={p.icon} size="sm" />
                      </div>
                      <span className="text-[10px] font-black tabular-nums select-none"
                        style={{ color: ac(style) + '25', fontFamily: hf(style) }}>
                        {String((i % policyItems.length) + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em]"
                        style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                      <p className="text-xs leading-relaxed line-clamp-3"
                        style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                    </div>
                  </div>
                  <div className="h-[2px] w-0 group-hover:w-full transition-all duration-500"
                    style={{ background: `linear-gradient(to right, ${ac(style)}, ${ac(style)}55)` }} />
                </div>
              ))}
            </div>
          </div>
        ) : <Empty />}
      </section>
    );
  }

  // ── fallback ───────────────────────────────────────────────────────────────
  return (
    <section className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <Header />
        {policyItems.length > 0 ? (
          <>
            <div className="grid md:grid-cols-3 gap-5">
              {visibleItems.map((p: any, i: number) => (
                <div key={p.id || i}
                  className="overflow-hidden transition-all duration-300 hover:-translate-y-1 min-w-0"
                  style={{
                    borderRadius: pbr(style, 1.5),
                    background: pBg(style, true),
                    border: `1px solid ${pBorderColor(style)}`,
                    boxShadow: pBoxShadow(style, true),
                  }}>
                  <div className={`${pad} space-y-4`}>
                    <div className="w-10 h-10 flex items-center justify-center"
                      style={{ ...pIconBg(style), borderRadius: pbr(style, 1.2) }}>
                      <PI id={p.icon} />
                    </div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em]"
                      style={{ color: ac(style), fontFamily: bf(style) }}>{p.title}</p>
                    <p className="text-sm leading-relaxed"
                      style={{ fontFamily: bf(style), color: pTextSecondary(style) }}>{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <ShowMoreBtn />
            <CollapseBtn />
          </>
        ) : <Empty />}
      </div>
    </section>
  );
}

// ─── ContactSection ───────────────────────────────────────────────────────────
function ContactSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const layout = config.layout || 'split-map';
  const accent = ac(style);
  const { ref, visible } = useInView(0.06);
  const tenant = data.tenant;
 
  const showHeading = config.showHeading !== false;
 
  const Info = () => (
    <div className="space-y-6">
      {showHeading && (
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h2" className="font-light leading-tight"
          style={{ fontFamily: hf(style), fontSize: 'clamp(24px,4vw,48px)', color: '#0f172a' }}>
          {config.heading || 'Find Us'}
        </FieldTap>
      )}
 
      {config.showHours !== false && config.customHours && (
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.3em]"
            style={{ color: accent, fontFamily: bf(style) }}>Hours</p>
          <div className="space-y-1">
            {config.customHours.split('\n').filter(Boolean).map((line: string, i: number) => (
              <p key={i} className="text-sm text-slate-600 font-light" style={{ fontFamily: bf(style) }}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
 
      <div className="space-y-3">
        {config.showPhone !== false && tenant?.phone && (
          <a href={`tel:${tenant.phone}`}
            className="flex items-center gap-3 text-sm font-bold text-slate-700 hover:text-slate-900 transition-colors"
            style={{ fontFamily: bf(style) }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${accent}10` }}>
              <Phone className="w-3.5 h-3.5" style={{ color: accent }}/>
            </div>
            {tenant.phone}
          </a>
        )}
        {config.showEmail !== false && tenant?.email && (
          <a href={`mailto:${tenant.email}`}
            className="flex items-center gap-3 text-sm font-bold text-slate-700 hover:text-slate-900 transition-colors"
            style={{ fontFamily: bf(style) }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${accent}10` }}>
              <Mail className="w-3.5 h-3.5" style={{ color: accent }}/>
            </div>
            <span className="truncate">{tenant.email}</span>
          </a>
        )}
        {tenant?.address && (
          <div className="flex items-start gap-3 text-sm font-light text-slate-600"
            style={{ fontFamily: bf(style) }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: `${accent}10` }}>
              <MapPin className="w-3.5 h-3.5" style={{ color: accent }}/>
            </div>
            <span className="leading-relaxed">{tenant.address}</span>
          </div>
        )}
      </div>
 
      <button
        onClick={cta(config.ctaAction, config.ctaUrl)}
        className="inline-flex items-center gap-2 font-black uppercase tracking-widest
                   hover:opacity-90 active:scale-[0.97] transition-all whitespace-nowrap"
        style={{
          ...btnStyle(style), fontFamily: bf(style),
          padding: 'clamp(12px,2.5vw,15px) clamp(22px,4vw,36px)',
          fontSize: 'clamp(10px,2vw,11px)', letterSpacing: '0.12em',
        }}>
        {config.ctaText || 'Book an Appointment'}
        <ArrowRight className="w-3.5 h-3.5 shrink-0"/>
      </button>
    </div>
  );
 
  // Map embed placeholder
  const MapEmbed = () => config.showMap !== false && tenant?.address ? (
    <div className="overflow-hidden bg-slate-100"
      style={{ borderRadius: br(style, 1.5), aspectRatio: '4/3', minHeight: 220 }}>
      <iframe
        title="map"
        src={`https://maps.google.com/maps?q=${encodeURIComponent(tenant.address)}&output=embed`}
        className="w-full h-full border-0"
        loading="lazy"
        allowFullScreen/>
    </div>
  ) : null;
 
  if (layout === 'split-map') {
    return (
      <section id="contact" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto" style={{ padding: '0 clamp(16px,5vw,64px)' }}>
          <div ref={ref}
            className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-start"
            style={{ animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>
            <Info/>
            <MapEmbed/>
          </div>
        </div>
      </section>
    );
  }
 
  // stacked
  return (
    <section id="contact" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-3xl mx-auto space-y-8 md:space-y-10"
        style={{ padding: '0 clamp(16px,5vw,48px)' }}>
        <div ref={ref} style={{ animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>
          <MapEmbed/>
        </div>
        <Info/>
      </div>
    </section>
  );
}
 
// ─── ReferralSection ──────────────────────────────────────────────────────────
function ReferralSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Refer a Friend'}</FieldTap>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid grid-cols-2 gap-5 max-w-md mx-auto">
          {[{l:'You get', v:config.rewardYou, k:'rewardYou'}, {l:'Friend gets', v:config.rewardFriend, k:'rewardFriend'}].map((item,i) => (
            <div key={i} className="p-6 bg-white space-y-2" style={{ borderRadius: br(style,1.5), border: `2px solid ${ac(style)}22` }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.l}</p>
              <FieldTap sectionId={sectionId} fieldKey={item.k} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-2xl font-black" style={{ fontFamily: hf(style), color: ac(style) }}>{item.v}</FieldTap>
            </div>
          ))}
        </div>
        <button onClick={cta(config.ctaAction, config.ctaUrl)} className="px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.ctaText || 'Get My Referral Link'}</button>
      </div>
    </section>
  );
}

// ─── StorySection ─────────────────────────────────────────────────────────────
function StorySection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const hasImage = !!config.image;
  const layout = config.layout || 'split';

  const EyebrowTag = () => config.tag ? (
    <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] mb-2" style={{ background: ac(style)+'14', color: ac(style), borderRadius: '999px' }}>{config.tag}</span>
  ) : null;

  const Stats = () => (config.stat1Label || config.stat2Label) ? (
    <div className="flex gap-8 pt-2">
      {config.stat1Value && config.stat1Label && <div><p className="text-2xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{config.stat1Value}</p><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{config.stat1Label}</p></div>}
      {config.stat2Value && config.stat2Label && <div><p className="text-2xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>{config.stat2Value}</p><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{config.stat2Label}</p></div>}
    </div>
  ) : null;

  const CtaBtn = ({ dark = false }: { dark?: boolean }) => config.ctaText ? (
    <button onClick={cta(config.ctaAction, config.ctaUrl)} className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all"
      style={dark ? { background: 'white', color: ac(style), borderRadius: br(style), fontFamily: bf(style) } : { ...btnStyle(style,'secondary'), fontFamily: bf(style) }}>
      {config.ctaText} <ArrowRight className="w-3.5 h-3.5"/>
    </button>
  ) : null;

  if (layout === 'immersive') return (
    <section className="relative overflow-hidden" style={{ minHeight: '80vh', background: '#0c0c0e' }}>
      {hasImage && <><img src={config.image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35"/><div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 100%)' }}/></>}
      {!hasImage && <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 30% 50%, ${ac(style)}25 0%, #0c0c0e 70%)` }}/>}
      <div className="relative z-10 max-w-5xl mx-auto px-8 md:px-14 py-28 flex flex-col justify-center min-h-[80vh]">
        <div className="max-w-xl space-y-7">
          <EyebrowTag/><div className="w-12 h-px" style={{ background: ac(style) }}/>
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="font-light leading-[0.9] text-white" style={{ fontSize: 'clamp(40px,6vw,76px)', fontFamily: hf(style) }}>{config.heading || 'Our Story'}</FieldTap>
          {config.pullQuote && <p className="text-xl font-light italic" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>}
          <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base leading-relaxed" style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.62)' }}>{config.body}</FieldTap>
          {config.body2 && <p className="text-base leading-relaxed" style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.42)' }}>{config.body2}</p>}
          <Stats/><CtaBtn dark/>
        </div>
      </div>
    </section>
  );

  if (layout === 'founder') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-8 md:px-14">
        <div className="grid md:grid-cols-[1fr_1.6fr] gap-14 md:gap-20 items-center">
          <div className="relative">
            {hasImage
              ? <div className="relative"><img src={config.image} alt="" className="w-full aspect-[3/4] object-cover shadow-2xl" style={{ borderRadius: br(style,2) }}/><div className="absolute -bottom-4 -right-4 w-20 h-20 flex items-center justify-center text-white text-3xl font-light shadow-xl" style={{ background: ac(style), borderRadius: br(style,1.5), fontFamily: hf(style) }}>{(config.heading||'S')[0]}</div></div>
              : <div className="w-full aspect-[3/4] flex items-center justify-center" style={{ background: ac(style)+'0e', borderRadius: br(style,2), border: `2px solid ${ac(style)}18` }}><span className="text-8xl font-light" style={{ color: ac(style)+'30', fontFamily: hf(style) }}>{(config.heading||'S')[0]}</span></div>}
          </div>
          <div className="space-y-7">
            <EyebrowTag/>
            {config.pullQuote && <p className="text-2xl md:text-3xl font-light italic leading-relaxed" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>}
            <div className="w-10 h-px" style={{ background: ac(style) }}/>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</FieldTap>
            <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</FieldTap>
            {config.body2 && <p className="text-base text-slate-400 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body2}</p>}
            <Stats/><CtaBtn/>
          </div>
        </div>
      </div>
    </section>
  );

  if (layout === 'manifesto') return (
    <section className={cn(py(style), 'relative overflow-hidden')} style={{ background: style.bgColor }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 80% 50%, ${ac(style)}07 0%, transparent 60%)` }}/>
      <div className="max-w-5xl mx-auto px-8 md:px-14 relative z-10">
        <EyebrowTag/>
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="font-light leading-[0.85] mb-10" style={{ fontSize: 'clamp(52px,10vw,120px)', fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</FieldTap>
        <div className="grid md:grid-cols-[2px_1fr] gap-8 md:gap-14 items-start">
          <div className="hidden md:block self-stretch" style={{ background: ac(style)+'30' }}/>
          <div className="space-y-6 max-w-2xl">
            {config.pullQuote && <p className="text-2xl font-light italic" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>}
            <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-lg text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</FieldTap>
            {config.body2 && <p className="text-base text-slate-400 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body2}</p>}
            <Stats/><CtaBtn/>
          </div>
        </div>
      </div>
    </section>
  );

  if (layout === 'editorial') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-8 md:px-14">
        <div className="grid md:grid-cols-[auto_1fr] gap-10 md:gap-16 items-start">
          <div className="hidden md:flex flex-col items-center gap-3 pt-3">
            <span className="text-[9px] font-black uppercase tracking-[0.35em] text-slate-400" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{config.tag || 'Story'}</span>
            <div className="flex-1 w-px min-h-[200px]" style={{ background: ac(style)+'25' }}/>
            <span className="text-[9px] font-black text-slate-300">01</span>
          </div>
          <div className="space-y-10">
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="font-light leading-[0.88]" style={{ fontSize: 'clamp(44px,7vw,92px)', fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</FieldTap>
            <div className="grid md:grid-cols-2 gap-8 items-start">
              {hasImage && <img src={config.image} alt="" className="w-full aspect-[3/4] object-cover" style={{ borderRadius: br(style,1.5) }}/>}
              <div className="space-y-6">
                {config.pullQuote && <p className="text-xl font-light italic border-l-2 pl-5" style={{ fontFamily: hf(style), color: ac(style), borderColor: ac(style) }}>"{config.pullQuote}"</p>}
                <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</FieldTap>
                {config.body2 && <p className="text-sm text-slate-400 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body2}</p>}
                <Stats/><CtaBtn/>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  if (layout === 'minimal') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-2xl mx-auto px-8 md:px-14 text-center space-y-8">
        <EyebrowTag/>
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px" style={{ background: ac(style)+'20' }}/>
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-4xl font-light whitespace-nowrap" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</FieldTap>
          <div className="flex-1 h-px" style={{ background: ac(style)+'20' }}/>
        </div>
        {config.pullQuote && <p className="text-xl font-light italic" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>}
        <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</FieldTap>
        {config.body2 && <p className="text-base text-slate-400 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body2}</p>}
        <Stats/><CtaBtn/>
      </div>
    </section>
  );

  // default: split / centered
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className={cn('grid gap-14 items-center', hasImage ? 'md:grid-cols-2' : 'max-w-2xl mx-auto')}>
          <div className="space-y-8">
            <EyebrowTag/>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Our Story'}</FieldTap>
            <div className="w-12 h-px" style={{ background: ac(style) }}/>
            {config.pullQuote && <p className="text-2xl font-light italic" style={{ fontFamily: hf(style), color: ac(style) }}>"{config.pullQuote}"</p>}
            <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body}</FieldTap>
            {config.body2 && <p className="text-base text-slate-400 leading-relaxed" style={{ fontFamily: bf(style) }}>{config.body2}</p>}
            <Stats/><CtaBtn/>
          </div>
          {hasImage && <img src={config.image} alt="Our Story" className="w-full aspect-square object-cover shadow-2xl" style={{ borderRadius: br(style,2) }}/>}
        </div>
      </div>
    </section>
  );
}

// ─── InstagramSection ─────────────────────────────────────────────────────────
function InstagramSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const uploaded: any[] = Array.isArray(config.images) ? config.images : [], layout = config.layout || 'grid', cols = parseInt(config.columns) || 4;
  const gridCls = cols === 3 ? 'grid-cols-3' : cols === 6 ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-4';
  const shades = ['10','14','18','12','16','1a'], imgs = uploaded.length > 0 ? uploaded.slice(0,8) : shades.map((s,i) => ({ id:i, url:null, shade:s }));
  const Head = () => <div className="space-y-3"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Follow Along'}</FieldTap><FieldTap sectionId={sectionId} fieldKey="handle" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-400">{config.handle || '@studio'}</FieldTap></div>;
  if (layout === 'banner') return (<section className={py(style)} style={{ background: '#f8fafc' }}><div className="max-w-6xl mx-auto px-6 md:px-16 text-center space-y-10"><Head/><div className="flex gap-3 overflow-x-auto snap-x pb-2" style={{ scrollbarWidth: 'none' }}>{[...imgs,...imgs].map((item:any,i:number) => <div key={i} className="shrink-0 snap-start w-48 h-48 overflow-hidden rounded-xl group">{item.url ? <img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/> : <div className="w-full h-full" style={{ background: ac(style)+item.shade }}/>}</div>)}</div><a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btnStyle(style,'secondary'), fontFamily: bf(style) }}><Instagram className="w-4 h-4"/>{config.ctaText || 'Follow us'}</a></div></section>);
  return (<section className={py(style)} style={{ background: '#f8fafc' }}><div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12"><Head/><div className={`grid ${gridCls} gap-2`}>{imgs.map((item:any,i:number) => <div key={i} className="aspect-square overflow-hidden group" style={{ borderRadius: br(style) }}>{item.url ? <img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/> : <div className="w-full h-full" style={{ background: ac(style)+item.shade }}/>}</div>)}</div><a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{ ...btnStyle(style,'secondary'), fontFamily: bf(style) }}><Instagram className="w-4 h-4"/>{config.ctaText || 'Follow us on Instagram'}</a></div></section>);
}

// ─── WaitlistSection ──────────────────────────────────────────────────────────
function WaitlistSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const hasBg = !!config.bgImage;
  return (
    <section className={cn(py(style), 'relative')} style={{ background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : style.bgColor }}>
      {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }}/>}
      <div className="relative max-w-lg mx-auto px-6 md:px-16 text-center space-y-8">
        <div className="space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: hasBg ? 'white' : '#0f172a' }}>{config.heading || 'Fully Booked?'}</FieldTap>
          {config.subheading && <p className="text-base" style={{ fontFamily: bf(style), color: hasBg ? 'rgba(255,255,255,0.75)' : '#64748b' }}>{config.subheading}</p>}
        </div>
        <div className="flex gap-2">
          <input type="email" placeholder="your@email.com" className="flex-1 px-4 py-3 text-sm focus:outline-none" style={{ borderRadius: br(style), border: `2px solid ${hasBg ? 'rgba(255,255,255,0.3)' : ac(style)+'40'}`, fontFamily: bf(style), background: hasBg ? 'rgba(255,255,255,0.1)' : 'white', color: hasBg ? 'white' : 'inherit' }}/>
          <button onClick={cta(config.ctaAction, config.ctaUrl)} className="px-6 py-3 font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.ctaText || 'Join'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({ tenant, style }: { tenant: any; style: StyleConfig }) {
  return (
    <footer className="py-8 border-t text-center" style={{ borderColor: ac(style)+'20' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>
        {tenant?.name || 'Studio'} · Powered by ClarityFlow
      </p>
    </footer>
  );
}

// ─── SectionRenderer ──────────────────────────────────────────────────────────
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
  SECTION_LABEL_MAP, SECTION_ICON_MAP,
};
