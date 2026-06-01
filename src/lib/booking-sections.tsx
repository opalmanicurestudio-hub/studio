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

  // ── Scroll-aware transparency ──────────────────────────────────────────────
  useEffect(() => {
    if (!config.transparent || isPreview) return;
    const handler = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handler, { passive: true });
    handler(); // run once on mount
    return () => window.removeEventListener('scroll', handler);
  }, [config.transparent, isPreview]);

  // ── Resolve whether nav is currently in "dark" (light-text) mode ──────────
  const isDark =
    config.navTheme === 'dark' ||
    (config.transparent && !scrolled && config.navTheme !== 'light');

  // ── Pick the right logo src ────────────────────────────────────────────────
  const resolveLogoSrc = (): string | null => {
    if (isDark  && config.logoLightUrl) return config.logoLightUrl;
    if (!isDark && config.logoDarkUrl)  return config.logoDarkUrl;
    return config.logoUrl || null;
  };

  // ── CSS filter fallback when only one logo uploaded ────────────────────────
  const logoFilter = (): string => {
    if (isDark && !config.logoLightUrl && config.logoUrl)
      return 'brightness(0) invert(1)';
    return 'none';
  };

  // ── Dynamic nav background ─────────────────────────────────────────────────
  const navBg = (): string => {
    const custom = config.navBgColor as string | undefined;
    if (custom) return custom;                         // custom color always wins
    if (!config.transparent) return 'rgba(255,255,255,0.95)';
    if (scrolled)             return 'rgba(255,255,255,0.97)';
    return 'transparent';
  };

  const navBorderColor = (): string => {
    if (config.navBgColor) return 'transparent';        // custom bg: no border needed
    if (!config.transparent || scrolled) return ac(style) + '18';
    return 'transparent';
  };

  const textColor  = isDark ? 'rgba(255,255,255,0.85)' : '#0f172a';
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : '#64748b';
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
    if (rawEnabledSections) {
      rawEnabledSections.forEach(t => {
        if (SECTION_LABEL_MAP[t]) map[SECTION_LABEL_MAP[t]] = t;
      });
    }
    return map;
  }, [rawEnabledSections]);

  const linkHref = (label: string) => {
    const type = labelToType[label];
    return type ? `#${type}` : `#${label.toLowerCase().replace(/\s+/g, '-')}`;
  };

  // ── Logo component ─────────────────────────────────────────────────────────
  const Logo = () => {
    if (logoSrc) return (
      <img
        src={logoSrc}
        alt={config.logoText || 'Logo'}
        style={{
          height: logoMaxH,
          width: 'auto',
          maxWidth: 180,
          objectFit: 'contain',
          filter: logoFilter(),
          transition: 'filter 0.3s ease',
          display: 'block',
        }}
      />
    );
    return (
      <FieldTap sectionId={sectionId} fieldKey="logoText"
        isPreview={isPreview} onFieldTap={onFieldTap} as="span"
        style={{
          fontFamily: hf(style),
          color: isDark ? 'rgba(255,255,255,0.9)' : ac(style),
          fontSize: '20px',
          fontWeight: 'bold',
          letterSpacing: '-0.05em',
          transition: 'color 0.3s ease',
        }}>
        {config.logoText || 'Studio'}
      </FieldTap>
    );
  };

  // ── Nav links ──────────────────────────────────────────────────────────────
  const Links = ({ className = '' }: { className?: string }) =>
    config.showLinks !== false ? (
      <div className={cn('flex items-center gap-6 md:gap-8', className)}>
        {navLinks.map(l => (
          <a key={l} href={linkHref(l)}
            className="text-[11px] font-black uppercase tracking-widest transition-colors flex-shrink-0 hover:opacity-100"
            style={{ color: mutedColor, fontFamily: bf(style) }}>
            {l}
          </a>
        ))}
      </div>
    ) : null;

  // ── CTA button ─────────────────────────────────────────────────────────────
  const Cta = ({ size = 'default', className = '' }: { size?: 'default' | 'sm'; className?: string }) => (
    <FieldTap sectionId={sectionId} fieldKey="ctaText"
      isPreview={isPreview} onFieldTap={onFieldTap} as="span">
      <button
        onClick={cta(config.ctaAction, config.ctaUrl)}
        className={cn(
          'font-black uppercase tracking-widest hover:opacity-90 transition-all active:scale-95',
          className,
          size === 'sm' ? 'px-4 py-2 text-[10px]' : 'px-6 py-2.5 text-[11px]',
        )}
        style={{
          // On transparent dark navs, use a ghost white button
          ...(isDark
            ? { background: 'rgba(255,255,255,0.15)', color: 'white',
                border: '1.5px solid rgba(255,255,255,0.35)',
                borderRadius: style.buttonStyle === 'pill' ? '999px' : br(style, 0.6) }
            : { ...btnStyle(style) }),
          fontFamily: bf(style),
          transition: 'all 0.3s ease',
          boxShadow: isDark ? 'none' : undefined,
        }}>
        {config.ctaText || 'Book Now'}
      </button>
    </FieldTap>
  );

  // ── Hamburger ──────────────────────────────────────────────────────────────
  const HamburgerBtn = ({ className = '' }: { className?: string }) => {
    const iconStyle = (config.drawerIconStyle as string) || 'hamburger';
    // Give the button a subtle background pill so it's always legible
    const btnBg = isDark ? 'rgba(255,255,255,0.12)' : `${ac(style)}0e`;
    return (
      <button
        onClick={() => setDrawerOpen(true)}
        className={cn('w-10 h-10 flex items-center justify-center rounded-xl transition-all active:scale-95', className)}
        style={{ background: btnBg }}
        aria-label="Open menu">
        {iconStyle === 'hamburger' && (
          <div className="flex flex-col items-center gap-[5px]">
            <span className="w-5 h-0.5 block rounded-full transition-all" style={{ background: textColor }}/>
            <span className="w-3.5 h-0.5 block rounded-full transition-all" style={{ background: textColor }}/>
            <span className="w-5 h-0.5 block rounded-full transition-all" style={{ background: textColor }}/>
          </div>
        )}
        {iconStyle === 'minimal' && (
          <div className="flex flex-col items-center gap-[6px]">
            <span className="w-5 h-0.5 block rounded-full" style={{ background: textColor }}/>
            <span className="w-5 h-0.5 block rounded-full" style={{ background: textColor }}/>
          </div>
        )}
        {iconStyle === 'bold' && (
          <div className="flex flex-col items-center gap-[5px]">
            <span className="w-5 h-[3px] block rounded-full" style={{ background: textColor }}/>
            <span className="w-5 h-[3px] block rounded-full" style={{ background: textColor }}/>
            <span className="w-5 h-[3px] block rounded-full" style={{ background: textColor }}/>
          </div>
        )}
        {iconStyle === 'dots' && (
          <div className="flex flex-col items-center gap-[5px]">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: textColor }}/>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: textColor }}/>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: textColor }}/>
          </div>
        )}
        {iconStyle === 'grid' && (
          <div className="grid grid-cols-2 gap-[5px]">
            {[0,1,2,3].map(i => (
              <div key={i} className="w-[7px] h-[7px] rounded-sm" style={{ background: textColor }}/>
            ))}
          </div>
        )}
      </button>
    );
  };
 
  // ── Drawer ─────────────────────────────────────────────────────────────────
  const Drawer = () => !drawerOpen ? null : (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        style={{ zIndex: 200 }}
        onClick={() => setDrawerOpen(false)}
      />
 
      {/* Panel */}
      <div
        className="fixed inset-y-0 right-0 flex flex-col bg-white"
        style={{
          zIndex: 201,
          width: '100%',
          maxWidth: '360px',
          boxShadow: '-20px 0 80px rgba(0,0,0,0.20)',
          animation: 'cf-slide-right 0.32s cubic-bezier(0.16,1,0.3,1) both',
        }}>
 
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5 shrink-0"
          style={{ borderBottom: `1.5px solid ${ac(style)}10` }}>
          {/* Logo */}
          {config.logoDarkUrl || config.logoUrl
            ? <img
                src={config.logoDarkUrl || config.logoUrl}
                alt={config.logoText || 'Logo'}
                style={{ height: Math.min(parseInt(config.logoMaxHeight || '40'), 40),
                  width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block' }}
              />
            : <span style={{ fontFamily: hf(style), color: ac(style), fontSize: '18px',
                fontWeight: 900, letterSpacing: '-0.04em' }}>
                {config.logoText || 'Studio'}
              </span>}
 
          {/* Close */}
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
            style={{ background: `${ac(style)}0e`, border: `1.5px solid ${ac(style)}18` }}
            aria-label="Close menu">
            <XIcon className="w-4 h-4" style={{ color: ac(style) }}/>
          </button>
        </div>
 
        {/* ── Nav links ── */}
        <nav className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-4 py-3">
            {navLinks.map((link, i) => (
              <a
                key={link}
                href={linkHref(link)}
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-between py-4 px-3 -mx-1 rounded-xl
                           border-b last:border-0 group active:scale-[0.99] transition-all"
                style={{
                  borderColor: `${ac(style)}08`,
                  animation: `cf-fade-up 0.32s ${i * 0.04}s both`,
                }}>
                <span
                  className="text-base font-black uppercase tracking-tight"
                  style={{ fontFamily: hf(style), color: '#0f172a' }}>
                  {link}
                </span>
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center
                             opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  style={{ background: `${ac(style)}12` }}>
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: ac(style) }}/>
                </div>
              </a>
            ))}
          </div>
 
          {/* ── Extra / overflow sections ── */}
          {rawEnabledSections && rawEnabledSections.filter(t => t !== 'nav').length > navLinks.length && (
            <div className="px-4 py-4"
              style={{ borderTop: `1px solid ${ac(style)}08` }}>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-3 px-3"
                style={{ color: `${ac(style)}70`, fontFamily: bf(style) }}>
                More
              </p>
              <div className="flex flex-wrap gap-1.5">
                {rawEnabledSections
                  .filter(t => t !== 'nav' && SECTION_LABEL_MAP[t] && !navLinks.includes(SECTION_LABEL_MAP[t]))
                  .map((t, i) => {
                    const SIcon = SECTION_ICON_MAP[t];
                    return (
                      <a key={t} href={`#${t}`}
                        onClick={() => setDrawerOpen(false)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border
                                   transition-all active:scale-95"
                        style={{
                          borderColor: `${ac(style)}18`,
                          background: `${ac(style)}06`,
                          animation: `cf-fade-up 0.28s ${i * 0.03}s both`,
                        }}>
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
 
          {/* ── Quick book ── */}
          {config.showQuickBook !== false && data.services.length > 0 && (
            <div className="px-4 py-4"
              style={{ borderTop: `1px solid ${ac(style)}08` }}>
              <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-3 px-3"
                style={{ color: ac(style), fontFamily: bf(style) }}>
                Quick Book
              </p>
              <div className="space-y-0.5">
                {data.services
                  .slice(0, parseInt(config.quickBookLimit || '6'))
                  .map((svc: any) => (
                    <button key={svc.id}
                      onClick={() => { openBooking(svc); setDrawerOpen(false); }}
                      className="w-full flex items-center justify-between px-3 py-3
                                 rounded-xl hover:bg-slate-50 active:bg-slate-100
                                 transition-colors text-left group"
                      style={{ WebkitTapHighlightColor: 'transparent' }}>
                      <span className="text-sm font-bold text-slate-700 truncate"
                        style={{ fontFamily: bf(style) }}>
                        {svc.name}
                      </span>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {svc.price && (
                          <span className="text-sm font-black" style={{ color: ac(style), fontFamily: hf(style) }}>
                            ${svc.price}
                          </span>
                        )}
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center
                                        opacity-0 group-hover:opacity-100 transition-all"
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
 
        {/* ── Footer CTA ── */}
        <div className="px-5 shrink-0"
          style={{
            borderTop: `1.5px solid ${ac(style)}10`,
            paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
            paddingTop: '16px',
          }}>
          <button
            onClick={() => {
              cta(config.ctaAction, config.ctaUrl)({ stopPropagation: () => {} } as any);
              setDrawerOpen(false);
            }}
            className="w-full py-4 font-black text-sm uppercase tracking-widest
                       hover:opacity-90 active:scale-[0.99] transition-all whitespace-nowrap"
            style={{ ...btnStyle(style), fontFamily: bf(style), borderRadius: `${Math.min((style.borderRadius || 4), 16)}px` }}>
            {config.ctaText || 'Book Now'}
          </button>
          {data.tenant?.phone && (
            <a href={`tel:${data.tenant.phone}`}
              className="block w-full py-3 text-center text-[11px] font-black uppercase
                         tracking-widest transition-colors"
              style={{ color: `${ac(style)}60`, fontFamily: bf(style) }}>
              {data.tenant.phone}
            </a>
          )}
        </div>
      </div>
    </>
  );

  // ── Shared nav style object (for layouts that use it) ─────────────────────
  const solidNavStyle: React.CSSProperties = {
    background:          navBg(),
    borderColor:         navBorderColor(),
    backdropFilter:      !config.navBgColor && (!config.transparent || scrolled) ? 'blur(20px) saturate(1.8)' : 'none',
    WebkitBackdropFilter:!config.navBgColor && (!config.transparent || scrolled) ? 'blur(20px) saturate(1.8)' : 'none',
    transition:          navTransition,
  };

  // ── floating pill ──────────────────────────────────────────────────────────
  if (layout === 'floating') return (
    <>
      <div className={cn('flex justify-center px-4 pt-3', config.sticky !== false && 'sticky top-3')}
        style={navZ}>
        <nav className="flex items-center gap-3 md:gap-4 px-4 md:px-6 py-2.5 md:py-3 w-full max-w-2xl"
          style={{
            background: config.transparent && !scrolled ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: '999px', border: '1.5px solid rgba(0,0,0,0.07)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
            transition: navTransition,
          }}>
          <Logo />
          {config.showLinks !== false && (
            <div className="flex items-center gap-6 flex-1 overflow-x-auto"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none' }}>
              {navLinks.map(l => (
                <a key={l} href={linkHref(l)}
                  className="text-[11px] font-black uppercase tracking-widest transition-colors flex-shrink-0"
                  style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Cta size="sm" className="hidden md:inline-flex" />
            <HamburgerBtn className="md:hidden" />
          </div>
        </nav>
      </div>
      <Drawer />
    </>
  );

  // ── bold stacked ───────────────────────────────────────────────────────────
  if (layout === 'bold') return (
    <>
      <nav className={cn('w-full border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <div className="flex flex-col items-center gap-1 py-4 px-6">
          <Logo />
          <div className="flex items-center gap-4 md:gap-6 flex-wrap justify-center mt-1">
            <Links className="hidden md:flex" />
            <Cta size="sm" />
            <HamburgerBtn className="md:hidden" />
          </div>
        </div>
      </nav>
      <Drawer />
    </>
  );

  // ── split ──────────────────────────────────────────────────────────────────
  if (layout === 'split') return (
    <>
      <nav className={cn('grid grid-cols-3 items-center px-8 py-4 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <div className="hidden md:flex items-center gap-6 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {navLinks.slice(0, 3).map(l => (
            <a key={l} href={linkHref(l)}
              className="text-[11px] font-black uppercase tracking-widest transition-colors flex-shrink-0"
              style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
          ))}
        </div>
        <div className="flex items-center justify-between md:justify-center">
          <Logo />
          <HamburgerBtn className="md:hidden" />
        </div>
        <div className="hidden md:flex items-center justify-end gap-6">
          {navLinks.slice(3, 6).map(l => (
            <a key={l} href={linkHref(l)}
              className="text-[11px] font-black uppercase tracking-widest transition-colors"
              style={{ color: mutedColor, fontFamily: bf(style) }}>{l}</a>
          ))}
          <Cta size="sm" />
        </div>
      </nav>
      <Drawer />
    </>
  );

  // ── logo-top ───────────────────────────────────────────────────────────────
  if (layout === 'logo-top') return (
    <>
      <nav className={cn('flex flex-col items-center gap-1.5 py-4 px-6 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo />
        <div className="flex items-center gap-4 md:gap-6">
          <Links className="hidden md:flex" />
          <Cta size="sm" />
          <HamburgerBtn className="md:hidden" />
        </div>
      </nav>
      <Drawer />
    </>
  );

  // ── drawer ─────────────────────────────────────────────────────────────────
  if (layout === 'drawer') return (
    <>
      <nav className={cn('flex items-center justify-between px-6 py-4 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo />
        <div className="flex items-center gap-3">
          <Cta size="sm" className="hidden sm:inline-flex" />
          <HamburgerBtn />
        </div>
      </nav>
      <Drawer />
    </>
  );

  // ── bottom-bar ─────────────────────────────────────────────────────────────
  if (layout === 'bottom-bar') {
    const barSections = (rawEnabledSections ?? [])
      .filter(t => t !== 'nav' && t !== 'trust' && t !== 'waitlist' && SECTION_ICON_MAP[t]);
    const barItems = barSections.length > 0
      ? barSections.map(t => ({
          Icon: SECTION_ICON_MAP[t] ?? BookOpen,
          label: SECTION_LABEL_MAP[t] ?? t,
          href: `#${t}`,
          type: t,
        }))
      : [
          { Icon: BookOpen, label: 'Home',     href: '#',         type: 'hero'     },
          { Icon: Scissors, label: 'Services', href: '#services', type: 'services' },
          { Icon: Users,    label: 'Team',     href: '#team',     type: 'team'     },
          { Icon: MapPin,   label: 'Contact',  href: '#contact',  type: 'contact'  },
        ];
    return (
      <>
        <nav className={cn('flex items-center justify-between px-6 py-3', config.sticky !== false && 'sticky top-0')}
          style={{ ...navZ, ...solidNavStyle, borderBottom: `1px solid ${navBorderColor()}` }}>
          <Logo />
          <HamburgerBtn />
        </nav>
        <Drawer />
        <div className="bottom-0 inset-x-0 border-t"
          style={{
            position: isPreview ? 'sticky' : 'fixed',
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderColor: ac(style) + '12',
            paddingBottom: isPreview ? '0px' : 'env(safe-area-inset-bottom, 0px)',
            zIndex: 110, isolation: 'isolate',
          }}>
          <div className="flex items-stretch overflow-x-auto"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
              msOverflowStyle: 'none', scrollSnapType: 'x mandatory' }}>
            {barItems.map(item => (
              <a key={item.type} href={item.href}
                className="flex-shrink-0 flex flex-col items-center gap-0.5 py-3 px-3 text-slate-400 hover:text-slate-900 active:text-slate-900 transition-colors group"
                style={{ minWidth: 56, scrollSnapAlign: 'start', WebkitTapHighlightColor: ac(style) + '33' }}>
                <item.Icon className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span className="text-[8px] font-black uppercase tracking-wider whitespace-nowrap">{item.label}</span>
              </a>
            ))}
            <button onClick={cta(config.ctaAction, config.ctaUrl)}
              className="flex-shrink-0 flex flex-col items-center gap-0.5 py-3 mx-2 my-1 px-4 rounded-xl active:scale-95 transition-transform"
              style={{ background: ac(style), scrollSnapAlign: 'end', WebkitTapHighlightColor: ac(style) + '55' }}>
              <span className="text-white text-[11px] font-black uppercase tracking-widest leading-none">
                {config.ctaText || 'Book'}
              </span>
              <span className="text-white opacity-70 text-[8px]">Now</span>
            </button>
          </div>
        </div>
        <div className="h-20 pointer-events-none" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} />
      </>
    );
  }

  // ── minimal ────────────────────────────────────────────────────────────────
  if (layout === 'minimal') return (
    <>
      <nav className={cn('flex items-center justify-between px-6 md:px-14 py-4', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo />
        <div className="flex items-center gap-3">
          <Cta />
          <HamburgerBtn className="md:hidden" />
        </div>
      </nav>
      <Drawer />
    </>
  );

  // ── centered (default) ─────────────────────────────────────────────────────
  return (
    <>
      <nav className={cn('flex items-center justify-between px-6 md:px-14 py-4 border-b', config.sticky !== false && 'sticky top-0')}
        style={{ ...navZ, ...solidNavStyle }}>
        <Logo />
        <div className="overflow-x-auto hidden md:block" style={{ scrollbarWidth: 'none' }}>
          <Links className="flex" />
        </div>
        <div className="flex items-center gap-3">
          <Cta className="hidden md:inline-flex" />
          <HamburgerBtn className="md:hidden" />
        </div>
      </nav>
      <Drawer />
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
  const allServices = data.services;
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const [canLeft,  setCanLeft]  = useState(false);
  const [canRight, setCanRight] = useState(true);
  const CARD_W = 300;

  const categories = Array.from(new Set(allServices.map((s: any) => s.category).filter(Boolean))) as string[];
  const services = activeCategory ? allServices.filter((s: any) => s.category === activeCategory) : allServices;

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

  const CategoryFilter = () => config.showFilters && categories.length > 1 ? (
    <div className="flex flex-wrap gap-2 justify-center mb-10">
      <button onClick={() => setActiveCategory(null)}
        className="px-5 py-2 text-[10px] font-black uppercase tracking-widest transition-all duration-200"
        style={{ background: !activeCategory ? ac(style) : 'transparent', color: !activeCategory ? 'white' : '#94a3b8', borderRadius: br(style, 2), border: `1.5px solid ${!activeCategory ? ac(style) : '#e2e8f0'}` }}>
        All
      </button>
      {categories.map(cat => (
        <button key={cat} onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
          className="px-5 py-2 text-[10px] font-black uppercase tracking-widest transition-all duration-200"
          style={{ background: activeCategory === cat ? ac(style) : 'transparent', color: activeCategory === cat ? 'white' : '#94a3b8', borderRadius: br(style, 2), border: `1.5px solid ${activeCategory === cat ? ac(style) : '#e2e8f0'}` }}>
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
    <button onClick={e => { e.stopPropagation(); openBooking(svc); }}
      className={cn('text-[11px] font-black uppercase tracking-widest hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all', full ? 'w-full py-3.5' : 'px-6 py-3')}
      style={{ ...btnStyle(style), fontFamily: bf(style) }}>
      {config.ctaText || 'Book Now'}
    </button>
  );

  if (layout === 'cards') {
    const cols = parseInt(config.columns) || 2;
    const gridCls = cols === 1 ? 'grid-cols-1 max-w-lg mx-auto' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <Header/><CategoryFilter/>
          {services.length > 0 ? (
            <div className={`grid gap-6 ${gridCls}`}>
              {services.map((svc: any) => (
                <div key={svc.id} className="group relative bg-white overflow-hidden transition-all duration-400 hover:shadow-2xl hover:-translate-y-2"
                     style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}18` }}>
                  {config.showImages && svc.imageUrl ? (
                    <div className="relative overflow-hidden aspect-[3/2]">
                      <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                           style={{ background: `linear-gradient(to top, ${ac(style)}cc 0%, transparent 60%)` }}/>
                      {config.showPrices !== false && svc.price && (
                        <div className="absolute top-3 right-3 px-3 py-1.5 text-white text-[11px] font-black shadow-lg"
                             style={{ background: ac(style), borderRadius: br(style) }}>${svc.price}</div>
                      )}
                    </div>
                  ) : config.showImages && (
                    <div className="aspect-[3/2] flex items-center justify-center"
                         style={{ background: `linear-gradient(135deg, ${ac(style)}12 0%, ${ac(style)}06 100%)` }}>
                      <div className="w-12 h-12 rounded-full" style={{ background: ac(style) + '20' }}/>
                    </div>
                  )}
                  <div className="p-6 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                      {config.showPrices !== false && svc.price && !config.showImages && (
                        <span className="text-lg font-light shrink-0" style={{ color: ac(style), fontFamily: hf(style) }}>${svc.price}</span>
                      )}
                    </div>
                    {config.showDesc !== false && svc.description && (
                      <p className="text-sm text-slate-500 leading-relaxed line-clamp-2" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                    )}
                    {config.showDuration !== false && svc.duration && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" style={{ color: ac(style) }}/>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</p>
                      </div>
                    )}
                    <div className="h-px scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left mt-1" style={{ background: ac(style) }}/>
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

  if (layout === 'carousel') {
    const checkScroll = () => {
      const el = scrollRef.current; if (!el) return;
      setCanLeft(el.scrollLeft > 8);
      setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
    };
    const slide = (dir: -1 | 1) => {
      scrollRef.current?.scrollBy({ left: dir * (CARD_W + 20), behavior: 'smooth' });
    };
    return (
      <section id="services" className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <div className="flex items-end justify-between mb-10">
            <div>
              <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>
                {config.heading || 'Our Services'}
              </FieldTap>
              {config.subheading && (
                <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                  as="p" className="text-sm text-slate-500 mt-2" style={{ fontFamily: bf(style) }}>
                  {config.subheading}
                </FieldTap>
              )}
            </div>
            <div className="hidden md:flex items-center gap-2 shrink-0 ml-4">
              <button onClick={() => slide(-1)} className="w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all"
                      style={{ borderColor: canLeft ? ac(style) : '#e2e8f0', color: canLeft ? ac(style) : '#cbd5e1', opacity: canLeft ? 1 : 0.45 }}>
                <ChevronLeft className="w-4 h-4"/>
              </button>
              <button onClick={() => slide(1)} className="w-10 h-10 rounded-full flex items-center justify-center transition-all text-white"
                      style={{ background: canRight ? ac(style) : '#e2e8f0', opacity: canRight ? 1 : 0.45 }}>
                <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          </div>
          <CategoryFilter/>
          {services.length > 0 ? (
            <>
              <div ref={scrollRef} onScroll={checkScroll}
                   className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6 md:mx-0 md:px-0"
                   style={{ scrollbarWidth: 'none', cursor: 'grab' }}>
                {services.map((svc: any, i: number) => (
                  <div key={svc.id} className="snap-start shrink-0 group bg-white overflow-hidden hover:shadow-2xl transition-all duration-400"
                       style={{ width: CARD_W, borderRadius: br(style, 2), border: `1.5px solid ${ac(style)}14`, animation: `cf-float-up 0.7s ${i * 0.08}s both` }}>
                    <div className="relative overflow-hidden" style={{ height: 200, background: ac(style) + '0e' }}>
                      {svc.imageUrl
                        ? <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                        : <div className="w-full h-full flex items-center justify-center">
                            <span className="text-5xl font-light opacity-[0.15]" style={{ fontFamily: hf(style), color: ac(style) }}>{String(i + 1).padStart(2,'0')}</span>
                          </div>}
                      {config.showPrices !== false && svc.price && (
                        <div className="absolute top-3 right-3 px-3 py-1 text-white text-[11px] font-black shadow-lg"
                             style={{ background: ac(style), borderRadius: br(style) }}>${svc.price}</div>
                      )}
                      {svc.category && (
                        <div className="absolute bottom-3 left-3 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white"
                             style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', borderRadius: '999px' }}>{svc.category}</div>
                      )}
                    </div>
                    <div className="p-5 space-y-2">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                      {config.showDesc !== false && svc.description && (
                        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                      )}
                      {config.showDuration !== false && svc.duration && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3" style={{ color: ac(style) }}/>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</span>
                        </div>
                      )}
                      <BookBtn svc={svc} full/>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 md:hidden">
                <div className="flex gap-1.5">
                  {services.slice(0, Math.min(services.length, 8)).map((_: any, i: number) => (
                    <div key={i} className="h-1.5 rounded-full transition-all" style={{ background: ac(style) + '40', width: i === 0 ? 20 : 6 }}/>
                  ))}
                </div>
              </div>
            </>
          ) : <Empty/>}
        </div>
      </section>
    );
  }

  if (layout === 'horizontal') return (
    <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="space-y-6">
            {services.map((svc: any, i: number) => {
              const imageLeft = i % 2 === 0;
              return (
                <div key={svc.id} className="group grid md:grid-cols-2 overflow-hidden bg-white hover:shadow-2xl transition-all duration-400"
                     style={{ borderRadius: br(style, 2), border: `1.5px solid ${ac(style)}15` }}>
                  <div className={cn('relative overflow-hidden', imageLeft ? 'md:order-1' : 'md:order-2')}
                       style={{ minHeight: '240px', background: ac(style) + '10' }}>
                    {svc.imageUrl
                      ? <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 absolute inset-0"/>
                      : <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-5xl font-light opacity-20" style={{ fontFamily: hf(style), color: ac(style) }}>{svc.name?.[0]}</div>
                        </div>}
                    {svc.category && (
                      <div className="absolute top-4 left-4 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white"
                           style={{ background: ac(style) + 'dd', borderRadius: '999px', backdropFilter: 'blur(4px)' }}>{svc.category}</div>
                    )}
                  </div>
                  <div className={cn('flex flex-col justify-center p-8 md:p-10 space-y-4', imageLeft ? 'md:order-2' : 'md:order-1')}>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] mb-2" style={{ color: ac(style) }}>{String(i + 1).padStart(2, '0')}</p>
                      <h3 className="text-2xl font-light text-slate-900 mb-1" style={{ fontFamily: hf(style) }}>{svc.name}</h3>
                      {config.showDuration !== false && svc.duration && (
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</p>
                      )}
                    </div>
                    {config.showDesc !== false && svc.description && (
                      <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      {config.showPrices !== false && svc.price && (
                        <span className="text-3xl font-light" style={{ fontFamily: hf(style), color: ac(style) }}>${svc.price}</span>
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

  if (layout === 'luxury') return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="space-y-0">
            {services.map((svc: any, i: number) => (
              <div key={svc.id} className="group relative"
                   onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}>
                {svc.imageUrl && hoveredIdx === i && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-40 h-28 overflow-hidden shadow-2xl z-20 pointer-events-none"
                       style={{ borderRadius: br(style, 1.5), animation: 'cf-scale-up 0.3s ease both' }}>
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover"/>
                  </div>
                )}
                <div className="flex items-center gap-6 md:gap-10 py-6 border-b transition-all duration-200 group-hover:px-4"
                     style={{ borderColor: ac(style) + '15', background: hoveredIdx === i ? ac(style) + '04' : 'transparent' }}>
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] shrink-0 w-8 text-right transition-all duration-200"
                        style={{ color: hoveredIdx === i ? ac(style) : '#cbd5e1' }}>{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl md:text-2xl font-light transition-all duration-200"
                        style={{ fontFamily: hf(style), color: hoveredIdx === i ? '#0f172a' : '#334155' }}>{svc.name}</h3>
                    {hoveredIdx === i && config.showDesc !== false && svc.description && (
                      <p className="text-sm text-slate-400 mt-1 leading-relaxed max-w-sm" style={{ fontFamily: bf(style), animation: 'cf-fade-in 0.3s both' }}>{svc.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-1">
                      {config.showDuration !== false && svc.duration && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{svc.duration} min</span>}
                      {svc.category && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ac(style) + '80' }}>{svc.category}</span>}
                    </div>
                  </div>
                  {config.showPrices !== false && svc.price && (
                    <span className="text-2xl font-light shrink-0 transition-all duration-200"
                          style={{ fontFamily: hf(style), color: hoveredIdx === i ? ac(style) : '#94a3b8' }}>${svc.price}</span>
                  )}
                  <button onClick={e => { e.stopPropagation(); openBooking(svc); }}
                          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300"
                          style={{ background: hoveredIdx === i ? ac(style) : 'transparent', border: `1.5px solid ${hoveredIdx === i ? ac(style) : '#e2e8f0'}`, opacity: hoveredIdx === i ? 1 : 0.4 }}>
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

  if (layout === 'magazine') {
    const [feature, ...rest] = services;
    return (
      <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-6xl mx-auto px-6 md:px-16">
          <Header/><CategoryFilter/>
          {services.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-5">
              {feature && (
                <div className="md:col-span-2 group relative overflow-hidden bg-white hover:shadow-2xl transition-all duration-500 cursor-pointer"
                     style={{ borderRadius: br(style, 2), border: `1.5px solid ${ac(style)}15`, minHeight: '420px' }}
                     onClick={() => openBooking(feature)}>
                  {feature.imageUrl ? (
                    <><img src={feature.imageUrl} alt={feature.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 55%)' }}/></>
                  ) : (
                    <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${ac(style)}18 0%, ${ac(style)}06 100%)` }}/>
                  )}
                  <div className="absolute bottom-0 inset-x-0 p-8 space-y-3">
                    {feature.category && <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: feature.imageUrl ? 'rgba(255,255,255,0.55)' : ac(style) }}>{feature.category}</span>}
                    <h3 className="text-3xl md:text-4xl font-light" style={{ fontFamily: hf(style), color: feature.imageUrl ? 'white' : '#0f172a' }}>{feature.name}</h3>
                    {config.showDesc !== false && feature.description && (
                      <p className="text-sm max-w-sm leading-relaxed" style={{ color: feature.imageUrl ? 'rgba(255,255,255,0.65)' : '#64748b', fontFamily: bf(style) }}>{feature.description}</p>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-4">
                        {config.showPrices !== false && feature.price && <span className="text-2xl font-light" style={{ fontFamily: hf(style), color: feature.imageUrl ? 'white' : ac(style) }}>${feature.price}</span>}
                        {config.showDuration !== false && feature.duration && <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: feature.imageUrl ? 'rgba(255,255,255,0.5)' : '#94a3b8' }}>{feature.duration} min</span>}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white px-5 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: ac(style), borderRadius: br(style) }}>{config.ctaText || 'Book Now'}</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {rest.slice(0, 5).map((svc: any) => (
                  <div key={svc.id} className="group flex items-center gap-4 p-4 bg-white hover:shadow-md transition-all duration-300 cursor-pointer"
                       style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}12` }}
                       onClick={() => openBooking(svc)}>
                    {svc.imageUrl ? (
                      <div className="w-16 h-16 shrink-0 overflow-hidden" style={{ borderRadius: br(style) }}>
                        <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"/>
                      </div>
                    ) : (
                      <div className="w-12 h-12 shrink-0 flex items-center justify-center" style={{ background: ac(style) + '12', borderRadius: br(style) }}>
                        <span className="text-lg font-light" style={{ color: ac(style), fontFamily: hf(style) }}>{svc.name?.[0]}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate" style={{ fontFamily: bf(style) }}>{svc.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {config.showPrices !== false && svc.price && <span className="text-sm font-light" style={{ color: ac(style), fontFamily: hf(style) }}>${svc.price}</span>}
                        {config.showDuration !== false && svc.duration && <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{svc.duration}m</span>}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ color: ac(style) }}/>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty/>}
        </div>
      </section>
    );
  }

  if (layout === 'masonry') return (
    <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-0">
            {services.map((svc: any, i: number) => (
              <div key={svc.id} className="group break-inside-avoid mb-5 bg-white overflow-hidden hover:shadow-2xl transition-all duration-400 cursor-pointer block"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}15` }}
                   onClick={() => openBooking(svc)}>
                {svc.imageUrl ? (
                  <div className="overflow-hidden" style={{ aspectRatio: [4/3, 1, 3/4, 5/4, 1, 4/3][i % 6].toString().replace(',', '/') }}>
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>
                  </div>
                ) : (
                  <div className="aspect-square flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${ac(style)}14 0%, ${ac(style)}06 100%)` }}>
                    <span className="text-5xl font-light opacity-30" style={{ fontFamily: hf(style), color: ac(style) }}>{svc.name?.[0]}</span>
                  </div>
                )}
                <div className="p-5 space-y-2">
                  <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                  {config.showDesc !== false && svc.description && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-3" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3">
                      {config.showPrices !== false && svc.price && <span className="text-base font-light" style={{ color: ac(style), fontFamily: hf(style) }}>${svc.price}</span>}
                      {config.showDuration !== false && svc.duration && <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{svc.duration}m</span>}
                    </div>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ background: ac(style) }}>
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

  if (layout === 'list') return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-3xl mx-auto px-4 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="space-y-3">
            {services.map((svc: any) => (
              <div key={svc.id} className="group bg-white hover:shadow-lg transition-all duration-300 overflow-hidden"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}15` }}>
                <div className="flex items-center gap-4 p-4">
                  {config.showImages && svc.imageUrl && (
                    <div className="w-14 h-14 shrink-0 overflow-hidden rounded-xl" style={{ borderRadius: br(style) }}>
                      <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"/>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                      {config.showPrices !== false && svc.price && (
                        <span className="text-base font-light shrink-0" style={{ color: ac(style), fontFamily: hf(style) }}>${svc.price}</span>
                      )}
                    </div>
                    {config.showDuration !== false && svc.duration && (
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{svc.duration} min</p>
                    )}
                  </div>
                </div>
                {config.showDesc !== false && svc.description && (
                  <p className="text-xs text-slate-400 leading-relaxed px-4 pb-3 -mt-1 line-clamp-2" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                )}
                <div className="px-4 pb-4">
                  <button onClick={e => { e.stopPropagation(); openBooking(svc); }}
                          className="w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all"
                          style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                    {config.ctaText || 'Book Now'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  if (layout === 'grid') return (
    <section id="services" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {services.map((svc: any) => (
              <div key={svc.id} className="group bg-white overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}15` }}
                   onClick={() => openBooking(svc)}>
                {svc.imageUrl ? (
                  <div className="aspect-square overflow-hidden">
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-600"/>
                  </div>
                ) : (
                  <div className="aspect-square flex items-center justify-center" style={{ background: ac(style) + '10' }}>
                    <span className="text-3xl font-light opacity-40" style={{ color: ac(style), fontFamily: hf(style) }}>{svc.name?.[0]}</span>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 mb-1" style={{ fontFamily: bf(style) }}>{svc.name}</p>
                  <div className="flex items-center justify-between">
                    {config.showPrices !== false && svc.price && <span className="text-sm font-light" style={{ color: ac(style), fontFamily: hf(style) }}>${svc.price}</span>}
                    {config.showDuration !== false && svc.duration && <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{svc.duration}m</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty/>}
      </div>
    </section>
  );

  return (
    <section id="services" className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <Header/><CategoryFilter/>
        {services.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {services.map((svc: any) => (
              <div key={svc.id} className="group p-7 bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                   style={{ borderRadius: br(style, 1.5), border: `1.5px solid ${ac(style)}20` }}>
                {config.showImages && svc.imageUrl && (
                  <div className="overflow-hidden aspect-[3/2] mb-5" style={{ borderRadius: br(style) }}>
                    <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                  </div>
                )}
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2" style={{ fontFamily: bf(style) }}>{svc.name}</h3>
                {config.showDesc !== false && svc.description && (
                  <p className="text-sm text-slate-500 leading-relaxed mb-4" style={{ fontFamily: bf(style) }}>{svc.description}</p>
                )}
                <div className="flex items-center justify-between">
                  {config.showPrices !== false && svc.price && <span className="text-xl font-light" style={{ color: ac(style), fontFamily: hf(style) }}>${svc.price}</span>}
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
                <div style={{ animation: soloVis ? 'cf-float-up 0.9s cubic-bezier(0.34,1.56,0.64,1) 0.6s both' : 'none' }}>
                  <button
                    onClick={e => { e.stopPropagation(); openBooking(); }}
                    className="inline-flex items-center gap-2.5 px-9 md:px-12 py-3.5 md:py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.05] active:scale-[0.97] transition-transform"
                    style={{
                      background: ac(style), color: '#fff',
                      borderRadius: br(style, 3), fontFamily: bf(style),
                      boxShadow: `0 12px 40px ${ac(style)}28, 0 4px 12px ${ac(style)}16`,
                    }}>
                    {config.bookCta || 'Book with me'}
                    <ArrowRight className="w-4 h-4"/>
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
 
 
// ══════════════════════════════════════════════════════════════════════════════
// SOLO CARD  –  centered portrait card, mat frame, elegant nameplate
// ══════════════════════════════════════════════════════════════════════════════
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
function ReviewsSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [idx, setIdx] = useState(0);
  const layout = config.layout || 'grid';
  const reviews = [1,2,3,4,5,6].map(n => ({
    name:  config[`rev${n}Name`]  || ['Sarah M.','Jessica T.','Priya K.','Amara B.','Lena S.','Chloe W.'][n-1] || '',
    rating: config[`rev${n}Rating`] ?? 5,
    text:  config[`rev${n}Text`]  || ['Absolutely incredible experience.','Every visit exceeds expectations.','Luxurious yet so welcoming.','Cannot recommend enough.','A gem of a studio.','Creative and professional.'][n-1] || '',
    photo: config[`rev${n}Photo`] || '',
  })).filter(r => r.name && r.text);
  const Stars = ({ n }: { n: number }) => <div className="flex gap-0.5">{Array(Math.max(1,Math.min(5,n))).fill(0).map((_,j) => <Star key={j} className="w-3.5 h-3.5 fill-current" style={{ color: ac(style) }}/>)}</div>;
  const Card = ({ r }: { r: typeof reviews[0] }) => (
    <div className="p-8 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300" style={{ borderRadius: br(style,1.5), border: `2px solid ${ac(style)}20` }}>
      {config.showRating !== false && <div className="mb-4"><Stars n={r.rating}/></div>}
      {r.photo && config.showPhotos && <img src={r.photo} alt={r.name} className="w-10 h-10 rounded-full object-cover mb-4"/>}
      <p className="text-sm leading-relaxed text-slate-600 italic mb-4">"{r.text}"</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{ fontFamily: bf(style) }}>— {r.name}</p>
    </div>
  );
  if (layout === 'quotes') {
    const r = reviews[idx % Math.max(1, reviews.length)];
    return (
      <section className={py(style)} style={{ background: style.bgColor }}>
        <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-10">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'What Clients Say'}</FieldTap>
          {r && <div className="space-y-8">
            {config.showRating !== false && <div className="flex justify-center"><Stars n={r.rating}/></div>}
            <p className="text-2xl md:text-3xl font-light italic leading-relaxed text-slate-700" style={{ fontFamily: hf(style) }}>"{r.text}"</p>
            <div className="flex items-center justify-center gap-4">{r.photo && <img src={r.photo} alt={r.name} className="w-10 h-10 rounded-full object-cover"/>}<p className="text-[11px] font-black uppercase tracking-widest text-slate-400">— {r.name}</p></div>
            {reviews.length > 1 && <div className="flex items-center justify-center gap-3">
              <button onClick={() => setIdx(i => (i - 1 + reviews.length) % reviews.length)} className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all" style={{ borderColor: ac(style)+'30' }}><ChevronLeft className="w-4 h-4"/></button>
              {reviews.map((_, i) => <div key={i} className="w-2 h-2 rounded-full transition-all cursor-pointer" style={{ background: i === idx % reviews.length ? ac(style) : '#cbd5e1' }} onClick={() => setIdx(i)}/>)}
              <button onClick={() => setIdx(i => (i + 1) % reviews.length)} className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all" style={{ borderColor: ac(style)+'30' }}><ChevronRight className="w-4 h-4"/></button>
            </div>}
          </div>}
        </div>
      </section>
    );
  }
  if (layout === 'carousel') return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'What Clients Say'}</FieldTap></div>
        <div className="flex gap-6 overflow-x-auto pb-4 snap-x" style={{ scrollbarWidth: 'none' }}>{reviews.map((r,i) => <div key={i} className="shrink-0 snap-start w-[320px]"><Card r={r}/></div>)}</div>
      </div>
    </section>
  );
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'What Clients Say'}</FieldTap>
          {config.subheading && <p className="text-base text-slate-500 max-w-xl mx-auto" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">{reviews.slice(0,6).map((r,i) => <Card key={i} r={r}/>)}</div>
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

// ─── QuoteSection ─────────────────────────────────────────────────────────────
function QuoteSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const rawTags = config.tags;
  const tags: string[] = Array.isArray(rawTags) ? rawTags
    : typeof rawTags === 'string' ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
  const hasBg  = !!config.bgImage;
  const layout = config.layout || 'cinematic';
  const accent = ac(style);
  const { ref, visible } = useInView(0.1);

  // ── CINEMATIC ────────────────────────────────────────────────────────────────
  if (layout === 'cinematic') return (
    <section ref={ref}
      className={`${py(style)} relative overflow-hidden flex flex-col items-center justify-center`}
      style={{ minHeight: '92svh', background: '#07070d' }}>
      {hasBg && (
        <>
          <img src={config.bgImage!} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.18]"/>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.75) 100%)' }}/>
        </>
      )}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          radial-gradient(ellipse 80% 65% at 15% 55%, ${accent}1e 0%, transparent 55%),
          radial-gradient(ellipse 60% 50% at 85% 25%, ${accent}14 0%, transparent 50%),
          radial-gradient(ellipse 40% 35% at 50% 90%, ${accent}0a 0%, transparent 55%)`,
      }}/>
      {[...Array(7)].map((_, i) => (
        <div key={i} className="absolute rounded-full pointer-events-none"
          style={{
            width: [3,2,4,2,3,2,4][i], height: [3,2,4,2,3,2,4][i],
            top: ['15%','65%','35%','78%','22%','50%','42%'][i],
            left: ['8%','82%','22%','62%','44%','14%','70%'][i],
            background: accent, opacity: 0.4,
            animation: `cf-drift-${['a','b','c','a','b','c','a'][i]} ${[8,11,9,7,12,10,8][i]}s ease-in-out infinite ${i * 1.5}s`,
          }}/>
      ))}
      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full"
          style={{ background: `${accent}14`, border: `1px solid ${accent}28` }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }}/>
          <span className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: accent }}>
            Custom Event Inquiries
          </span>
        </div>
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h2" className="font-light leading-[0.88] text-white"
          style={{ fontSize: 'clamp(42px,7.5vw,92px)', fontFamily: hf(style),
            animation: visible ? 'cf-fade-up 0.9s both' : 'none' }}>
          {config.heading || 'Planning Something Unforgettable?'}
        </FieldTap>
        <div className="flex items-center justify-center gap-2">
          <div className="h-px w-10" style={{ background: `${accent}30` }}/>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }}/>
          <div className="h-px w-10" style={{ background: `${accent}30` }}/>
        </div>
        {config.subheading && (
          <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
            as="p" className="text-base md:text-lg max-w-xl mx-auto leading-relaxed"
            style={{ fontFamily: bf(style), color: 'rgba(255,255,255,0.50)',
              animation: visible ? 'cf-fade-up 0.9s 0.1s both' : 'none' }}>
            {config.subheading}
          </FieldTap>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2.5 justify-center"
            style={{ animation: visible ? 'cf-fade-up 0.9s 0.2s both' : 'none' }}>
            {tags.map((tag, i) => (
              <span key={i} className="px-5 py-2.5 text-[11px] font-black uppercase tracking-widest"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.70)',
                  borderRadius: br(style, 3),
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        <div style={{ animation: visible ? 'cf-float-up 0.9s 0.3s both' : 'none' }}>
          <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
            <button onClick={cta(config.ctaAction, config.ctaUrl)}
              className="group inline-flex items-center gap-3 px-12 py-5 font-black text-sm uppercase tracking-widest transition-all hover:scale-[1.04] active:scale-[0.97]"
              style={{
                background: accent, color: '#fff', borderRadius: br(style, 3), fontFamily: bf(style),
                boxShadow: `0 0 70px ${accent}45, 0 20px 60px rgba(0,0,0,0.5)`,
              }}>
              {config.ctaText || 'Request a Custom Quote'}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1"/>
            </button>
          </FieldTap>
        </div>
      </div>
    </section>
  );

  // ── EDITORIAL ────────────────────────────────────────────────────────────────
  if (layout === 'editorial') return (
    <section ref={ref} className={`${py(style)} overflow-hidden`} style={{ background: style.bgColor }}>
      <div className="max-w-7xl mx-auto px-6 md:px-16">
        <div className="grid md:grid-cols-[1fr_1.15fr] gap-12 md:gap-20 items-center">

          {/* Left: text — always first on both mobile + desktop */}
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="h-px w-8" style={{ background: accent }}/>
              <span className="text-[9px] font-black uppercase tracking-[0.4em]" style={{ color: accent }}>
                Group & Event Bookings
              </span>
            </div>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="font-light leading-[0.86]"
              style={{ fontSize: 'clamp(48px,8vw,110px)', fontFamily: hf(style), color: '#0f172a',
                animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>
              {config.heading || 'Plan Your Moment'}
            </FieldTap>
            <div className="flex items-center gap-2.5">
              <div className="h-[3px] w-12 rounded-full" style={{ background: accent }}/>
              <div className="h-px w-6 rounded-full opacity-30" style={{ background: accent }}/>
            </div>
            {config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-base leading-relaxed max-w-sm text-slate-500"
                style={{ fontFamily: bf(style) }}>
                {config.subheading}
              </FieldTap>
            )}
            <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
              <button onClick={cta(config.ctaAction, config.ctaUrl)}
                className="group flex items-center gap-4 transition-all duration-300 pt-2">
                <span className="text-sm font-black uppercase tracking-widest transition-all group-hover:tracking-[0.22em]"
                  style={{ fontFamily: bf(style), color: accent }}>
                  {config.ctaText || 'Request a Quote'}
                </span>
                <div className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:shadow-2xl"
                  style={{ background: accent, boxShadow: `0 8px 28px ${accent}40` }}>
                  <ArrowRight className="w-4 h-4 text-white transition-transform group-hover:translate-x-0.5"/>
                </div>
              </button>
            </FieldTap>

            {/* Mobile-only: compact accent tag chips */}
            <div className="md:hidden flex flex-wrap gap-2.5 pt-2">
              {(tags.length > 0 ? tags : ['Bridal Parties','Corporate Events','Destination Services']).map((tag, i) => (
                <span key={i}
                  className="px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white"
                  style={{
                    background: accent,
                    borderRadius: br(style, 2),
                    boxShadow: `0 6px 20px ${accent}35`,
                    animation: visible ? `cf-float-up 0.5s ${i * 0.09}s both` : 'none',
                  }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Right: image or staggered tag cards — desktop only */}
          <div className="relative hidden md:block" style={{ minHeight: '480px' }}>
            {hasBg ? (
              <div className="relative overflow-hidden h-full" style={{ borderRadius: br(style, 2), minHeight: '480px' }}>
                <img src={config.bgImage!} alt="" className="w-full h-full object-cover absolute inset-0"/>
                <div className="absolute inset-0" style={{ background: `linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 45%)` }}/>
                {tags.length > 0 && (
                  <div className="absolute bottom-0 inset-x-0 p-10 space-y-2.5">
                    {tags.map((tag, i) => (
                      <div key={i} className="flex items-center gap-3"
                        style={{ animation: visible ? `cf-slide-left 0.5s ${0.1 + i * 0.09}s both` : 'none' }}>
                        <div className="w-1 h-1 rounded-full opacity-60" style={{ background: accent }}/>
                        <span className="text-sm font-black uppercase tracking-widest text-white"
                          style={{ fontFamily: bf(style) }}>{tag}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="relative overflow-hidden h-full"
                style={{ minHeight: '480px', background: `${accent}08`, borderRadius: br(style, 2), border: `2px solid ${accent}14` }}>
                <div className="absolute top-4 right-4 w-36 h-36 rounded-full"
                  style={{ background: `${accent}0e`, border: `2px solid ${accent}18` }}/>
                <div className="absolute bottom-8 left-4 w-20 h-20 rounded-full"
                  style={{ background: `${accent}0a` }}/>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-1/3"
                  style={{ background: `linear-gradient(to bottom, transparent, ${accent}18, transparent)` }}/>
                <div className="absolute inset-0 flex flex-col justify-center px-8 space-y-3">
                  {(tags.length > 0 ? tags : ['Bridal Parties','Corporate Events','Destination Services','Milestone Celebrations']).map((tag, i) => (
                    <div key={i}
                      className="flex items-center gap-4 px-7 py-5 text-white font-black text-sm uppercase tracking-widest"
                      style={{
                        background: accent,
                        borderRadius: br(style, 1.5),
                        transform: `rotate(${[-1.2, 0.6, -0.8, 1.1][i % 4]}deg) translateX(${[10, -6, 8, -4][i % 4]}px)`,
                        boxShadow: `0 14px 40px ${accent}40`,
                        animation: visible ? `cf-float-up 0.55s ${i * 0.1}s both` : 'none',
                      }}>
                      <span className="text-[11px] font-light opacity-60 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
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

  // ── LUXURY ───────────────────────────────────────────────────────────────────
  if (layout === 'luxury') return (
    <section ref={ref} className="relative overflow-hidden" style={{ minHeight: '88svh' }}>
      <div className="grid md:grid-cols-2 min-h-[88svh]">
        {/* Left: accent / image panel */}
        <div className="relative overflow-hidden flex items-end p-12 md:p-16"
          style={{ background: hasBg ? 'transparent' : `linear-gradient(145deg, ${accent} 0%, ${accent}cc 100%)`, minHeight: '440px' }}>
          {hasBg && (
            <>
              <img src={config.bgImage!} alt="" className="absolute inset-0 w-full h-full object-cover"/>
              <div className="absolute inset-0" style={{ background: `linear-gradient(145deg, ${accent}cc 0%, rgba(0,0,0,0.55) 100%)` }}/>
            </>
          )}
          <div className="absolute inset-0 pointer-events-none opacity-[0.07]"
            style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)', backgroundSize: '28px 28px' }}/>
          <div className="absolute bottom-4 right-6 font-light select-none pointer-events-none"
            style={{ fontSize: '180px', fontFamily: hf(style), color: 'rgba(255,255,255,0.06)', lineHeight: 1 }}>01</div>
          <div className="relative z-10 space-y-6 max-w-sm">
            <div className="w-10 h-px" style={{ background: 'rgba(255,255,255,0.45)' }}/>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="font-light leading-[0.9] text-white"
              style={{ fontSize: 'clamp(36px,5vw,60px)', fontFamily: hf(style),
                animation: visible ? 'cf-fade-up 0.8s both' : 'none' }}>
              {config.heading || 'Something Bigger In Mind?'}
            </FieldTap>
            {config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-sm leading-relaxed"
                style={{ color: 'rgba(255,255,255,0.62)', fontFamily: bf(style) }}>
                {config.subheading}
              </FieldTap>
            )}
          </div>
        </div>
        {/* Right: white panel */}
        <div className="flex flex-col justify-center p-12 md:p-16 bg-white">
          <div className="max-w-md w-full space-y-12">
            <div className="space-y-5">
              <p className="text-[9px] font-black uppercase tracking-[0.35em]"
                style={{ color: accent + '80' }}>We specialize in</p>
              <div className="space-y-0">
                {(tags.length > 0 ? tags : ['Bridal Parties','Corporate Events','Destination Services','Milestone Celebrations']).map((tag, i) => (
                  <div key={i}
                    className="group flex items-center justify-between py-5 border-b"
                    style={{ borderColor: `${accent}10`,
                      animation: visible ? `cf-fade-up 0.45s ${i * 0.07}s both` : 'none' }}>
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] font-black tabular-nums w-6"
                        style={{ color: accent + '40', fontFamily: hf(style) }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-sm font-black uppercase tracking-tight text-slate-800"
                        style={{ fontFamily: bf(style) }}>{tag}</span>
                    </div>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200"
                      style={{ background: `${accent}12`, border: `1px solid ${accent}30` }}>
                      <ArrowRight className="w-3 h-3" style={{ color: accent }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
                <button onClick={cta(config.ctaAction, config.ctaUrl)}
                  className="w-full py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all"
                  style={{ ...btnStyle(style), fontFamily: bf(style), boxShadow: `0 14px 40px ${accent}30` }}>
                  {config.ctaText || 'Request a Custom Quote'}
                </button>
              </FieldTap>
              <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {config.ctaNote || 'We respond within 24 hours'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  // ── SHOWCASE ─────────────────────────────────────────────────────────────────
  if (layout === 'showcase') return (
    <section ref={ref} className={`${py(style)} overflow-hidden relative`} style={{ background: '#f8fafc' }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse 80% 50% at 60% 0%, ${accent}08 0%, transparent 55%)` }}/>
      <div className="relative max-w-6xl mx-auto px-6 md:px-16 space-y-16">
        <div className="text-center space-y-4">
          <span className="inline-block px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.3em]"
            style={{ background: `${accent}10`, color: accent, borderRadius: br(style, 3) }}>
            Group & Event Bookings
          </span>
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
            as="h2" className="text-4xl md:text-6xl font-light"
            style={{ fontFamily: hf(style), color: '#0f172a' }}>
            {config.heading || 'Planning Something Special?'}
          </FieldTap>
          {config.subheading && (
            <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" className="text-base text-slate-500 max-w-xl mx-auto"
              style={{ fontFamily: bf(style) }}>
              {config.subheading}
            </FieldTap>
          )}
        </div>
        {tags.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tags.map((tag, i) => {
              const tagIcons: React.ElementType[] = [Crown, Heart, Users, Sparkles, Calendar, Award];
              const TIcon = tagIcons[i % tagIcons.length];
              return (
                <div key={i}
                  className="group relative overflow-hidden bg-white hover:shadow-2xl hover:-translate-y-2 transition-all duration-400 cursor-default"
                  style={{ borderRadius: br(style, 2), border: `1.5px solid ${accent}12`,
                    animation: visible ? `cf-float-up 0.6s ${i * 0.09}s both` : 'none' }}>
                  <div className="h-[3px] w-0 group-hover:w-full transition-all duration-500"
                    style={{ background: `linear-gradient(to right, ${accent}, ${accent}70)` }}/>
                  <div className="p-8 space-y-5">
                    <div className="w-12 h-12 flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                      style={{ background: `${accent}0e`, border: `1px solid ${accent}18`, borderRadius: br(style, 1.5) }}>
                      <TIcon className="w-5 h-5" style={{ color: accent }}/>
                    </div>
                    <p className="text-sm font-black uppercase tracking-tight text-slate-900"
                      style={{ fontFamily: bf(style) }}>{tag}</p>
                    <div className="h-px w-10 transition-all duration-500 group-hover:w-full"
                      style={{ background: `linear-gradient(to right, ${accent}30, transparent)` }}/>
                    <p className="text-xs text-slate-400 leading-relaxed" style={{ fontFamily: bf(style) }}>
                      Bespoke beauty services tailored to your {tag.toLowerCase()} vision.
                    </p>
                  </div>
                  <div className="absolute bottom-7 right-7 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-2 group-hover:translate-x-0"
                    style={{ background: accent, boxShadow: `0 6px 20px ${accent}45` }}>
                    <ArrowRight className="w-3 h-3 text-white"/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Bold CTA block */}
        <div className="relative overflow-hidden text-center py-16 px-8 md:px-16"
          style={{
            background: hasBg ? `url(${config.bgImage}) center/cover no-repeat`
              : `linear-gradient(135deg, ${accent} 0%, ${accent}bb 100%)`,
            borderRadius: br(style, 2),
            boxShadow: `0 32px 80px ${accent}35`,
          }}>
          {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }}/>}
          {!hasBg && (
            <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
              style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)', backgroundSize: '24px 24px' }}/>
          )}
          <div className="relative z-10 space-y-7">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/55">
              Ready to get started?
            </p>
            <p className="text-3xl md:text-5xl font-light text-white" style={{ fontFamily: hf(style) }}>
              Let's make it extraordinary.
            </p>
            <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
              <button onClick={cta(config.ctaAction, config.ctaUrl)}
                className="inline-flex items-center gap-3 px-12 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.04] active:scale-[0.97] transition-all"
                style={{ background: 'white', color: accent, borderRadius: br(style, 3), fontFamily: bf(style), boxShadow: '0 12px 48px rgba(0,0,0,0.22)' }}>
                {config.ctaText || 'Request a Custom Quote'}
                <ArrowRight className="w-4 h-4"/>
              </button>
            </FieldTap>
          </div>
        </div>
      </div>
    </section>
  );

  // ── CENTERED ─────────────────────────────────────────────────────────────────
  if (layout === 'centered') return (
    <section ref={ref} className={cn(py(style), 'relative overflow-hidden')}
      style={{ background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : accent }}>
      {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)' }}/>}
      {!hasBg && <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,rgba(0,0,0,0.14) 0%,rgba(0,0,0,0.32) 100%)' }}/>}
      {!hasBg && (
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '32px 32px' }}/>
      )}
      <div className="relative max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10">
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
          as="h2" className="text-4xl md:text-6xl font-light text-white"
          style={{ fontFamily: hf(style) }}>
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
            {tags.map((tag, i) => (
              <span key={i}
                className="px-5 py-2.5 border text-[11px] font-black uppercase tracking-widest text-white/75 border-white/20 hover:bg-white/10 hover:text-white transition-all cursor-default"
                style={{ borderRadius: br(style, 3) }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
          <button onClick={cta(config.ctaAction, config.ctaUrl)}
            className="inline-flex items-center gap-2.5 px-12 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] active:scale-[0.98] transition-all"
            style={{ background: 'white', color: accent, borderRadius: br(style), fontFamily: bf(style), boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            {config.ctaText || 'Request a Quote'}<ArrowRight className="w-4 h-4"/>
          </button>
        </FieldTap>
      </div>
    </section>
  );

  // ── SPLIT ────────────────────────────────────────────────────────────────────
  if (layout === 'split') return (
    <section ref={ref} className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">

          {/* Left: text column */}
          <div className="space-y-8">
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="text-4xl md:text-5xl font-light"
              style={{ fontFamily: hf(style), color: '#0f172a' }}>
              {config.heading || 'Need Something Bigger?'}
            </FieldTap>
            <div className="w-14 h-[2px]" style={{ background: accent }}/>
            {config.subheading && (
              <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap}
                as="p" className="text-base leading-relaxed text-slate-500"
                style={{ fontFamily: bf(style) }}>
                {config.subheading}
              </FieldTap>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2.5">
                {tags.map((tag, i) => (
                  <span key={i} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest"
                    style={{ background: accent + '0f', color: accent, borderRadius: br(style, 2), border: `1.5px solid ${accent}22` }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
              <button onClick={cta(config.ctaAction, config.ctaUrl)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all"
                style={{ ...btnStyle(style), fontFamily: bf(style) }}>
                {config.ctaText || 'Request a Quote'}<ArrowRight className="w-4 h-4"/>
              </button>
            </FieldTap>

            {/* Mobile-only: compact stacked cards */}
            <div className="md:hidden space-y-2.5 pt-2">
              {(tags.length > 0 ? tags.slice(0, 3) : ['Bridal Parties','Corporate Events','Destination Services']).map((tag, i) => (
                <div key={i}
                  className="flex items-center gap-4 px-6 py-4 text-white font-black text-sm uppercase tracking-widest"
                  style={{
                    background: accent,
                    borderRadius: br(style, 1.5),
                    opacity: 1 - i * 0.12,
                    transform: `translateX(${i * 10}px)`,
                    boxShadow: `0 8px 28px ${accent}35`,
                    animation: visible ? `cf-fade-up 0.45s ${i * 0.08}s both` : 'none',
                  }}>
                  <span className="text-[10px] opacity-50 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  {tag}
                </div>
              ))}
            </div>
          </div>

          {/* Right: image or decorative cards — desktop only */}
          <div className="hidden md:block">
            {hasBg ? (
              <div className="w-full aspect-[4/5] overflow-hidden shadow-2xl" style={{ borderRadius: br(style, 2) }}>
                <img src={config.bgImage!} alt="" className="w-full h-full object-cover"/>
              </div>
            ) : (
              <div className="w-full aspect-[4/5] relative overflow-hidden flex items-center justify-center"
                style={{ background: accent + '08', borderRadius: br(style, 2), border: `2px solid ${accent}15` }}>
                <div className="absolute inset-0"
                  style={{ backgroundImage: `radial-gradient(${accent}30 1.5px, transparent 1.5px)`, backgroundSize: '22px 22px' }}/>
                <div className="relative flex flex-col gap-4 items-center p-8 w-full">
                  {(tags.length > 0 ? tags.slice(0, 4) : ['Bridal Parties','Corporate Events','Destination']).map((tag, i) => (
                    <div key={i} className="px-7 py-4 text-sm font-black uppercase tracking-widest text-white shadow-2xl w-full text-center"
                      style={{
                        background: accent,
                        borderRadius: br(style, 2),
                        transform: `rotate(${([-1.5, 1, -0.8, 1.4][i] || 0)}deg) translateX(${([8, -6, 4, -5][i] || 0)}px)`,
                        boxShadow: `0 12px 36px ${accent}40`,
                        animation: visible ? `cf-float-up 0.5s ${i * 0.1}s both` : 'none',
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

  // ── BANNER (default fallback) ─────────────────────────────────────────────────
  return (
    <section ref={ref} className="relative overflow-hidden"
      style={{ background: hasBg ? `url(${config.bgImage}) center/cover no-repeat` : accent }}>
      {hasBg && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)' }}/>}
      {!hasBg && <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,rgba(0,0,0,0.12) 0%,rgba(0,0,0,0.28) 100%)' }}/>}
      <div className="relative max-w-6xl mx-auto px-6 md:px-16 py-16 md:py-20">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-14">
          <div className="space-y-4 text-center md:text-left flex-1">
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap}
              as="h2" className="text-3xl md:text-4xl font-light text-white"
              style={{ fontFamily: hf(style) }}>
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
                {tags.map((tag, i) => (
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
            <button onClick={cta(config.ctaAction, config.ctaUrl)}
              className="shrink-0 inline-flex items-center gap-2.5 px-10 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] active:scale-[0.98] transition-all"
              style={{ background: 'white', color: accent, borderRadius: br(style), fontFamily: bf(style), boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
              {config.ctaText || 'Request a Quote'}<ArrowRight className="w-4 h-4"/>
            </button>
          </FieldTap>
        </div>
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
function FAQSection({ config, style, isPreview, sectionId, onFieldTap }: SectionProps) {
  const [open, setOpen] = React.useState<number|null>(null), layout = config.layout || 'accordion';
  const items = [1,2,3,4,5,6].map(n => ({ q: config[`q${n}`], a: config[`a${n}`] })).filter(i => i.q && i.a);
  const H = () => <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-14" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Common Questions'}</FieldTap>;
  if (layout === 'two-col') return <section className={py(style)} style={{ background: '#f8fafc' }}><div className="max-w-5xl mx-auto px-6 md:px-16"><H/><div className="grid md:grid-cols-2 gap-6">{items.map((item,i) => <div key={i} className="p-6 bg-white space-y-2" style={{ borderRadius: br(style), border: `2px solid ${ac(style)}20` }}><p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{item.q}</p><p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{item.a}</p></div>)}</div></div></section>;
  if (layout === 'minimal') return <section className={py(style)} style={{ background: style.bgColor }}><div className="max-w-3xl mx-auto px-6 md:px-16"><H/><div className="space-y-6">{items.map((item,i) => <div key={i} className="border-b pb-6" style={{ borderColor: ac(style)+'18' }}><p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2" style={{ fontFamily: bf(style) }}>{item.q}</p><p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{item.a}</p></div>)}</div></div></section>;
  if (layout === 'cards') return (
    <section className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16"><H/>
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="group bg-white p-6 space-y-3 cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                   style={{ borderRadius: br(style, 1.5), border: `2px solid ${isOpen ? ac(style) : ac(style)+'20'}` }}
                   onClick={() => setOpen(isOpen ? null : i)}>
                <div className="flex items-start justify-between gap-3">
                  <span className="font-black text-sm uppercase tracking-tight text-slate-900 flex-1" style={{ fontFamily: bf(style) }}>{item.q}</span>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all" style={{ background: isOpen ? ac(style) : ac(style)+'12' }}>
                    {isOpen ? <ChevronUp className="w-3 h-3 text-white"/> : <ChevronDown className="w-3 h-3" style={{ color: ac(style) }}/>}
                  </div>
                </div>
                {isOpen && <p className="text-sm text-slate-500 leading-relaxed border-t pt-3" style={{ fontFamily: bf(style), borderColor: ac(style)+'15' }}>{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );

  if (layout === 'bold') return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-4xl mx-auto px-6 md:px-16"><H/>
        <div className="space-y-0">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="group border-b cursor-pointer" style={{ borderColor: ac(style)+'15' }}
                   onClick={() => setOpen(isOpen ? null : i)}>
                <div className="flex items-start gap-6 py-8 hover:pl-3 transition-all duration-300">
                  <span className="text-5xl font-light shrink-0 leading-none" style={{ color: isOpen ? ac(style) : ac(style)+'22', fontFamily: hf(style) }}>{String(i+1).padStart(2,'0')}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-lg md:text-xl uppercase tracking-tight text-slate-900 leading-tight" style={{ fontFamily: bf(style) }}>{item.q}</p>
                    <div style={{ maxHeight: isOpen ? '200px' : '0px', overflow: 'hidden', opacity: isOpen ? 1 : 0, transition: 'max-height 0.4s ease, opacity 0.3s' }}>
                      <p className="text-sm text-slate-500 leading-relaxed mt-3" style={{ fontFamily: bf(style) }}>{item.a}</p>
                    </div>
                  </div>
                  <ChevronDown className="w-5 h-5 shrink-0 mt-1 transition-transform duration-300" style={{ color: ac(style)+'60', transform: isOpen ? 'rotate(180deg)' : 'none' }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );

  if (layout === 'split') {
    const [activeIdx, setActiveIdx] = React.useState(0);
    return (
      <section className={py(style)} style={{ background: '#f8fafc' }}>
        <div className="max-w-5xl mx-auto px-6 md:px-16"><H/>
          <div className="grid md:grid-cols-2 gap-0 bg-white overflow-hidden shadow-xl" style={{ borderRadius: br(style, 2), border: `2px solid ${ac(style)}18` }}>
            <div className="border-r" style={{ borderColor: ac(style)+'15' }}>
              {items.map((item, i) => (
                <button key={i} onClick={() => setActiveIdx(i)}
                  className="w-full flex items-center gap-4 px-6 py-5 text-left border-b last:border-0 transition-all hover:bg-slate-50"
                  style={{ borderColor: ac(style)+'10', background: activeIdx === i ? ac(style)+'08' : 'transparent', borderLeft: activeIdx === i ? `3px solid ${ac(style)}` : '3px solid transparent' }}>
                  <span className="text-[11px] font-black uppercase tracking-tight leading-snug flex-1" style={{ color: activeIdx === i ? '#0f172a' : '#64748b', fontFamily: bf(style) }}>{item.q}</span>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: activeIdx === i ? ac(style) : '#cbd5e1' }}/>
                </button>
              ))}
            </div>
            <div className="p-8 md:p-10 flex flex-col justify-center min-h-[300px]">
              {items[activeIdx] && (
                <div className="space-y-4" key={activeIdx} style={{ animation: 'cf-fade-up 0.35s both' }}>
                  <div className="w-8 h-px" style={{ background: ac(style) }}/>
                  <p className="font-black text-base uppercase tracking-tight text-slate-900" style={{ fontFamily: bf(style) }}>{items[activeIdx].q}</p>
                  <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{items[activeIdx].a}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return <section className={py(style)} style={{ background: '#f8fafc' }}><div className="max-w-3xl mx-auto px-6 md:px-16"><H/><div className="space-y-2">{items.map((item,i) => <div key={i} className="overflow-hidden bg-white" style={{ borderRadius: br(style), border: `2px solid ${ac(style)}22` }}><button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors"><span className="font-black text-sm uppercase tracking-tight text-slate-900 pr-4" style={{ fontFamily: bf(style) }}>{item.q}</span>{open === i ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: ac(style) }}/> : <ChevronDown className="w-4 h-4 shrink-0 text-slate-300"/>}</button>{open === i && <div className="px-6 pb-6 text-sm text-slate-500 leading-relaxed" style={{ fontFamily: bf(style) }}>{item.a}</div>}</div>)}</div></div></section>;
}
// ─── Policy theme utilities ───────────────────────────────────────────────────
function bgIsDark(hex: string): boolean {
  const h = (hex || '#ffffff').replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) < 128;
}
function pBg(style: StyleConfig, elevated = false): string {
  return bgIsDark(style.bgColor)
    ? elevated ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'
    : elevated ? '#ffffff' : `${ac(style)}03`;
}
function pBorderColor(style: StyleConfig, open = false): string {
  return bgIsDark(style.bgColor)
    ? open ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)'
    : open ? `${ac(style)}22` : `${ac(style)}10`;
}
function pBoxShadow(style: StyleConfig, elevated = false): string {
  if (!elevated) return 'none';
  return bgIsDark(style.bgColor)
    ? '0 2px 16px rgba(0,0,0,0.4)'
    : '0 2px 12px rgba(0,0,0,0.04)';
}
function pTextPrimary(style: StyleConfig): string {
  return bgIsDark(style.bgColor) ? 'rgba(255,255,255,0.90)' : '#0f172a';
}
function pTextSecondary(style: StyleConfig): string {
  return bgIsDark(style.bgColor) ? 'rgba(255,255,255,0.48)' : '#64748b';
}
function pTextMuted(style: StyleConfig): string {
  return bgIsDark(style.bgColor) ? 'rgba(255,255,255,0.20)' : '#cbd5e1';
}
function pDivider(style: StyleConfig): string {
  return bgIsDark(style.bgColor) ? 'rgba(255,255,255,0.07)' : `${ac(style)}0b`;
}
function pIconBg(style: StyleConfig): React.CSSProperties {
  return {
    background: bgIsDark(style.bgColor) ? `${ac(style)}20` : `${ac(style)}0d`,
    border: `1px solid ${ac(style)}${bgIsDark(style.bgColor) ? '30' : '16'}`,
  };
}
function pCardPad(style: StyleConfig): string {
  return style.density === 'compact' ? 'p-5' : style.density === 'airy' ? 'p-8' : 'p-6';
}
function pbr(style: StyleConfig, mult = 1): string {
  return `${Math.min((style.borderRadius || 4) * mult, 24)}px`;
}
const POLICY_ICON_MAP: Record<string, React.ElementType> = {
  'shield':       Shield,
  'shield-check': ShieldCheck,
  'clock':        Clock,
  'clock3':       Clock3,
  'alert':        AlertTriangle,
  'ban':          Ban,
  'credit':       CreditCard,
  'heart':        Heart,
  'badge':        BadgeCheck,
  'info':         Info,
  'zap':          Zap,
  'leaf':         Leaf,
  'coffee':       Coffee,
  'flame':        Flame,
  'phone':        Phone,
  'mail':         Mail,
};

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
  const tenant = data.tenant, socialLinks: any[] = Array.isArray(config.socialLinks) ? config.socialLinks : [], layout = config.layout || 'split-map';
  const Info = () => (
    <div className="space-y-7">
      {config.showHours !== false && config.customHours && <div className="space-y-2.5"><div className="flex items-center gap-2"><Clock className="w-4 h-4" style={{ color: ac(style) }}/><p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style) }}>Hours</p></div><p className="text-sm text-slate-500 leading-relaxed whitespace-pre-line" style={{ fontFamily: bf(style) }}>{config.customHours}</p></div>}
      {tenant?.studioAddress && <div className="space-y-2.5"><div className="flex items-center gap-2"><MapPin className="w-4 h-4" style={{ color: ac(style) }}/><p className="text-[11px] font-black uppercase tracking-widest" style={{ color: ac(style) }}>Location</p></div><p className="text-sm text-slate-500" style={{ fontFamily: bf(style) }}>{tenant.studioAddress}</p></div>}
      {config.showPhone !== false && tenant?.phone && <div className="flex items-center gap-3"><Phone className="w-4 h-4" style={{ color: ac(style) }}/><a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.phone}</a></div>}
      {config.showEmail !== false && tenant?.email && <div className="flex items-center gap-3"><Mail className="w-4 h-4" style={{ color: ac(style) }}/><a href={`mailto:${tenant.email}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.email}</a></div>}
      {config.showSocial !== false && socialLinks.length > 0 && <div className="flex gap-3 flex-wrap">{socialLinks.map((link:any) => <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors border rounded-full" style={{ borderColor: ac(style)+'30' }}>{link.platform}</a>)}</div>}
      {config.showSocial !== false && tenant?.instagramHandle && <div className="flex items-center gap-3"><Instagram className="w-4 h-4" style={{ color: ac(style) }}/><a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">@{tenant.instagramHandle}</a></div>}
      {config.ctaText && <button onClick={cta(config.ctaAction, config.ctaUrl)} className="mt-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 hover:scale-[1.02] transition-all" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.ctaText}</button>}
    </div>
  );
  const Map = () => tenant?.studioLocation ? (<div className="overflow-hidden shadow-xl" style={{ height: '280px', borderRadius: br(style,1.5) }}><iframe src={`https://maps.google.com/maps?q=${tenant.studioLocation.lat},${tenant.studioLocation.lng}&z=15&output=embed`} className="w-full h-full border-0" loading="lazy" title="Studio location"/></div>) : null;
  return (
    <section id="contact" className={py(style)} style={{ background: '#f8fafc' }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-16" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Find Us'}</FieldTap>
        {layout === 'stacked' ? (
          <div className="space-y-10 max-w-2xl mx-auto">{config.showMap !== false && <Map/>}<Info/></div>
        ) : (
          <div className="grid md:grid-cols-2 gap-14 items-start"><Info/>{config.showMap !== false && <Map/>}</div>
        )}
      </div>
    </section>
  );
}

// ─── EventsSection ────────────────────────────────────────────────────────────
function EventsSection({ config, style, data, isPreview, sectionId, onFieldTap }: SectionProps) {
  const events = data.events;
  return (
    <section className={py(style)} style={{ background: style.bgColor }}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{ fontFamily: hf(style), color: '#0f172a' }}>{config.heading || 'Upcoming Events'}</FieldTap>
          {config.subheading && <p className="text-base text-slate-500" style={{ fontFamily: bf(style) }}>{config.subheading}</p>}
        </div>
        {events.length > 0 ? (
          <div className="space-y-4">
            {events.map((event: any) => {
              const d = event.date ? new Date(event.date?.toDate?.() ?? event.date) : null;
              return (
                <div key={event.id} className="flex items-center gap-6 p-6 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all" style={{ borderRadius: br(style,1.5), border: `2px solid ${ac(style)}22` }}>
                  {d && <div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-white" style={{ background: ac(style), borderRadius: br(style) }}><span className="text-[9px] font-black uppercase">{d.toLocaleString('default',{month:'short'})}</span><span className="text-xl font-black leading-none">{d.getDate()}</span></div>}
                  <div className="flex-1 min-w-0"><p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{ fontFamily: bf(style) }}>{event.title || event.name}</p>{event.description && <p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}</div>
                  <button onClick={cta(config.ctaAction, config.ctaUrl)} className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest" style={{ ...btnStyle(style), fontFamily: bf(style) }}>{config.ctaText || 'RSVP'}</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 space-y-4"><Calendar className="w-12 h-12 mx-auto text-slate-200"/><p className="text-[11px] font-black uppercase tracking-widest text-slate-300">{config.emptyText || 'Check back soon!'}</p></div>
        )}
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
