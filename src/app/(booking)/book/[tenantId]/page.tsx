'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, getDoc, getDocs, collection, query, orderBy } from 'firebase/firestore';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Calendar, Clock, MapPin, Phone, Instagram, ChevronDown, ChevronUp, Star, Gift, Sparkles, Pencil } from 'lucide-react';

// ─── Keyframes injected once ──────────────────────────────────────────────────
const ANIM_CSS = `
@keyframes cf-fade-up    { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
@keyframes cf-fade-in    { from{opacity:0} to{opacity:1} }
@keyframes cf-slide-left { from{opacity:0;transform:translateX(-28px)} to{opacity:1;transform:translateX(0)} }
@keyframes cf-slide-right{ from{opacity:0;transform:translateX(28px)} to{opacity:1;transform:translateX(0)} }
@keyframes cf-scale-up   { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
@keyframes cf-zoom-in    { from{opacity:0;transform:scale(1.08)} to{opacity:1;transform:scale(1)} }
`;

function boot() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('cf-anim')) {
    const s = document.createElement('style'); s.id = 'cf-anim'; s.textContent = ANIM_CSS;
    document.head.appendChild(s);
  }
}

// ─── Fonts ────────────────────────────────────────────────────────────────────
const STACKS: Record<string,string> = {
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
const GFONTS: Record<string,string> = {
  cormorant:'Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400',
  playfair:'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400',
  lora:'Lora:ital,wght@0,400;0,600;0,700;1,400', merriweather:'Merriweather:wght@300;400;700',
  'eb-garamond':'EB+Garamond:wght@400;600','libre-bask':'Libre+Baskerville:wght@400;700',
  'dm-serif':'DM+Serif+Display', domine:'Domine:wght@400;700',
  space:'Space+Grotesk:wght@300;400;500;600;700', josefin:'Josefin+Sans:wght@300;400;600;700',
  raleway:'Raleway:wght@300;400;500;600;700', montserrat:'Montserrat:wght@300;400;500;600;700',
  nunito:'Nunito:wght@300;400;600;700', poppins:'Poppins:wght@300;400;500;600;700',
  outfit:'Outfit:wght@300;400;500;600;700', 'dm-sans':'DM+Sans:wght@300;400;500;700',
  inter:'Inter:wght@300;400;500;700', figtree:'Figtree:wght@300;400;500;700',
  bebas:'Bebas+Neue', oswald:'Oswald:wght@300;400;500;600', anton:'Anton', righteous:'Righteous',
  abril:'Abril+Fatface', pacifico:'Pacifico', dancing:'Dancing+Script:wght@400;600;700',
  'great-vibes':'Great+Vibes',
};
function injectFonts(h: string, b: string) {
  boot();
  if (typeof document === 'undefined') return;
  const ids = Array.from(new Set([h,b])).filter(f=>GFONTS[f]);
  if (!ids.length) return;
  document.getElementById('cf-gfonts')?.remove();
  const link = document.createElement('link');
  link.id='cf-gfonts'; link.rel='stylesheet';
  link.href=`https://fonts.googleapis.com/css2?${ids.map(id=>`family=${GFONTS[id]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface StyleConfig {
  accentColor:string; bgColor:string; headingFont:string; bodyFont:string;
  borderRadius:number; buttonStyle:string; density:string;
}
interface SectionProps {
  config: Record<string,any>; style: StyleConfig; data: PageData;
  isPreview: boolean; sectionId: string;
  onFieldTap?: (sectionId:string, fieldKey:string) => void;
}
interface PageData { tenant:any; services:any[]; staff:any[]; events:any[]; }

const ac  = (s:StyleConfig) => s.accentColor||'#8b6914';
const hf  = (s:StyleConfig) => STACKS[s.headingFont]||STACKS.cormorant;
const bf  = (s:StyleConfig) => STACKS[s.bodyFont]||STACKS.space;
const br  = (s:StyleConfig, x=1) => `${(s.borderRadius||8)*x}px`;
const py  = (s:StyleConfig) => s.density==='compact'?'py-14 md:py-20':s.density==='airy'?'py-32 md:py-44':'py-24 md:py-32';

function btnStyle(s:StyleConfig, v:'primary'|'secondary'='primary') {
  const r = s.buttonStyle==='pill'?'999px':br(s,0.6);
  return v==='primary'
    ? {background:s.buttonStyle==='outline'||s.buttonStyle==='ghost'?'transparent':ac(s), color:s.buttonStyle==='outline'||s.buttonStyle==='ghost'?ac(s):'white', border:s.buttonStyle==='ghost'?'none':`2px solid ${ac(s)}`, borderRadius:r}
    : {background:'transparent', color:ac(s), border:`2px solid ${ac(s)}`, borderRadius:r};
}

// Inline animation style helper (used for hero entrance — always fires on mount)
const entranceAnim = (name:string, dur=700, delay=0): React.CSSProperties => ({
  animationName:name, animationDuration:`${dur}ms`, animationDelay:`${delay}ms`,
  animationFillMode:'both', animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)',
});

// ─── Scroll-reveal hook ───────────────────────────────────────────────────────
function useInView(threshold=0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el=ref.current; if(!el) return;
    const obs = new IntersectionObserver(([e])=>{ if(e.isIntersecting){setV(true);obs.disconnect();} },{threshold});
    obs.observe(el); return()=>obs.disconnect();
  },[threshold]);
  return {ref,visible:v};
}

// Animation map for scroll-reveal sections
const ANIM_MAP: Record<string,string> = {
  'fade-up':   'cf-fade-up', 'fade-in':   'cf-fade-in',
  'slide-left':'cf-slide-left','slide-right':'cf-slide-right',
  'scale-up':  'cf-scale-up', 'zoom-in':   'cf-zoom-in', 'none':'',
};

// ─── FieldTap — wraps any element for inline click-to-edit in preview ─────────
function FieldTap({ sectionId, fieldKey, isPreview, onFieldTap, as='span', children, style, className }: {
  sectionId:string; fieldKey:string; isPreview:boolean;
  onFieldTap?:(s:string,f:string)=>void;
  as?:'span'|'div'|'h1'|'h2'|'h3'|'p'; children:React.ReactNode;
  style?:React.CSSProperties; className?:string;
}) {
  const [hov, setHov] = useState(false);
  const Tag = as as any;
  const tapStyle: React.CSSProperties = isPreview ? {
    ...style,
    cursor:'pointer',
    outline: hov ? '2px solid rgba(99,102,241,0.8)' : '2px solid transparent',
    outlineOffset:'2px', borderRadius:'3px',
    transition:'outline-color 0.15s',
  } : style || {};
  return (
    <Tag
      style={tapStyle}
      className={className}
      onMouseEnter={()=>isPreview&&setHov(true)}
      onMouseLeave={()=>isPreview&&setHov(false)}
      onClick={isPreview?(e:any)=>{e.stopPropagation();onFieldTap?.(sectionId,fieldKey);}:undefined}
    >
      {children}
    </Tag>
  );
}

// ─── Section wrapper — scroll reveal + click-to-edit section overlay ──────────
function SectionWrapper({ section, isPreview, onEdit, onFieldTap, children }: {
  section:PageSection; isPreview:boolean; onEdit:(id:string)=>void;
  onFieldTap:(s:string,f:string)=>void; children:React.ReactNode;
}) {
  const {ref, visible} = useInView();
  const [hov, setHov] = useState(false);
  const animCfg = (section.config as any)._animation || {};
  const animType  = animCfg.type  || 'fade-up';
  const animSpeed = animCfg.speed || 700;
  const animName  = ANIM_MAP[animType] || 'cf-fade-up';

  // Nav is sticky — never fade
  if (section.type==='nav') {
    return (
      <div className="relative" onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
        {children}
        {isPreview&&hov&&<EditOverlay onClick={()=>onEdit(section.id)} label="Edit nav" />}
      </div>
    );
  }

  // 'none' animation — just reveal immediately
  if (animType==='none') {
    return (
      <div className="relative" onMouseEnter={()=>isPreview&&setHov(true)} onMouseLeave={()=>isPreview&&setHov(false)}>
        {children}
        {isPreview&&hov&&<EditOverlay onClick={()=>onEdit(section.id)} />}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="relative"
      style={visible ? {
        animationName:animName,
        animationDuration:`${animSpeed}ms`,
        animationFillMode:'both',
        animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)',
      } : {
        opacity:0,  // hide before animation starts — keyframe handles fade-in
      }}
      onMouseEnter={()=>isPreview&&setHov(true)}
      onMouseLeave={()=>isPreview&&setHov(false)}
    >
      {children}
      {isPreview&&hov&&<EditOverlay onClick={()=>onEdit(section.id)} />}
    </div>
  );
}

function EditOverlay({ onClick, label='Edit section' }:{ onClick:()=>void; label?:string }) {
  return (
    <div className="absolute inset-0 z-50 cursor-pointer" onClick={onClick}>
      <div className="absolute inset-0 pointer-events-none" style={{boxShadow:'inset 0 0 0 2.5px rgba(99,102,241,0.7)',borderRadius:'2px'}} />
      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-white text-[10px] font-black uppercase tracking-widest shadow-xl" style={{background:'#6366f1',borderRadius:'8px'}}>
        <Pencil className="w-3 h-3" /> {label}
      </div>
    </div>
  );
}

// ─── Default sections ─────────────────────────────────────────────────────────
function buildDefaults(): PageSection[] {
  return [
    {id:'nav',     type:'nav',     enabled:true,order:0,config:{logoText:'Studio',ctaText:'Book Now',showLinks:true,sticky:true}},
    {id:'hero',    type:'hero',    enabled:true,order:1,config:{headline:'Book Your Experience',subheadline:'A sanctuary of craft, curated for those who appreciate the details.',ctaText:'Book a Session',showWalkIn:true,cta2Text:'Walk In Today',layout:'centered',overlayOpacity:40}},
    {id:'services',type:'services',enabled:true,order:2,config:{heading:'Our Services',subheading:'Handcrafted treatments for every occasion',ctaText:'Book this service',columns:'2',showPrices:true,showDuration:true,showDesc:true}},
    {id:'team',    type:'team',    enabled:true,order:3,config:{heading:'The Artists',subheading:'Expert hands for every style',showSpecialties:true}},
    {id:'quote',   type:'quote',   enabled:true,order:4,config:{heading:'Need Something Bigger?',subheading:'Planning a wedding, bridal party, or corporate event? We craft bespoke experiences.',ctaText:'Request a Quote',tags:['Bridal Parties','Corporate Events','Destination Services']}},
    {id:'contact', type:'contact', enabled:true,order:5,config:{heading:'Find Us',showMap:true,showHours:true,showPhone:true,showSocial:true,ctaText:'Book an Appointment'}},
  ];
}

// ─── Nav ─────────────────────────────────────────────────────────────────────
function NavSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  return (
    <nav className={cn('z-50 flex items-center justify-between px-6 md:px-14 py-4 bg-white/95 backdrop-blur-xl border-b',config.sticky!==false&&'sticky top-0')}
         style={{borderColor:ac(style)+'22'}}>
      <div className="flex items-center gap-3">
        {config.logoUrl
          ? <img src={config.logoUrl} alt="Logo" className="h-9 w-auto object-contain" />
          : <FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
                      style={{fontFamily:hf(style),color:ac(style),fontSize:'20px',fontWeight:'bold',letterSpacing:'-0.05em'}}>
              {config.logoText||'Studio'}
            </FieldTap>
        }
      </div>
      {config.showLinks!==false&&(
        <div className="hidden md:flex items-center gap-8">
          {['Services','Team','Contact'].map(l=>(
            <a key={l} href={`#${l.toLowerCase()}`} className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors" style={{fontFamily:bf(style)}}>{l}</a>
          ))}
        </div>
      )}
      <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
        <button className="px-6 py-2.5 text-[11px] font-black uppercase tracking-widest shadow-lg hover:opacity-90 transition-all active:scale-95"
                style={{...btnStyle(style),fontFamily:bf(style)}}>
          {config.ctaText||'Book Now'}
        </button>
      </FieldTap>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function HeroSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const isSplit=config.layout==='split', isFullbleed=config.layout==='fullbleed'||config.layout==='cinematic';
  const hasBg=!!config.bgImage, hasVideo=!!config.videoUrl;
  const opacity=(config.overlayOpacity??40)/100;
  const textColor=hasBg||hasVideo?'white':'#0f172a', subColor=hasBg||hasVideo?'rgba(255,255,255,0.75)':'#64748b';
  const showWalkIn=config.showWalkIn!==false;

  const Headline = () => (
    <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
              as={isSplit?'h1':'h1'} className={isSplit?'text-5xl md:text-7xl leading-[0.95] font-light':'text-6xl md:text-8xl leading-[0.95] font-light'}
              style={{fontFamily:hf(style),color:textColor,...entranceAnim('cf-fade-up',900,100)}}>
      {config.headline||'Book Your Experience'}
    </FieldTap>
  );
  const Sub = () => (
    <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
              as="p" style={{fontFamily:bf(style),color:subColor,...entranceAnim('cf-fade-up',900,280)}}
              className={isSplit?'text-lg leading-relaxed max-w-md':'text-xl leading-relaxed max-w-2xl mx-auto'}>
      {config.subheadline}
    </FieldTap>
  );
  const Btns = () => (
    <div className="flex flex-wrap gap-4" style={entranceAnim('cf-fade-up',900,440)}>
      <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
        <button className={cn(isSplit?'px-9 py-4':'px-12 py-4','font-bold shadow-2xl hover:opacity-90 hover:scale-[1.02] transition-all')} style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book a Session'}</button>
      </FieldTap>
      {showWalkIn&&(
        <FieldTap sectionId={sectionId} fieldKey="cta2Text" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
          <button className={cn(isSplit?'px-9 py-4':'px-12 py-4','font-bold hover:opacity-80 transition-all')} style={{...btnStyle(style,'secondary'),borderColor:hasBg?'white':ac(style),color:hasBg?'white':ac(style),fontFamily:bf(style)}}>{config.cta2Text||'Walk In'}</button>
        </FieldTap>
      )}
    </div>
  );

  return (
    <section className="relative flex items-center overflow-hidden" style={{minHeight:isFullbleed?'100vh':'82vh',background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:style.bgColor}}>
      {hasVideo&&<video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      {(hasBg||hasVideo)&&<div className="absolute inset-0" style={{background:`rgba(0,0,0,${opacity})`}}/>}
      {config.showBadge&&config.badgeText&&(
        <FieldTap sectionId={sectionId} fieldKey="badgeText" isPreview={isPreview} onFieldTap={onFieldTap} as="div"
                  className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 border border-white/30 bg-white/10 backdrop-blur text-white text-[10px] font-black uppercase tracking-widest rounded-full"
                  style={entranceAnim('cf-fade-in',600,200)}>
          {config.badgeText}
        </FieldTap>
      )}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 py-24">
        {isSplit?(
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="space-y-8"><Headline/><Sub/><Btns/></div>
            <div style={entranceAnim('cf-scale-up',900,200)}>
              {config.heroImage?<img src={config.heroImage} alt="" className="w-full aspect-[4/5] object-cover shadow-2xl" style={{borderRadius:br(style,2)}}/>:<div className="w-full aspect-[4/5]" style={{background:ac(style)+'18',borderRadius:br(style,2)}}/>}
            </div>
          </div>
        ):(
          <div className="max-w-4xl mx-auto text-center space-y-8"><Headline/><Sub/><Btns/></div>
        )}
      </div>
    </section>
  );
}

// ─── Trust ────────────────────────────────────────────────────────────────────
function TrustSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const stats=[{v:config.stat1v,l:config.stat1l},{v:config.stat2v,l:config.stat2l},{v:config.stat3v,l:config.stat3l},{v:config.stat4v,l:config.stat4l}].filter(s=>s.v);
  return (
    <section className="py-14 border-y" style={{borderColor:ac(style)+'20'}}>
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((s,i)=>(
          <div key={i} className="space-y-1">
            <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}v`} isPreview={isPreview} onFieldTap={onFieldTap} as="p"
                      className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>
              {s.v}
            </FieldTap>
            <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}l`} isPreview={isPreview} onFieldTap={onFieldTap} as="p"
                      className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>
              {s.l}
            </FieldTap>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Services ─────────────────────────────────────────────────────────────────
function ServicesSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps) {
  const services=data.services;
  const layout=config.layout||'cards';
  const cols=parseInt(config.columns)||2;
  const gridCls=cols===1?'grid-cols-1 max-w-lg mx-auto':cols===3?'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3':'grid-cols-1 sm:grid-cols-2';
  const animName=ANIM_MAP[(config._animation?.type)||'fade-up']||'cf-fade-up';
  const animDur=(config._animation?.speed||600);
  const svcAnim=(i:number)=>({animationName:animName,animationDuration:`${animDur}ms`,animationDelay:`${i*80}ms`,animationFillMode:'both' as const,animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'});
  return (
    <section id="services" className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2"
                    className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>
            {config.heading||'Our Services'}
          </FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        {services.length>0?(
          layout==='list'?(
            /* ── List layout ── */
            <div className="space-y-3 max-w-3xl mx-auto">
              {services.map((svc:any,i:number)=>(
                <div key={svc.id} className="flex items-center gap-5 p-5 bg-white hover:shadow-md transition-all duration-200"
                     style={{borderRadius:br(style),border:`2px solid ${ac(style)}20`,...svcAnim(i)}}>
                  {config.showImages&&svc.imageUrl&&<img src={svc.imageUrl} alt={svc.name} className="w-16 h-16 object-cover shrink-0" style={{borderRadius:br(style)}}/>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 truncate" style={{fontFamily:bf(style)}}>{svc.name}</h3>
                      {config.showPrices!==false&&svc.price&&<span className="text-base font-black shrink-0" style={{color:ac(style)}}>${svc.price}</span>}
                    </div>
                    {config.showDesc!==false&&svc.description&&<p className="text-xs text-slate-400 leading-relaxed line-clamp-2" style={{fontFamily:bf(style)}}>{svc.description}</p>}
                    {config.showDuration!==false&&svc.duration&&<p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mt-1">{svc.duration} min</p>}
                  </div>
                  <button className="shrink-0 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book'}</button>
                </div>
              ))}
            </div>
          ):(
            /* ── Cards layout (default) ── */
            <div className={`grid gap-5 ${gridCls}`}>
              {services.map((svc:any,i:number)=>(
                <div key={svc.id} className="group p-7 bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                     style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}25`,...svcAnim(i)}}>
                  {config.showImages&&svc.imageUrl&&<img src={svc.imageUrl} alt={svc.name} className="w-full aspect-video object-cover mb-4 group-hover:scale-[1.02] transition-transform duration-500" style={{borderRadius:br(style)}}/>}
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{fontFamily:bf(style)}}>{svc.name}</h3>
                    {config.showPrices!==false&&svc.price&&<span className="text-base font-black ml-3 shrink-0" style={{color:ac(style)}}>${svc.price}</span>}
                  </div>
                  {config.showDesc!==false&&svc.description&&<p className="text-sm text-slate-500 leading-relaxed mb-4" style={{fontFamily:bf(style)}}>{svc.description}</p>}
                  {config.showDuration!==false&&svc.duration&&<div className="flex items-center gap-1.5 mb-5"><Clock className="w-3 h-3" style={{color:ac(style)}}/><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</p></div>}
                  <button className="w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book Now'}</button>
                </div>
              ))}
            </div>
          )
        ):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Services coming soon</p>}
      </div>
    </section>
  );
}

// ─── Team ─────────────────────────────────────────────────────────────────────
function TeamSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps) {
  const staff=data.staff;
  const layout=config.layout||'circles';
  const animName=ANIM_MAP[(config._animation?.type)||'scale-up']||'cf-scale-up';
  const animDur=(config._animation?.speed||600);
  const mAnim=(i:number)=>({animationName:animName,animationDuration:`${animDur}ms`,animationDelay:`${i*80}ms`,animationFillMode:'both' as const,animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'});
  return (
    <section id="team" className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'The Artists'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        {staff.length>0?(
          layout==='row'?(
            /* ── Horizontal scrolling row ── */
            <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory" style={{scrollbarWidth:'none'}}>
              {staff.map((m:any,i:number)=>(
                <div key={m.id} className="text-center space-y-3 shrink-0 snap-start group" style={{width:'160px',...mAnim(i)}}>
                  <div className="relative mx-auto w-24 h-24 overflow-hidden shadow-lg group-hover:scale-105 transition-all duration-500" style={{background:ac(style)+'15',borderRadius:br(style,1.5)}}>
                    {m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>:<span className="absolute inset-0 flex items-center justify-center text-2xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{m.name?.[0]}</span>}
                  </div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 truncate" style={{fontFamily:bf(style)}}>{m.name}</p>
                  {config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[9px] text-slate-400 uppercase tracking-wider">{m.specialties[0]}</p>}
                  {config.showBookButton&&<button className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}
                </div>
              ))}
            </div>
          ):layout==='editorial'?(
            /* ── Editorial cards ── */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {staff.map((m:any,i:number)=>(
                <div key={m.id} className="group overflow-hidden bg-white hover:shadow-xl transition-all duration-300" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}18`,...mAnim(i)}}>
                  <div className="relative aspect-[4/3] overflow-hidden" style={{background:ac(style)+'12'}}>
                    {m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>:<span className="absolute inset-0 flex items-center justify-center text-5xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{m.name?.[0]}</span>}
                  </div>
                  <div className="p-5 space-y-2">
                    <p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{fontFamily:bf(style)}}>{m.name}</p>
                    {config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[10px] uppercase tracking-wider text-slate-400">{m.specialties.slice(0,2).join(' · ')}</p>}
                    {config.showBio&&m.bio&&<p className="text-xs text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{m.bio}</p>}
                    {config.showBookButton&&<button className="w-full mt-2 py-2.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}
                  </div>
                </div>
              ))}
            </div>
          ):(
            /* ── Circles layout (default) ── */
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">
              {staff.map((m:any,i:number)=>(
                <div key={m.id} className="text-center space-y-4 group" style={mAnim(i)}>
                  <div className="relative mx-auto w-28 h-28 overflow-hidden shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-500" style={{background:ac(style)+'15',borderRadius:br(style,1.5)}}>
                    {m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>:<span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{m.name?.[0]}</span>}
                  </div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{fontFamily:bf(style)}}>{m.name}</p>
                    {config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{m.specialties.slice(0,2).join(' · ')}</p>}
                    {config.showBio&&m.bio&&<p className="text-xs text-slate-500 mt-2 leading-relaxed" style={{fontFamily:bf(style)}}>{m.bio}</p>}
                    {config.showBookButton&&<button className="mt-3 px-5 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}
                  </div>
                </div>
              ))}
            </div>
          )
        ):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Team coming soon</p>}
      </div>
    </section>
  );
}

// ─── Reviews ──────────────────────────────────────────────────────────────────
function ReviewsSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const reviews=[{name:'Sarah M.',rating:5,text:'Absolutely incredible experience. The attention to detail is unmatched — I leave feeling taken care of every single time.'},{name:'Jessica T.',rating:5,text:"I've been coming here for over a year and every visit exceeds my expectations. The team is truly world-class."},{name:'Priya K.',rating:5,text:'The atmosphere is luxurious yet so welcoming. I always feel like a VIP. Truly the best in the city.'}];
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'What Clients Say'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {reviews.map((r,i)=>(
            <div key={i} className="p-8 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}20`,animationName:'cf-fade-up',animationDuration:'600ms',animationDelay:`${i*100}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              {config.showRating!==false&&<div className="flex gap-1 mb-4">{Array(r.rating).fill(0).map((_,j)=><Star key={j} className="w-4 h-4 fill-current" style={{color:ac(style)}}/>)}</div>}
              {config.showPhotos&&<div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-sm font-black mb-4">{r.name[0]}</div>}
              <p className="text-sm leading-relaxed text-slate-600 italic mb-4" style={{fontFamily:bf(style)}}>"{r.text}"</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>— {r.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
function GallerySection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const uploaded:any[]=Array.isArray(config.images)?config.images:[];
  const cols=parseInt(config.columns)||3;
  const gridCls=cols===2?'grid-cols-2':cols===4?'grid-cols-2 md:grid-cols-4':'grid-cols-2 md:grid-cols-3';
  const shades=['08','10','14','18','12','16'];
  return (
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Work'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        <div className={`grid ${gridCls} gap-3`}>
          {(uploaded.length>0?uploaded:shades.map((s,i)=>({id:i,url:null,shade:s}))).map((img:any,i:number)=>(
            <div key={img.id??i} className={cn('overflow-hidden group',i===0||i===5?'aspect-[4/5]':'aspect-square')} style={{borderRadius:br(style),animationName:'cf-scale-up',animationDuration:'500ms',animationDelay:`${i*60}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              {img.url?<img src={img.url} alt={img.caption||''} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>:<div className="w-full h-full" style={{background:ac(style)+img.shade}}/>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Before / After ───────────────────────────────────────────────────────────
function BeforeAfterSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const pairs:any[]=Array.isArray(config.pairs)?config.pairs:[];
  const showLabels=config.showLabels!==false;
  const items=pairs.length>0?pairs:[0,1];
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Transformations'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {items.map((item:any,i:number)=>{
            const isPair=typeof item==='object'&&item?.beforeUrl!==undefined;
            return (
              <div key={i} className="space-y-3" style={{animationName:'cf-fade-up',animationDuration:'700ms',animationDelay:`${i*150}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
                <div className="grid grid-cols-2 gap-2">
                  {[{label:'Before',url:isPair?item.beforeUrl:null,shade:'12'},{label:'After',url:isPair?item.afterUrl:null,shade:'28'}].map((side,j)=>(
                    <div key={j} className="relative overflow-hidden aspect-square group" style={{borderRadius:br(style)}}>
                      {side.url?<img src={side.url} alt={side.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>:<div className="w-full h-full flex items-center justify-center" style={{background:ac(style)+side.shade}}>{showLabels&&<span className="text-[10px] font-black uppercase tracking-widest" style={{color:ac(style)+(j===0?'80':'cc')}}>{side.label}</span>}</div>}
                      {side.url&&showLabels&&<div className="absolute bottom-2 left-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white" style={{background:j===0?'rgba(0,0,0,0.5)':ac(style)+'cc',borderRadius:'4px'}}>{side.label}</div>}
                    </div>
                  ))}
                </div>
                {isPair&&item.caption&&<p className="text-xs text-slate-400 text-center font-bold uppercase tracking-widest" style={{fontFamily:bf(style)}}>{item.caption}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Memberships ──────────────────────────────────────────────────────────────
function MembershipsSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const plans=[{name:'Essential',price:'$89',period:'/mo',features:['2 services/month','Priority booking','10% off retail']},{name:'Luxe',price:'$149',period:'/mo',features:['4 services/month','VIP priority','20% off retail','Free upgrades'],featured:true},{name:'Elite',price:'$249',period:'/mo',features:['Unlimited services','Dedicated artist','30% off retail','Exclusive events']}];
  return (
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Join the Club'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        <div className="grid md:grid-cols-3 gap-6 items-center">
          {plans.map((plan,i)=>(
            <div key={i} className={cn('p-8 space-y-6 hover:shadow-2xl transition-all',plan.featured&&'md:scale-105')}
                 style={{borderRadius:br(style,1.5),border:`2px solid ${plan.featured?ac(style):ac(style)+'25'}`,background:plan.featured?ac(style):'white',animationName:'cf-fade-up',animationDuration:'700ms',animationDelay:`${i*100}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{color:plan.featured?'rgba(255,255,255,0.65)':ac(style)}}>{plan.name}</p>
                {config.showBadge&&plan.featured&&<span className="inline-block mt-1 px-2 py-0.5 text-[8px] font-black uppercase text-white bg-white/20 rounded">Most Popular</span>}
                <div className="flex items-end gap-1 mt-2"><span className="text-4xl font-light" style={{fontFamily:hf(style),color:plan.featured?'white':'#0f172a'}}>{plan.price}</span><span className="text-sm mb-1" style={{color:plan.featured?'rgba(255,255,255,0.5)':'#94a3b8',fontFamily:bf(style)}}>{plan.period}</span></div>
              </div>
              <ul className="space-y-2.5">{plan.features.map((f,j)=><li key={j} className="flex items-center gap-2.5 text-sm" style={{fontFamily:bf(style),color:plan.featured?'rgba(255,255,255,0.8)':'#64748b'}}><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:plan.featured?'rgba(255,255,255,0.6)':ac(style)}}/>{f}</li>)}</ul>
              <button className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{background:plan.featured?'white':ac(style),color:plan.featured?ac(style):'white',borderRadius:br(style),fontFamily:bf(style)}}>{config.ctaText||'Join Now'}</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Packages ─────────────────────────────────────────────────────────────────
function PackagesSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const pkgs=[{name:'5-Pack',sessions:5,price:'$199',saving:'Save 15%'},{name:'10-Pack',sessions:10,price:'$349',saving:'Save 25%'},{name:'20-Pack',sessions:20,price:'$599',saving:'Save 35%'}];
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Prepaid Sessions'}</FieldTap>
          {config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {pkgs.map((pkg,i)=>(
            <div key={i} className="p-8 bg-white text-center space-y-5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}25`,animationName:'cf-fade-up',animationDuration:'600ms',animationDelay:`${i*80}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{color:ac(style)}}>{pkg.name}</p>
              <p className="text-4xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{pkg.price}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>
              {config.showExpiry!==false&&<p className="text-xs text-slate-400">Valid 12 months</p>}
              {config.showSavings!==false&&<span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{background:ac(style),borderRadius:br(style,2)}}>{pkg.saving}</span>}
              <button className="block w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>Purchase</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gift Cards ───────────────────────────────────────────────────────────────
function GiftCardsSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const amounts=(config.amounts||'25,50,75,100').split(',').map((a:string)=>a.trim());
  return (
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-2xl mx-auto px-6 md:px-16 text-center space-y-10">
        <div className="space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Give the Gift of Beauty'}</FieldTap>
          {config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}
        </div>
        <div className="p-10 shadow-2xl space-y-8 text-white" style={{background:`linear-gradient(135deg,${ac(style)} 0%,${ac(style)}cc 100%)`,borderRadius:br(style,2)}}>
          <Gift className="w-12 h-12 mx-auto opacity-80"/>
          <p className="text-lg font-light" style={{fontFamily:hf(style)}}>Choose an amount</p>
          <div className="flex flex-wrap gap-3 justify-center">
            {amounts.map((a:string,i:number)=><button key={i} className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{borderRadius:br(style)}}>${a}</button>)}
            <button className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{borderRadius:br(style)}}>Custom</button>
          </div>
          <button className="px-12 py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all" style={{background:'white',color:ac(style),borderRadius:br(style,3),fontFamily:bf(style)}}>{config.ctaText||'Send a Gift Card'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Quote ────────────────────────────────────────────────────────────────────
function QuoteSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const rawTags=config.tags;
  const tags:string[]=Array.isArray(rawTags)?rawTags:typeof rawTags==='string'?rawTags.split(',').map((t:string)=>t.trim()).filter(Boolean):[];
  return (
    <section className={py(style)} style={{background:'#0f172a'}}>
      <div className="max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10">
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light text-white" style={{fontFamily:hf(style)}}>{config.heading||'Need Something Bigger?'}</FieldTap>
        <FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>
        {tags.length>0&&<div className="flex flex-wrap gap-2.5 justify-center">{tags.map((tag:string,i:number)=><span key={i} className="px-5 py-2 border text-[11px] font-black uppercase tracking-widest text-white/55 border-white/20" style={{borderRadius:br(style,3)}}>{tag}</span>)}</div>}
        <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
          <button className="px-12 py-4 font-black text-sm uppercase tracking-widest shadow-2xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Request a Quote'}</button>
        </FieldTap>
      </div>
    </section>
  );
}

// ─── New Client ───────────────────────────────────────────────────────────────
function NewClientSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  return (
    <section className={py(style)} style={{background:ac(style)+'0e'}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12" style={{borderRadius:br(style,2),border:`2px solid ${ac(style)}28`}}>
          <div className="text-center md:text-left space-y-3">
            <div className="flex items-center gap-2 justify-center md:justify-start"><Sparkles className="w-4 h-4" style={{color:ac(style)}}/><p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>First Visit</p></div>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-4xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'First Visit Special'}</FieldTap>
            <FieldTap sectionId={sectionId} fieldKey="offerText" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-xl font-black" style={{color:ac(style),fontFamily:bf(style)}}>{config.offerText}</FieldTap>
            {config.finePrint&&<p className="text-xs text-slate-400">{config.finePrint}</p>}
          </div>
          <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
            <button className="shrink-0 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Claim Offer'}</button>
          </FieldTap>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const [open,setOpen]=React.useState<number|null>(null);
  const items=[1,2,3,4,5,6].map(n=>({q:config[`q${n}`],a:config[`a${n}`]})).filter(i=>i.q&&i.a);
  return (
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-3xl mx-auto px-6 md:px-16">
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-14" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Common Questions'}</FieldTap>
        <div className="space-y-2">
          {items.map((item,i)=>(
            <div key={i} className="overflow-hidden bg-white" style={{borderRadius:br(style),border:`2px solid ${ac(style)}22`,animationName:'cf-fade-up',animationDuration:'500ms',animationDelay:`${i*60}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              <button onClick={()=>setOpen(open===i?null:i)} className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors">
                <span className="font-black text-sm uppercase tracking-tight text-slate-900 pr-4" style={{fontFamily:bf(style)}}>{item.q}</span>
                {open===i?<ChevronUp className="w-4 h-4 shrink-0" style={{color:ac(style)}}/>:<ChevronDown className="w-4 h-4 shrink-0 text-slate-300"/>}
              </button>
              {open===i&&<div className="px-6 pb-6 text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{item.a}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Policies ─────────────────────────────────────────────────────────────────
function PoliciesSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const policyItems:any[]=Array.isArray(config.policies)?config.policies:[];
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-14" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Policies'}</FieldTap>
        {policyItems.length>0?(
          <div className="grid md:grid-cols-3 gap-6">
            {policyItems.map((p:any,i:number)=>(
              <div key={p.id||i} className="p-7 bg-white space-y-3" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22`,animationName:'cf-fade-up',animationDuration:'600ms',animationDelay:`${i*80}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
                <p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>{p.title}</p>
                <p className="text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{p.body}</p>
              </div>
            ))}
          </div>
        ):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-12">No policies configured yet</p>}
      </div>
    </section>
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────
function ContactSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps) {
  const tenant=data.tenant;
  const socialLinks:any[]=Array.isArray(config.socialLinks)?config.socialLinks:[];
  return (
    <section id="contact" className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-16" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Find Us'}</FieldTap>
        <div className="grid md:grid-cols-2 gap-14 items-start">
          <div className="space-y-7" style={{animationName:'cf-slide-left',animationDuration:'700ms',animationDelay:'100ms',animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
            {config.showHours!==false&&config.customHours&&(
              <div className="space-y-2.5"><div className="flex items-center gap-2"><Clock className="w-4 h-4" style={{color:ac(style)}}/><p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>Hours</p></div><p className="text-sm text-slate-500 leading-relaxed whitespace-pre-line" style={{fontFamily:bf(style)}}>{config.customHours}</p></div>
            )}
            {tenant?.studioAddress&&<div className="space-y-2.5"><div className="flex items-center gap-2"><MapPin className="w-4 h-4" style={{color:ac(style)}}/><p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>Location</p></div><p className="text-sm text-slate-500" style={{fontFamily:bf(style)}}>{tenant.studioAddress}</p></div>}
            {config.showPhone!==false&&tenant?.phone&&<div className="flex items-center gap-3"><Phone className="w-4 h-4" style={{color:ac(style)}}/><a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.phone}</a></div>}
            {config.showSocial!==false&&socialLinks.length>0&&<div className="flex gap-3 flex-wrap">{socialLinks.map((link:any)=><a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors border rounded-full" style={{borderColor:ac(style)+'30'}}>{link.platform}</a>)}</div>}
            {config.showSocial!==false&&tenant?.instagramHandle&&<div className="flex items-center gap-3"><Instagram className="w-4 h-4" style={{color:ac(style)}}/><a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">@{tenant.instagramHandle}</a></div>}
            {config.ctaText&&<button className="mt-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText}</button>}
          </div>
          {config.showMap!==false&&tenant?.studioLocation&&(
            <div className="overflow-hidden shadow-xl" style={{height:'320px',borderRadius:br(style,1.5),animationName:'cf-scale-up',animationDuration:'700ms',animationDelay:'200ms',animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              <iframe src={`https://maps.google.com/maps?q=${tenant.studioLocation.lat},${tenant.studioLocation.lng}&z=15&output=embed`} className="w-full h-full border-0" loading="lazy" title="Studio location"/>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────
function EventsSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps) {
  const events=data.events;
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Upcoming Events'}</FieldTap>
          {config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}
        </div>
        {events.length>0?(
          <div className="space-y-4">
            {events.map((event:any,i:number)=>{
              const d=event.date?new Date(event.date?.toDate?.()??event.date):null;
              return(
                <div key={event.id} className="flex items-center gap-6 p-6 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22`,animationName:'cf-fade-up',animationDuration:'500ms',animationDelay:`${i*70}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
                  {d&&<div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-white" style={{background:ac(style),borderRadius:br(style)}}><span className="text-[9px] font-black uppercase">{d.toLocaleString('default',{month:'short'})}</span><span className="text-xl font-black leading-none">{d.getDate()}</span></div>}
                  <div className="flex-1 min-w-0"><p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{fontFamily:bf(style)}}>{event.title||event.name}</p>{event.description&&<p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}</div>
                  <button className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'RSVP'}</button>
                </div>
              );
            })}
          </div>
        ):(
          <div className="text-center py-16 space-y-4"><Calendar className="w-12 h-12 mx-auto text-slate-200"/><p className="text-[11px] font-black uppercase tracking-widest text-slate-300">{config.emptyText||'Check back soon!'}</p></div>
        )}
      </div>
    </section>
  );
}

// ─── Referral ─────────────────────────────────────────────────────────────────
function ReferralSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  return (
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Refer a Friend'}</FieldTap>
          {config.subheading&&<p className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</p>}
        </div>
        <div className="grid grid-cols-2 gap-5 max-w-md mx-auto">
          {[{l:'You get',v:config.rewardYou},{l:'Friend gets',v:config.rewardFriend}].map((item,i)=>(
            <div key={i} className="p-6 bg-white space-y-2" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22`,animationName:'cf-scale-up',animationDuration:'600ms',animationDelay:`${i*100}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.l}</p>
              <p className="text-2xl font-black" style={{fontFamily:hf(style),color:ac(style)}}>{item.v}</p>
            </div>
          ))}
        </div>
        <button className="px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Get My Referral Link'}</button>
      </div>
    </section>
  );
}

// ─── Story ────────────────────────────────────────────────────────────────────
function StorySection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const hasImage=!!config.image;
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16">
        <div className={cn('grid gap-14 items-center',hasImage?'md:grid-cols-2':'max-w-2xl mx-auto')}>
          <div className="space-y-8" style={{animationName:'cf-slide-left',animationDuration:'800ms',animationDelay:'100ms',animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
            <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Story'}</FieldTap>
            <div className="w-12 h-px" style={{background:ac(style)}}/>
            {config.pullQuote&&<FieldTap sectionId={sectionId} fieldKey="pullQuote" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-2xl font-light italic" style={{fontFamily:hf(style),color:ac(style)}}>"{config.pullQuote}"</FieldTap>}
            <FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{config.body}</FieldTap>
            {config.ctaText&&<button className="px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{...btnStyle(style,'secondary'),fontFamily:bf(style)}}>{config.ctaText}</button>}
          </div>
          {hasImage&&<div style={{animationName:'cf-scale-up',animationDuration:'800ms',animationDelay:'200ms',animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}><img src={config.image} alt="Our Story" className="w-full aspect-square object-cover shadow-2xl" style={{borderRadius:br(style,2)}}/></div>}
        </div>
      </div>
    </section>
  );
}

// ─── Instagram ────────────────────────────────────────────────────────────────
function InstagramSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  const uploaded:any[]=Array.isArray(config.images)?config.images:[];
  const cols=parseInt(config.columns)||4;
  const gridCls=cols===3?'grid-cols-3':cols===6?'grid-cols-3 md:grid-cols-6':'grid-cols-2 md:grid-cols-4';
  const shades=['10','14','18','12','16','1a'];
  return (
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12">
        <div className="space-y-3">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Follow Along'}</FieldTap>
          <FieldTap sectionId={sectionId} fieldKey="handle" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-400">{config.handle||'@studio'}</FieldTap>
        </div>
        <div className={`grid ${gridCls} gap-2`}>
          {(uploaded.length>0?uploaded.slice(0,8):shades).map((item:any,i:number)=>(
            <div key={i} className="aspect-square overflow-hidden group" style={{borderRadius:br(style),animationName:'cf-scale-up',animationDuration:'500ms',animationDelay:`${i*50}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}}>
              {typeof item==='string'?<div className="w-full h-full" style={{background:ac(style)+item}}/>:<img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>}
            </div>
          ))}
        </div>
        <a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{...btnStyle(style,'secondary'),fontFamily:bf(style)}}>
          <Instagram className="w-4 h-4"/>{config.ctaText||'Follow us on Instagram'}
        </a>
      </div>
    </section>
  );
}

// ─── Waitlist ─────────────────────────────────────────────────────────────────
function WaitlistSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps) {
  return (
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-lg mx-auto px-6 md:px-16 text-center space-y-8">
        <div className="space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Fully Booked?'}</FieldTap>
          {config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}
        </div>
        <div className="flex gap-2">
          <input type="email" placeholder="your@email.com" className="flex-1 px-4 py-3 text-sm focus:outline-none" style={{borderRadius:br(style),border:`2px solid ${ac(style)}40`,fontFamily:bf(style)}}/>
          <button className="px-6 py-3 font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Join'}</button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({tenant,style}:{tenant:any;style:StyleConfig}) {
  return (
    <footer className="py-8 border-t text-center" style={{borderColor:ac(style)+'20'}}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>{tenant?.name||'Studio'} · Powered by ClarityFlow</p>
    </footer>
  );
}

// ─── Section dispatcher ───────────────────────────────────────────────────────
function SectionRenderer(props:{section:PageSection;style:StyleConfig;data:PageData;isPreview:boolean;onFieldTap:(s:string,f:string)=>void}) {
  const {section,style,data,isPreview,onFieldTap}=props;
  const p:SectionProps={config:section.config,style,data,isPreview,sectionId:section.id,onFieldTap};
  switch(section.type){
    case 'nav':         return <NavSection         {...p}/>;
    case 'hero':        return <HeroSection        {...p}/>;
    case 'trust':       return <TrustSection       {...p}/>;
    case 'services':    return <ServicesSection    {...p}/>;
    case 'team':        return <TeamSection        {...p}/>;
    case 'reviews':     return <ReviewsSection     {...p}/>;
    case 'gallery':     return <GallerySection     {...p}/>;
    case 'beforeafter': return <BeforeAfterSection {...p}/>;
    case 'memberships': return <MembershipsSection {...p}/>;
    case 'packages':    return <PackagesSection    {...p}/>;
    case 'giftcards':   return <GiftCardsSection   {...p}/>;
    case 'quote':       return <QuoteSection       {...p}/>;
    case 'newclient':   return <NewClientSection   {...p}/>;
    case 'faq':         return <FAQSection         {...p}/>;
    case 'policies':    return <PoliciesSection    {...p}/>;
    case 'contact':     return <ContactSection     {...p}/>;
    case 'events':      return <EventsSection      {...p}/>;
    case 'referral':    return <ReferralSection    {...p}/>;
    case 'story':       return <StorySection       {...p}/>;
    case 'instagram':   return <InstagramSection   {...p}/>;
    case 'waitlist':    return <WaitlistSection    {...p}/>;
    default:            return null;
  }
}

const DEFAULT_STYLE:StyleConfig={accentColor:'#8b6914',bgColor:'#f8f4ef',headingFont:'cormorant',bodyFont:'space',borderRadius:8,buttonStyle:'filled',density:'balanced'};

// ─── Main ─────────────────────────────────────────────────────────────────────
function BookingPageContent({tenantId}:{tenantId:string}) {
  const [tenant,setTenant]=useState<any>(null);
  const [services,setServices]=useState<any[]>([]);
  const [staff,setStaff]=useState<any[]>([]);
  const [events,setEvents]=useState<any[]>([]);
  const [savedConfig,setSavedConfig]=useState<PageBuilderConfig|null>(null);
  const [liveConfig,setLiveConfig]=useState<{sections:PageSection[];style:any}|null>(null);
  const [isLoading,setIsLoading]=useState(true);

  const isPreview=typeof window!=='undefined'&&window!==window.parent;
  const getDb=useCallback(()=>{try{return getFirestore(getApp());}catch{return null;}},[]);

  // Bootstrap: inject CSS keyframes + signal parent iframe is ready
  useEffect(()=>{
    if(!document.getElementById('cf-anim')){
      const s=document.createElement('style');s.id='cf-anim';s.textContent=ANIM_CSS;
      document.head.appendChild(s);
    }
    if(isPreview) window.parent.postMessage({type:'BOOKING_READY'},'*');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(!tenantId){setIsLoading(false);return;}
    let cancelled=false;
    const run=async()=>{
      let db=getDb(),tries=0;
      while(!db&&tries<10){await new Promise(r=>setTimeout(r,500));db=getDb();tries++;}
      if(!db||cancelled){setIsLoading(false);return;}
      try{
        const tSnap=await getDoc(doc(db,'tenants',tenantId));
        if(!cancelled&&tSnap.exists()){
          const t={id:tSnap.id,...tSnap.data()} as any;
          setTenant(t);
          const pc=t?.bookingPageSettings?.pageConfig as PageBuilderConfig|undefined;
          if(pc?.sections?.length)setSavedConfig(pc);
        }
        const[svSnap,stSnap,evSnap]=await Promise.all([
          getDocs(collection(db,`tenants/${tenantId}/services`)),
          getDocs(collection(db,`tenants/${tenantId}/staff`)),
          getDocs(query(collection(db,`tenants/${tenantId}/studioEvents`),orderBy('date','asc'))).catch(()=>getDocs(collection(db,`tenants/${tenantId}/studioEvents`))),
        ]);
        if(!cancelled){
          setServices(svSnap.docs.map(d=>({id:d.id,...d.data()})).filter((s:any)=>s.isActive!==false));
          setStaff(stSnap.docs.map(d=>({id:d.id,...d.data()})).filter((s:any)=>s.isActive!==false));
          setEvents(evSnap.docs.map(d=>({id:d.id,...d.data()})));
        }
      }catch(e){console.warn('[booking]',e);}
      finally{if(!cancelled)setIsLoading(false);}
    };
    run();
    return()=>{cancelled=true;};
  },[tenantId,getDb]);

  // Receive live preview updates + click-to-edit messages from parent
  useEffect(()=>{
    const handler=(e:MessageEvent)=>{
      if(e.data?.type==='CLARITY_PREVIEW') setLiveConfig({sections:e.data.sections,style:e.data.style});
    };
    window.addEventListener('message',handler);
    return()=>window.removeEventListener('message',handler);
  },[]);

  // Send field-tap events up to the parent page builder
  const handleFieldTap=useCallback((sectionId:string,fieldKey:string)=>{
    if(isPreview) window.parent.postMessage({type:'EDIT_FIELD',sectionId,fieldKey},'*');
  },[isPreview]);

  // Send section-click events up to the parent page builder
  const handleEditSection=useCallback((sectionId:string)=>{
    if(isPreview) window.parent.postMessage({type:'EDIT_SECTION',sectionId},'*');
  },[isPreview]);

  const activeStyle:StyleConfig={
    accentColor:  liveConfig?.style?.accentColor  ??savedConfig?.accentColor  ??DEFAULT_STYLE.accentColor,
    bgColor:      liveConfig?.style?.bgColor      ??savedConfig?.bgColor      ??DEFAULT_STYLE.bgColor,
    headingFont:  liveConfig?.style?.headingFont  ??savedConfig?.headingFont  ??DEFAULT_STYLE.headingFont,
    bodyFont:     liveConfig?.style?.bodyFont     ??savedConfig?.bodyFont     ??DEFAULT_STYLE.bodyFont,
    borderRadius: liveConfig?.style?.borderRadius ??savedConfig?.borderRadius ??DEFAULT_STYLE.borderRadius,
    buttonStyle:  liveConfig?.style?.buttonStyle  ??savedConfig?.buttonStyle  ??DEFAULT_STYLE.buttonStyle,
    density:      liveConfig?.style?.density      ??savedConfig?.density      ??DEFAULT_STYLE.density,
  };

  const rawSections=liveConfig?.sections??savedConfig?.sections??buildDefaults();
  const activeSections=rawSections.filter(s=>s.enabled).sort((a,b)=>a.order-b.order);

  useEffect(()=>{injectFonts(activeStyle.headingFont,activeStyle.bodyFont);},[activeStyle.headingFont,activeStyle.bodyFont]);

  if(isLoading){
    return(
      <div className="min-h-screen flex items-center justify-center" style={{background:activeStyle.bgColor}}>
        <div className="text-center space-y-4">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{borderColor:activeStyle.accentColor}}/>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  const data:PageData={tenant,services,staff,events};

  return(
    <div style={{background:activeStyle.bgColor,fontFamily:bf(activeStyle)}} className="min-h-screen">
      {/* Preview hint */}
      {isPreview&&(
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 bg-slate-900/90 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-2xl backdrop-blur pointer-events-none select-none">
          Hover to select section · Tap text to edit field ✏️
        </div>
      )}

      {activeSections.map(section=>{
        // In preview: include animation config in key so React remounts the wrapper
        // when animation type/speed changes — this resets useInView and replays the animation
        const _a=(section.config as any)._animation;
        const wrapKey=isPreview?`${section.id}-${_a?.type||'fu'}-${_a?.speed||700}`:section.id;
        return(
        <SectionWrapper key={wrapKey} section={section} isPreview={isPreview} onEdit={handleEditSection} onFieldTap={handleFieldTap}>
          <SectionRenderer section={section} style={activeStyle} data={data} isPreview={isPreview} onFieldTap={handleFieldTap}/>
        </SectionWrapper>
        );
      })}

      <Footer tenant={tenant} style={activeStyle}/>
    </div>
  );
}

export default function BookingPage({params}:{params:{tenantId:string}}) {
  return <BookingPageContent tenantId={params.tenantId}/>;
}
