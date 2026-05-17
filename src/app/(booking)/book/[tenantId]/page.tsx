'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, getDoc, getDocs, addDoc, collection, query, orderBy, where } from 'firebase/firestore';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';
import { cn } from '@/lib/utils';
import {
  Calendar, Clock, MapPin, Phone, Mail, Instagram,
  ChevronDown, ChevronUp, Star, Gift, Sparkles, Pencil,
  ChevronLeft, ChevronRight, X as XIcon, ArrowRight,
} from 'lucide-react';
import { BookingSheet } from '@/components/booking/BookingSheet';

const ANIM_CSS = `
@keyframes cf-fade-up    { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
@keyframes cf-fade-in    { from{opacity:0} to{opacity:1} }
@keyframes cf-slide-left { from{opacity:0;transform:translateX(-28px)} to{opacity:1;transform:translateX(0)} }
@keyframes cf-slide-right{ from{opacity:0;transform:translateX(28px)} to{opacity:1;transform:translateX(0)} }
@keyframes cf-scale-up   { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
@keyframes cf-zoom-in    { from{opacity:0;transform:scale(1.08)} to{opacity:1;transform:scale(1)} }
@keyframes cf-marquee    { from{transform:translateX(0)} to{transform:translateX(-50%)} }
@keyframes cf-dialog-in  { from{opacity:0;transform:translateY(40px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
`;

const STACKS: Record<string,string> = {
  cormorant:"'Cormorant Garamond',Georgia,serif",playfair:"'Playfair Display',Georgia,serif",
  lora:"'Lora',Georgia,serif",merriweather:"'Merriweather',Georgia,serif",
  'eb-garamond':"'EB Garamond',Georgia,serif",'libre-bask':"'Libre Baskerville',Georgia,serif",
  'dm-serif':"'DM Serif Display',Georgia,serif",domine:"'Domine',Georgia,serif",
  space:"'Space Grotesk',system-ui,sans-serif",josefin:"'Josefin Sans',system-ui,sans-serif",
  raleway:"'Raleway',system-ui,sans-serif",montserrat:"'Montserrat',system-ui,sans-serif",
  nunito:"'Nunito',system-ui,sans-serif",poppins:"'Poppins',system-ui,sans-serif",
  outfit:"'Outfit',system-ui,sans-serif",'dm-sans':"'DM Sans',system-ui,sans-serif",
  inter:"'Inter',system-ui,sans-serif",figtree:"'Figtree',system-ui,sans-serif",
  bebas:"'Bebas Neue',Impact,sans-serif",oswald:"'Oswald',system-ui,sans-serif",
  anton:"'Anton',Impact,sans-serif",righteous:"'Righteous',system-ui,sans-serif",
  abril:"'Abril Fatface',Georgia,serif",pacifico:"'Pacifico',cursive",
  dancing:"'Dancing Script',cursive",'great-vibes':"'Great Vibes',cursive",
  georgia:'Georgia,serif',system:'system-ui,sans-serif',
};
const GFONTS: Record<string,string> = {
  cormorant:'Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400',
  playfair:'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400',
  lora:'Lora:ital,wght@0,400;0,600;0,700;1,400',merriweather:'Merriweather:wght@300;400;700',
  'eb-garamond':'EB+Garamond:wght@400;600','libre-bask':'Libre+Baskerville:wght@400;700',
  'dm-serif':'DM+Serif+Display',domine:'Domine:wght@400;700',
  space:'Space+Grotesk:wght@300;400;500;600;700',josefin:'Josefin+Sans:wght@300;400;600;700',
  raleway:'Raleway:wght@300;400;500;600;700',montserrat:'Montserrat:wght@300;400;500;600;700',
  nunito:'Nunito:wght@300;400;600;700',poppins:'Poppins:wght@300;400;500;600;700',
  outfit:'Outfit:wght@300;400;500;600;700','dm-sans':'DM+Sans:wght@300;400;500;700',
  inter:'Inter:wght@300;400;500;700',figtree:'Figtree:wght@300;400;500;700',
  bebas:'Bebas+Neue',oswald:'Oswald:wght@300;400;500;600',
  anton:'Anton',righteous:'Righteous',abril:'Abril+Fatface',
  pacifico:'Pacifico',dancing:'Dancing+Script:wght@400;600;700','great-vibes':'Great+Vibes',
};
function injectFonts(h:string,b:string){
  if(typeof document==='undefined')return;
  const ids=Array.from(new Set([h,b])).filter(f=>GFONTS[f]);
  if(!ids.length)return;
  document.getElementById('cf-gfonts')?.remove();
  const link=document.createElement('link');
  link.id='cf-gfonts';link.rel='stylesheet';
  link.href=`https://fonts.googleapis.com/css2?${ids.map(id=>`family=${GFONTS[id]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

interface StyleConfig{accentColor:string;bgColor:string;headingFont:string;bodyFont:string;borderRadius:number;buttonStyle:string;density:string;}
interface SectionProps{config:Record<string,any>;style:StyleConfig;data:PageData;isPreview:boolean;sectionId:string;onFieldTap?:(s:string,f:string)=>void;}
interface PageData{tenant:any;services:any[];staff:any[];events:any[];tenantId:string;}

const DS:StyleConfig={accentColor:'#8b6914',bgColor:'#f8f4ef',headingFont:'cormorant',bodyFont:'space',borderRadius:8,buttonStyle:'filled',density:'balanced'};

const ac=(s:StyleConfig)=>s.accentColor||'#8b6914';
const hf=(s:StyleConfig)=>STACKS[s.headingFont]||STACKS.cormorant;
const bf=(s:StyleConfig)=>STACKS[s.bodyFont]||STACKS.space;
const br=(s:StyleConfig,x=1)=>`${(s.borderRadius||8)*x}px`;
const py=(s:StyleConfig)=>s.density==='compact'?'py-14 md:py-20':s.density==='airy'?'py-32 md:py-44':'py-24 md:py-32';

function btnStyle(s:StyleConfig,v:'primary'|'secondary'='primary'){
  const r=s.buttonStyle==='pill'?'999px':br(s,0.6);
  return v==='primary'
    ?{background:s.buttonStyle==='outline'||s.buttonStyle==='ghost'?'transparent':ac(s),color:s.buttonStyle==='outline'||s.buttonStyle==='ghost'?ac(s):'white',border:s.buttonStyle==='ghost'?'none':`2px solid ${ac(s)}`,borderRadius:r}
    :{background:'transparent',color:ac(s),border:`2px solid ${ac(s)}`,borderRadius:r};
}

function hexToHsl(hex:string):string{
  let r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
  if(hex.length<7){r=parseInt(hex[1]+hex[1],16)/255;g=parseInt(hex[2]+hex[2],16)/255;b=parseInt(hex[3]+hex[3],16)/255;}
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  let h=0,s=0,l=(max+min)/2;
  if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}
  return`${Math.round(h*360)} ${Math.round(s*100)}% ${Math.round(l*100)}%`;
}

function openBooking(service?:any){
  window.dispatchEvent(new CustomEvent('cf-book',{detail:{service:service||null}}));
}
function cta(action?:string,url?:string){
  return(e:React.MouseEvent)=>{
    e.stopPropagation();
    if(action==='booking'){openBooking();return;}
    if(action==='url'&&url){window.open(url,'_blank');return;}
    const go=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
    if(action==='scroll-services'){go('services');return;}
    if(action==='scroll-contact'){go('contact');return;}
    if(action==='scroll-team'){go('team');return;}
    go('contact');
  };
}

const ANIM_MAP:Record<string,string>={
  'fade-up':'cf-fade-up','fade-in':'cf-fade-in','slide-left':'cf-slide-left',
  'slide-right':'cf-slide-right','scale-up':'cf-scale-up','zoom-in':'cf-zoom-in','none':'',
};

function useInView(t=0.1){
  const ref=useRef<HTMLDivElement>(null);
  const[v,setV]=useState(false);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    const obs=new IntersectionObserver(([e])=>{if(e.isIntersecting){setV(true);obs.disconnect();}},{threshold:t});
    obs.observe(el);return()=>obs.disconnect();
  },[t]);
  return{ref,visible:v};
}

function FieldTap({sectionId,fieldKey,isPreview,onFieldTap,as='span',children,style,className}:{
  sectionId:string;fieldKey:string;isPreview:boolean;onFieldTap?:(s:string,f:string)=>void;
  as?:'span'|'div'|'h1'|'h2'|'h3'|'p';children:React.ReactNode;style?:React.CSSProperties;className?:string;
}){
  const[hov,setHov]=useState(false);
  const Tag=as as any;
  const ts:React.CSSProperties=isPreview?{...style,cursor:'pointer',outline:hov?'2px solid rgba(99,102,241,0.8)':'2px solid transparent',outlineOffset:'2px',borderRadius:'3px',transition:'outline-color 0.15s'}:style||{};
  return<Tag style={ts} className={className} onMouseEnter={()=>isPreview&&setHov(true)} onMouseLeave={()=>isPreview&&setHov(false)} onClick={isPreview?(e:any)=>{e.stopPropagation();onFieldTap?.(sectionId,fieldKey);}:undefined}>{children}</Tag>;
}

function EO({onClick,label='Edit section'}:{onClick:()=>void;label?:string}){
  return<div className="absolute inset-0 z-50 cursor-pointer" onClick={onClick}><div className="absolute inset-0 pointer-events-none" style={{boxShadow:'inset 0 0 0 2.5px rgba(99,102,241,0.7)',borderRadius:'2px'}}/><div className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-white text-[10px] font-black uppercase tracking-widest shadow-xl" style={{background:'#6366f1',borderRadius:'8px'}}><Pencil className="w-3 h-3"/>{label}</div></div>;
}

function SectionWrapper({section,isPreview,onEdit,onFieldTap,children}:{section:PageSection;isPreview:boolean;onEdit:(id:string)=>void;onFieldTap:(s:string,f:string)=>void;children:React.ReactNode;}){
  const{ref,visible}=useInView();
  const[hov,setHov]=useState(false);
  const a=(section.config as any)._animation||{};
  const animName=ANIM_MAP[a.type||'fade-up']||'cf-fade-up';
  const animSpeed=a.speed||700;
  if(section.type==='nav')return<div className="relative" onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>{children}{isPreview&&hov&&<EO onClick={()=>onEdit(section.id)} label="Edit nav"/>}</div>;
  if((a.type||'fade-up')==='none')return<div className="relative" onMouseEnter={()=>isPreview&&setHov(true)} onMouseLeave={()=>isPreview&&setHov(false)}>{children}{isPreview&&hov&&<EO onClick={()=>onEdit(section.id)}/>}</div>;
  return<div ref={ref} className="relative" style={visible?{animationName:animName,animationDuration:`${animSpeed}ms`,animationFillMode:'both',animationTimingFunction:'cubic-bezier(0.16,1,0.3,1)'}:{opacity:0}} onMouseEnter={()=>isPreview&&setHov(true)} onMouseLeave={()=>isPreview&&setHov(false)}>{children}{isPreview&&hov&&<EO onClick={()=>onEdit(section.id)}/>}</div>;
}

// ─── Valid section types guard ─────────────────────────────────────────────────
const VALID_SECTION_TYPES=new Set(['nav','hero','trust','services','team','reviews','gallery','beforeafter','memberships','packages','giftcards','quote','newclient','faq','policies','contact','events','referral','story','instagram','waitlist']);
function isBuilderConfig(pc:any):boolean{
  if(!pc?.sections?.length) return false;
  return (pc.sections as any[]).every(s=>typeof s?.type==='string'&&VALID_SECTION_TYPES.has(s.type)&&typeof s?.id==='string');
}

// ─── Defaults (used only when no saved config exists at all) ──────────────────
function buildDefaults():PageSection[]{
  return[
    {id:'nav',type:'nav',enabled:true,order:0,config:{logoText:'Studio',ctaText:'Book Now',showLinks:true,sticky:true,layout:'centered',ctaAction:'booking'}},
    {id:'hero',type:'hero',enabled:true,order:1,config:{headline:'Book Your Experience',subheadline:'A sanctuary of craft, curated for those who appreciate the details.',ctaText:'Book a Session',showWalkIn:true,cta2Text:'Walk In Today',layout:'centered',overlayOpacity:40,ctaAction:'booking',cta2Action:'scroll-contact'}},
    {id:'services',type:'services',enabled:true,order:2,config:{heading:'Our Services',subheading:'Handcrafted treatments for every occasion',ctaText:'Book this service',columns:'2',showPrices:true,showDuration:true,showDesc:true,layout:'cards',ctaAction:'booking'}},
    {id:'team',type:'team',enabled:true,order:3,config:{heading:'The Artists',subheading:'Expert hands for every style',showSpecialties:true,layout:'circles'}},
    {id:'quote',type:'quote',enabled:true,order:4,config:{heading:'Need Something Bigger?',subheading:'Planning a wedding, bridal party, or corporate event?',ctaText:'Request a Quote',tags:['Bridal Parties','Corporate Events','Destination Services'],layout:'centered',ctaAction:'scroll-contact'}},
    {id:'contact',type:'contact',enabled:true,order:5,config:{heading:'Find Us',showMap:true,showHours:true,showPhone:true,showSocial:true,ctaText:'Book an Appointment',layout:'split-map',ctaAction:'booking'}},
  ];
}

// ─── Section components ────────────────────────────────────────────────────────

function NavSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const layout=config.layout||'centered',isMinimal=layout==='minimal';
  return(
    <nav className={cn('z-50 flex items-center justify-between px-6 md:px-14 py-4 border-b',config.sticky!==false&&'sticky top-0',config.transparent?'bg-transparent border-transparent':'bg-white/95 backdrop-blur-xl')}
         style={{borderColor:config.transparent?'transparent':ac(style)+'22'}}>
      <div className="flex items-center gap-3">
        {config.logoUrl?<img src={config.logoUrl} alt="Logo" className="h-9 w-auto object-contain"/>
          :<FieldTap sectionId={sectionId} fieldKey="logoText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"
              style={{fontFamily:hf(style),color:ac(style),fontSize:'20px',fontWeight:'bold',letterSpacing:'-0.05em'}}>
            {config.logoText||'Studio'}
          </FieldTap>}
      </div>
      {!isMinimal&&config.showLinks!==false&&(
        <div className="hidden md:flex items-center gap-8">
          {['Services','Team','Contact'].map(l=><a key={l} href={`#${l.toLowerCase()}`} className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors" style={{fontFamily:bf(style)}}>{l}</a>)}
        </div>
      )}
      <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
        <button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-6 py-2.5 text-[11px] font-black uppercase tracking-widest shadow-lg hover:opacity-90 transition-all active:scale-95" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book Now'}</button>
      </FieldTap>
    </nav>
  );
}

function HeroSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const layout=config.layout||'centered';
  const isSplit=layout==='split'||layout==='magazine';
  const isFullbleed=layout==='fullbleed'||layout==='cinematic';
  const isMinimal=layout==='minimal';
  const hasBg=!!config.bgImage,hasVideo=!!config.videoUrl;
  const opacity=(config.overlayOpacity??40)/100;
  const tc=(hasBg||hasVideo)&&!isMinimal?'white':'#0f172a';
  const sc=(hasBg||hasVideo)&&!isMinimal?'rgba(255,255,255,0.75)':'#64748b';
  const Headline=()=>(
    <FieldTap sectionId={sectionId} fieldKey="headline" isPreview={isPreview} onFieldTap={onFieldTap}
      as="h1" className={cn(isSplit?'text-5xl md:text-7xl':'text-6xl md:text-8xl','leading-[0.95] font-light')}
      style={{fontFamily:hf(style),color:tc}}>
      {config.headline||'Book Your Experience'}
    </FieldTap>
  );
  const Sub=()=>(
    <FieldTap sectionId={sectionId} fieldKey="subheadline" isPreview={isPreview} onFieldTap={onFieldTap}
      as="p" className={cn(isSplit?'text-lg max-w-md':'text-xl max-w-2xl mx-auto','leading-relaxed')}
      style={{fontFamily:bf(style),color:sc}}>
      {config.subheadline}
    </FieldTap>
  );
  const Btns=()=>(
    <div className={cn('flex flex-wrap gap-4',!isSplit&&'justify-center')}>
      <FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
        <button onClick={cta(config.ctaAction,config.ctaUrl)} className={cn(isSplit?'px-9 py-4':'px-12 py-4','font-bold shadow-2xl hover:opacity-90 hover:scale-[1.02] transition-all')} style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book a Session'}</button>
      </FieldTap>
      {config.showWalkIn!==false&&<FieldTap sectionId={sectionId} fieldKey="cta2Text" isPreview={isPreview} onFieldTap={onFieldTap} as="span">
        <button onClick={cta(config.cta2Action,config.ctaUrl)} className={cn(isSplit?'px-9 py-4':'px-12 py-4','font-bold hover:opacity-80 transition-all')} style={{...btnStyle(style,'secondary'),borderColor:(hasBg||hasVideo)?'white':ac(style),color:(hasBg||hasVideo)?'white':ac(style),fontFamily:bf(style)}}>{config.cta2Text||'Walk In'}</button>
      </FieldTap>}
    </div>
  );
  return(
    <section className="relative flex items-center overflow-hidden" style={{minHeight:isFullbleed?'100vh':'82vh',background:hasBg&&!isMinimal?`url(${config.bgImage}) center/cover no-repeat`:isMinimal?'#ffffff':style.bgColor}}>
      {hasVideo&&!isMinimal&&<video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src={config.videoUrl}/></video>}
      {(hasBg||hasVideo)&&!isMinimal&&<div className="absolute inset-0" style={{background:`rgba(0,0,0,${opacity})`}}/>}
      {config.showBadge&&config.badgeText&&<FieldTap sectionId={sectionId} fieldKey="badgeText" isPreview={isPreview} onFieldTap={onFieldTap} as="div" className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 border border-white/30 bg-white/10 backdrop-blur text-white text-[10px] font-black uppercase tracking-widest rounded-full">{config.badgeText}</FieldTap>}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-16 py-24">
        {isSplit?(
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="space-y-8"><Headline/><Sub/><Btns/></div>
            <div>
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

function TrustSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const stats=[{v:config.stat1v,l:config.stat1l},{v:config.stat2v,l:config.stat2l},{v:config.stat3v,l:config.stat3l},{v:config.stat4v,l:config.stat4l}].filter(s=>s.v);
  const layout=config.layout||'strip',showDiv=config.showDividers!==false;
  const SV=({s,i,dark=false}:{s:{v:string;l:string};i:number;dark?:boolean})=>(
    <div className={cn('space-y-1 py-2 text-center',showDiv&&i<stats.length-1&&(dark?'border-r border-white/10':'border-r border-slate-100'))}>
      <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}v`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:dark?'white':ac(style)}}>{s.v}</FieldTap>
      <FieldTap sectionId={sectionId} fieldKey={`stat${i+1}l`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-[10px] font-black uppercase tracking-widest" style={{color:dark?ac(style)+'cc':'#94a3b8',fontFamily:bf(style)}}>{s.l}</FieldTap>
    </div>
  );
  if(layout==='banner')return<section className="py-12" style={{background:'#0f172a'}}><div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">{stats.map((s,i)=><SV key={i} s={s} i={i} dark/>)}</div></section>;
  if(layout==='cards')return<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-4">{stats.map((s,i)=><div key={i} className="p-6 bg-white text-center space-y-2 shadow-sm" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}18`}}><FieldTap sectionId={sectionId} fieldKey={`stat${i+1}v`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-4xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{s.v}</FieldTap><FieldTap sectionId={sectionId} fieldKey={`stat${i+1}l`} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>{s.l}</FieldTap></div>)}</div></section>;
  if(layout==='ticker')return<section className="py-4 border-y overflow-hidden" style={{borderColor:ac(style)+'20'}}><div className="flex" style={{animation:'cf-marquee 20s linear infinite',width:'max-content'}}>{[...stats,...stats,...stats,...stats].map((s,i)=><div key={i} className="flex items-center gap-2 px-8 shrink-0"><span className="text-2xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{s.v}</span><span className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>{s.l}</span><span className="w-1 h-1 rounded-full ml-4" style={{background:ac(style)+'40'}}/></div>)}</div></section>;
  return<section className="py-14 border-y" style={{borderColor:ac(style)+'20'}}><div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">{stats.map((s,i)=><SV key={i} s={s} i={i}/>)}</div></section>;
}

function ServicesSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps){
  const services=data.services,layout=config.layout||'cards';
  const cols=parseInt(config.columns)||2;
  const gridCls=cols===1?'grid-cols-1 max-w-lg mx-auto':cols===3?'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3':'grid-cols-1 sm:grid-cols-2';
  return(
    <section id="services" className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Services'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        {services.length>0?(
          layout==='list'?(
            <div className="space-y-3 max-w-3xl mx-auto">
              {services.map((svc:any,i:number)=>(
                <div key={svc.id} className="flex items-center gap-5 p-5 bg-white hover:shadow-md transition-all" style={{borderRadius:br(style),border:`2px solid ${ac(style)}20`}}>
                  {config.showImages&&svc.imageUrl&&<img src={svc.imageUrl} alt={svc.name} className="w-16 h-16 object-cover shrink-0" style={{borderRadius:br(style)}}/>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 truncate" style={{fontFamily:bf(style)}}>{svc.name}</h3>
                      {config.showPrices!==false&&svc.price&&<span className="text-base font-black shrink-0" style={{color:ac(style)}}>${svc.price}</span>}
                    </div>
                    {config.showDesc!==false&&svc.description&&<p className="text-xs text-slate-400 leading-relaxed line-clamp-2" style={{fontFamily:bf(style)}}>{svc.description}</p>}
                    {config.showDuration!==false&&svc.duration&&<p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mt-1">{svc.duration} min</p>}
                  </div>
                  <button onClick={(e)=>{e.stopPropagation();openBooking(svc);}} className="shrink-0 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book'}</button>
                </div>
              ))}
            </div>
          ):(
            <div className={`grid gap-5 ${gridCls}`}>
              {services.map((svc:any,i:number)=>(
                <div key={svc.id} className={cn('group p-7 bg-white transition-all duration-300',config.hoverEffect!==false&&'hover:shadow-xl hover:-translate-y-1')} style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}25`}}>
                  {config.showImages&&svc.imageUrl&&<img src={svc.imageUrl} alt={svc.name} className="w-full aspect-video object-cover mb-4 group-hover:scale-[1.02] transition-transform duration-500" style={{borderRadius:br(style)}}/>}
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-sm font-black uppercase tracking-tight text-slate-900" style={{fontFamily:bf(style)}}>{svc.name}</h3>
                    {config.showPrices!==false&&svc.price&&<span className="text-base font-black ml-3 shrink-0" style={{color:ac(style)}}>${svc.price}</span>}
                  </div>
                  {config.showDesc!==false&&svc.description&&<p className="text-sm text-slate-500 leading-relaxed mb-4" style={{fontFamily:bf(style)}}>{svc.description}</p>}
                  {config.showDuration!==false&&svc.duration&&<div className="flex items-center gap-1.5 mb-5"><Clock className="w-3 h-3" style={{color:ac(style)}}/><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{svc.duration} min</p></div>}
                  <button onClick={(e)=>{e.stopPropagation();openBooking(svc);}} className="w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Book Now'}</button>
                </div>
              ))}
            </div>
          )
        ):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Services coming soon</p>}
      </div>
    </section>
  );
}

function TeamSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps){
  const staff=data.staff,layout=config.layout||'circles';
  const Av=({m,sz=112}:{m:any;sz?:number})=>(
    <div className="relative overflow-hidden" style={{width:sz,height:sz,background:ac(style)+'15',borderRadius:br(style,1.5),flexShrink:0}}>
      {m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>:<span className="absolute inset-0 flex items-center justify-center font-light" style={{fontFamily:hf(style),color:ac(style),fontSize:sz*0.4}}>{m.name?.[0]}</span>}
    </div>
  );
  return(
    <section id="team" className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'The Artists'}</FieldTap>
          {config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}
        </div>
        {staff.length>0?(
          layout==='row'?(<div className="flex gap-6 overflow-x-auto pb-4 snap-x" style={{scrollbarWidth:'none'}}>{staff.map((m:any,i:number)=><div key={m.id} className="text-center space-y-3 shrink-0 snap-start group" style={{width:'160px'}}><div className="mx-auto w-24 h-24 overflow-hidden shadow-lg group-hover:scale-105 transition-all duration-500" style={{background:ac(style)+'15',borderRadius:br(style,1.5)}}><Av m={m} sz={96}/></div><p className="text-[11px] font-black uppercase tracking-widest text-slate-900 truncate" style={{fontFamily:bf(style)}}>{m.name}</p>{config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[9px] text-slate-400 uppercase tracking-wider">{m.specialties[0]}</p>}{config.showBookButton&&<button onClick={(e)=>{e.stopPropagation();openBooking();}} className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}</div>)}</div>):
          layout==='editorial'?(<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{staff.map((m:any,i:number)=><div key={m.id} className="group overflow-hidden bg-white hover:shadow-xl transition-all duration-300" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}18`}}><div className="relative aspect-[4/3] overflow-hidden" style={{background:ac(style)+'12'}}>{m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>:<span className="absolute inset-0 flex items-center justify-center text-5xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{m.name?.[0]}</span>}</div><div className="p-5 space-y-2"><p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{fontFamily:bf(style)}}>{m.name}</p>{config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[10px] uppercase tracking-wider text-slate-400">{m.specialties.slice(0,2).join(' · ')}</p>}{config.showBio&&m.bio&&<p className="text-xs text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{m.bio}</p>}{config.showBookButton&&<button onClick={(e)=>{e.stopPropagation();openBooking();}} className="w-full mt-2 py-2.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}</div></div>)}</div>):
          layout==='minimal'?(<div className="max-w-lg mx-auto space-y-3">{staff.map((m:any,i:number)=><div key={m.id} className="flex items-center gap-4 py-3 border-b" style={{borderColor:ac(style)+'18'}}><div className="w-10 h-10 rounded-full overflow-hidden shrink-0" style={{background:ac(style)+'15'}}>{m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>:<span className="w-full h-full flex items-center justify-center text-sm font-light" style={{fontFamily:hf(style),color:ac(style)}}>{m.name?.[0]}</span>}</div><div className="flex-1"><p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{fontFamily:bf(style)}}>{m.name}</p>{config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[10px] text-slate-400 uppercase tracking-wider">{m.specialties.slice(0,2).join(' · ')}</p>}</div>{config.showBookButton&&<button onClick={(e)=>{e.stopPropagation();openBooking();}} className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}</div>)}</div>):
          (<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">{staff.map((m:any,i:number)=><div key={m.id} className="text-center space-y-4 group"><div className="relative mx-auto w-28 h-28 overflow-hidden shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-500" style={{background:ac(style)+'15',borderRadius:br(style,1.5)}}>{m.avatarUrl?<img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover"/>:<span className="absolute inset-0 flex items-center justify-center text-3xl font-light" style={{fontFamily:hf(style),color:ac(style)}}>{m.name?.[0]}</span>}</div><div><p className="text-[11px] font-black uppercase tracking-widest text-slate-900" style={{fontFamily:bf(style)}}>{m.name}</p>{config.showSpecialties!==false&&m.specialties?.length>0&&<p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{m.specialties.slice(0,2).join(' · ')}</p>}{config.showBio&&m.bio&&<p className="text-xs text-slate-500 mt-2 leading-relaxed" style={{fontFamily:bf(style)}}>{m.bio}</p>}{config.showBookButton&&<button onClick={(e)=>{e.stopPropagation();openBooking();}} className="mt-3 px-5 py-1.5 text-[10px] font-black uppercase tracking-widest hover:opacity-90" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.bookCta||'Book'}</button>}</div></div>)}</div>)
        ):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-20">Team coming soon</p>}
      </div>
    </section>
  );
}

function ReviewsSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const[idx,setIdx]=useState(0);
  const layout=config.layout||'grid';
  const reviews=[1,2,3,4,5,6].map(n=>({
    name:config[`rev${n}Name`]||['Sarah M.','Jessica T.','Priya K.','Amara B.','Lena S.','Chloe W.'][n-1]||'',
    rating:config[`rev${n}Rating`]??5,
    text:config[`rev${n}Text`]||['Absolutely incredible experience. The attention to detail is unmatched.','I\'ve been coming here over a year and every visit exceeds expectations.','The atmosphere is luxurious yet so welcoming. I always feel like a VIP.','Cannot recommend enough. Talented, professional, truly exceptional.','A gem of a studio. Every appointment is a joy.','So glad I found this place. Creative, professional, always on time.'][n-1]||'',
    photo:config[`rev${n}Photo`]||'',
  })).filter(r=>r.name&&r.text);
  const Stars=({n}:{n:number})=><div className="flex gap-0.5">{Array(Math.max(1,Math.min(5,n))).fill(0).map((_,j)=><Star key={j} className="w-3.5 h-3.5 fill-current" style={{color:ac(style)}}/>)}</div>;
  const Card=({r}:{r:typeof reviews[0]})=>(
    <div className="p-8 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}20`}}>
      {config.showRating!==false&&<div className="mb-4"><Stars n={r.rating}/></div>}
      {r.photo&&config.showPhotos&&<img src={r.photo} alt={r.name} className="w-10 h-10 rounded-full object-cover mb-4"/>}
      <p className="text-sm leading-relaxed text-slate-600 italic mb-4">"{r.text}"</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>— {r.name}</p>
    </div>
  );
  if(layout==='quotes'){
    const r=reviews[idx%Math.max(1,reviews.length)];
    return(
      <section className={py(style)} style={{background:style.bgColor}}>
        <div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-10">
          <FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'What Clients Say'}</FieldTap>
          {r&&<div className="space-y-8">
            {config.showRating!==false&&<div className="flex justify-center"><Stars n={r.rating}/></div>}
            <p className="text-2xl md:text-3xl font-light italic leading-relaxed text-slate-700" style={{fontFamily:hf(style)}}>"{r.text}"</p>
            <div className="flex items-center justify-center gap-4">{r.photo&&<img src={r.photo} alt={r.name} className="w-10 h-10 rounded-full object-cover"/>}<p className="text-[11px] font-black uppercase tracking-widest text-slate-400">— {r.name}</p></div>
            {reviews.length>1&&<div className="flex items-center justify-center gap-3">
              <button onClick={()=>setIdx(i=>(i-1+reviews.length)%reviews.length)} className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all" style={{borderColor:ac(style)+'30'}}><ChevronLeft className="w-4 h-4"/></button>
              {reviews.map((_,i)=><div key={i} className="w-2 h-2 rounded-full transition-all cursor-pointer" style={{background:i===idx%reviews.length?ac(style):'#cbd5e1'}} onClick={()=>setIdx(i)}/>)}
              <button onClick={()=>setIdx(i=>(i+1)%reviews.length)} className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all" style={{borderColor:ac(style)+'30'}}><ChevronRight className="w-4 h-4"/></button>
            </div>}
          </div>}
        </div>
      </section>
    );
  }
  if(layout==='carousel')return(
    <section className={py(style)} style={{background:'#f8fafc'}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'What Clients Say'}</FieldTap></div>
        <div className="flex gap-6 overflow-x-auto pb-4 snap-x" style={{scrollbarWidth:'none'}}>{reviews.map((r,i)=><div key={i} className="shrink-0 snap-start w-[320px]"><Card r={r}/></div>)}</div>
      </div>
    </section>
  );
  return(
    <section className={py(style)} style={{background:style.bgColor}}>
      <div className="max-w-6xl mx-auto px-6 md:px-16">
        <div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'What Clients Say'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</p>}</div>
        <div className="grid md:grid-cols-3 gap-6">{reviews.slice(0,6).map((r,i)=><Card key={i} r={r}/>)}</div>
      </div>
    </section>
  );
}

function GallerySection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const[lb,setLb]=useState<string|null>(null);
  const uploaded:any[]=Array.isArray(config.images)?config.images:[];
  const layout=config.layout||'grid',cols=parseInt(config.columns)||3;
  const gridCls=cols===2?'grid-cols-2':cols===4?'grid-cols-2 md:grid-cols-4':'grid-cols-2 md:grid-cols-3';
  const shades=['08','10','14','18','12','16','0a','16','20','12'];
  const imgs=uploaded.length>0?uploaded:shades.map((s,i)=>({id:i,url:null,caption:'',shade:s}));
  const hCls=config.hoverEffect==='fade'?'group-hover:opacity-60 transition-opacity duration-500':config.hoverEffect==='none'?'':'group-hover:scale-110 transition-transform duration-700';
  const H=()=><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Work'}</FieldTap>{config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}</div>;
  const Lb=()=>lb?(<div className="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center p-4" onClick={()=>setLb(null)}><button className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"><XIcon className="w-8 h-8"/></button><img src={lb} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={e=>e.stopPropagation()}/></div>):null;
  if(layout==='carousel')return(<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-6xl mx-auto px-6 md:px-16"><H/><div className="flex gap-4 overflow-x-auto pb-4 snap-x" style={{scrollbarWidth:'none'}}>{imgs.map((img:any,i:number)=><div key={i} className="shrink-0 snap-start overflow-hidden group cursor-pointer" style={{width:'280px',height:'350px',borderRadius:br(style)}} onClick={()=>img.url&&config.lightbox!==false&&setLb(img.url)}>{img.url?<img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/>:<div className="w-full h-full" style={{background:ac(style)+img.shade}}/>}</div>)}</div></div><Lb/></section>);
  return(<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-6xl mx-auto px-6 md:px-16"><H/><div className={`grid ${gridCls} gap-3`}>{imgs.map((img:any,i:number)=><div key={img.id??i} className={cn('overflow-hidden group cursor-pointer',layout==='masonry'&&(i===0||i===5)?'row-span-2':'','aspect-square')} style={{borderRadius:br(style)}} onClick={()=>img.url&&config.lightbox!==false&&setLb(img.url)}>{img.url?(<div className="relative h-full"><img src={img.url} alt={img.caption||''} className={`w-full h-full object-cover ${hCls}`}/>{config.showCaptions&&img.caption&&<div className="absolute bottom-0 inset-x-0 px-3 py-2 bg-black/50 text-white text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{img.caption}</div>}</div>):<div className="w-full h-full" style={{background:ac(style)+img.shade}}/>}</div>)}</div></div><Lb/></section>);
}

function BeforeAfterSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const pairs:any[]=Array.isArray(config.pairs)?config.pairs:[],showLabels=config.showLabels!==false,items=pairs.length>0?pairs:[0,1];
  return(<section className={py(style)} style={{background:style.bgColor}}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Transformations'}</FieldTap>{config.subheading&&<FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>}</div><div className="grid md:grid-cols-2 gap-8">{items.map((item:any,i:number)=>{const p=typeof item==='object'&&item?.beforeUrl!==undefined;return(<div key={i} className="space-y-3"><div className="grid grid-cols-2 gap-2">{[{label:'Before',url:p?item.beforeUrl:null,shade:'12'},{label:'After',url:p?item.afterUrl:null,shade:'28'}].map((side,j)=><div key={j} className="relative overflow-hidden aspect-square group" style={{borderRadius:br(style)}}>{side.url?<img src={side.url} alt={side.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>:<div className="w-full h-full flex items-center justify-center" style={{background:ac(style)+side.shade}}>{showLabels&&<span className="text-[10px] font-black uppercase tracking-widest" style={{color:ac(style)+(j===0?'80':'cc')}}>{side.label}</span>}</div>}{side.url&&showLabels&&<div className="absolute bottom-2 left-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white" style={{background:j===0?'rgba(0,0,0,0.5)':ac(style)+'cc',borderRadius:'4px'}}>{side.label}</div>}</div>)}</div>{p&&item.caption&&<p className="text-xs text-slate-400 text-center font-bold uppercase tracking-widest">{item.caption}</p>}</div>);})}</div></div></section>);
}

function MembershipsSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const plans=[1,2,3].map(n=>({
    name:config[`plan${n}Name`]||['Essential','Luxe','Elite'][n-1],
    price:config[`plan${n}Price`]||['$89','$149','$249'][n-1],
    period:config[`plan${n}Period`]||'/mo',
    features:(config[`plan${n}Features`]||['2 services/month\nPriority booking\n10% off retail','4 services/month\nVIP priority\n20% off retail\nFree upgrades','Unlimited services\nDedicated artist\n30% off retail\nExclusive events'][n-1]).split('\n').filter(Boolean),
    featured:n===2?(config.plan2Featured!==undefined?config.plan2Featured:true):false,
  }));
  return(<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Join the Club'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}</div><div className="grid md:grid-cols-3 gap-6 items-center">{plans.map((plan,i)=><div key={i} className={cn('p-8 space-y-6 hover:shadow-2xl transition-all',plan.featured&&'md:scale-105')} style={{borderRadius:br(style,1.5),border:`2px solid ${plan.featured?ac(style):ac(style)+'25'}`,background:plan.featured?ac(style):'white'}}><div><p className="text-[10px] font-black uppercase tracking-widest" style={{color:plan.featured?'rgba(255,255,255,0.65)':ac(style)}}>{plan.name}</p>{config.showBadge&&plan.featured&&<span className="inline-block mt-1 px-2 py-0.5 text-[8px] font-black uppercase text-white bg-white/20 rounded">Most Popular</span>}<div className="flex items-end gap-1 mt-2"><span className="text-4xl font-light" style={{fontFamily:hf(style),color:plan.featured?'white':'#0f172a'}}>{plan.price}</span><span className="text-sm mb-1" style={{color:plan.featured?'rgba(255,255,255,0.5)':'#94a3b8',fontFamily:bf(style)}}>{plan.period}</span></div></div><ul className="space-y-2.5">{plan.features.map((f:string,j:number)=><li key={j} className="flex items-center gap-2.5 text-sm" style={{fontFamily:bf(style),color:plan.featured?'rgba(255,255,255,0.8)':'#64748b'}}><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:plan.featured?'rgba(255,255,255,0.6)':ac(style)}}/>{f}</li>)}</ul><button onClick={cta(config.ctaAction,config.ctaUrl)} className="w-full py-3.5 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{background:plan.featured?'white':ac(style),color:plan.featured?ac(style):'white',borderRadius:br(style),fontFamily:bf(style)}}>{config.ctaText||'Join Now'}</button></div>)}</div></div></section>);
}

function PackagesSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const pkgs=[1,2,3].map(n=>({name:config[`pkg${n}Name`]||['5-Pack','10-Pack','20-Pack'][n-1],sessions:config[`pkg${n}Sessions`]||[5,10,20][n-1],price:config[`pkg${n}Price`]||['$199','$349','$599'][n-1],saving:config[`pkg${n}Saving`]||['Save 15%','Save 25%','Save 35%'][n-1]}));
  return(<section className={py(style)} style={{background:style.bgColor}}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Prepaid Sessions'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}</div><div className="grid md:grid-cols-3 gap-6">{pkgs.map((pkg,i)=><div key={i} className="p-8 bg-white text-center space-y-5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}25`}}><p className="text-[10px] font-black uppercase tracking-widest" style={{color:ac(style)}}>{pkg.name}</p><p className="text-4xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{pkg.price}</p><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{pkg.sessions} sessions</p>{config.showExpiry!==false&&<p className="text-xs text-slate-400">Valid 12 months</p>}{config.showSavings!==false&&<span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{background:ac(style),borderRadius:br(style,2)}}>{pkg.saving}</span>}<button onClick={cta(config.ctaAction,config.ctaUrl)} className="block w-full py-3 text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>Purchase</button></div>)}</div></div></section>);
}

function GiftCardsSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const amounts=(config.amounts||'25,50,75,100').split(',').map((a:string)=>a.trim()),hasBg=!!config.bgImage;
  return(<section className={cn(py(style),'relative')} style={{background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:'#f8fafc'}}>{hasBg&&<div className="absolute inset-0" style={{background:'rgba(0,0,0,0.45)'}}/>}<div className="relative max-w-2xl mx-auto px-6 md:px-16 text-center space-y-10"><div className="space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:hasBg?'white':'#0f172a'}}>{config.heading||'Give the Gift of Beauty'}</FieldTap>{config.subheading&&<p className="text-base" style={{fontFamily:bf(style),color:hasBg?'rgba(255,255,255,0.75)':'#64748b'}}>{config.subheading}</p>}</div><div className="p-10 shadow-2xl space-y-8 text-white" style={{background:`linear-gradient(135deg,${ac(style)} 0%,${ac(style)}cc 100%)`,borderRadius:br(style,2)}}><Gift className="w-12 h-12 mx-auto opacity-80"/><p className="text-lg font-light" style={{fontFamily:hf(style)}}>Choose an amount</p><div className="flex flex-wrap gap-3 justify-center">{amounts.map((a:string,i:number)=><button key={i} className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{borderRadius:br(style)}}>${a}</button>)}<button className="px-6 py-3 border-2 border-white/40 font-black text-sm hover:bg-white/20 transition-all" style={{borderRadius:br(style)}}>Custom</button></div><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-12 py-4 font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all" style={{background:'white',color:ac(style),borderRadius:br(style,3),fontFamily:bf(style)}}>{config.ctaText||'Send a Gift Card'}</button></div></div></section>);
}

function QuoteSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const rawTags=config.tags,tags:string[]=Array.isArray(rawTags)?rawTags:typeof rawTags==='string'?rawTags.split(',').map((t:string)=>t.trim()).filter(Boolean):[],hasBg=!!config.bgImage;
  return(<section className={cn(py(style),'relative')} style={{background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:'#0f172a'}}>{hasBg&&<div className="absolute inset-0" style={{background:'rgba(0,0,0,0.65)'}}/>}<div className="relative max-w-4xl mx-auto px-6 md:px-16 text-center space-y-10"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light text-white" style={{fontFamily:hf(style)}}>{config.heading||'Need Something Bigger?'}</FieldTap><FieldTap sectionId={sectionId} fieldKey="subheading" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed" style={{fontFamily:bf(style)}}>{config.subheading}</FieldTap>{tags.length>0&&<div className="flex flex-wrap gap-2.5 justify-center">{tags.map((tag:string,i:number)=><span key={i} className="px-5 py-2 border text-[11px] font-black uppercase tracking-widest text-white/55 border-white/20" style={{borderRadius:br(style,3)}}>{tag}</span>)}</div>}<FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-12 py-4 font-black text-sm uppercase tracking-widest shadow-2xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Request a Quote'}</button></FieldTap></div></section>);
}

function NewClientSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const hasBg=!!config.bgImage;
  return(<section className={cn(py(style),'relative')} style={{background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:ac(style)+'0e'}}>{hasBg&&<div className="absolute inset-0" style={{background:'rgba(0,0,0,0.55)'}}/>}<div className="relative max-w-5xl mx-auto px-6 md:px-16"><div className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-12" style={{borderRadius:br(style,2),border:`2px solid ${hasBg?'rgba(255,255,255,0.2)':ac(style)+'28'}`}}><div className={cn('text-center md:text-left space-y-3',hasBg&&'text-white')}><div className="flex items-center gap-2 justify-center md:justify-start"><Sparkles className="w-4 h-4" style={{color:hasBg?'white':ac(style)}}/><p className="text-[11px] font-black uppercase tracking-widest" style={{color:hasBg?'rgba(255,255,255,0.7)':ac(style)}}>First Visit</p></div><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-4xl font-light" style={{fontFamily:hf(style),color:hasBg?'white':'#0f172a'}}>{config.heading||'First Visit Special'}</FieldTap>{config.offerText&&<FieldTap sectionId={sectionId} fieldKey="offerText" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-xl font-black" style={{color:hasBg?'rgba(255,255,255,0.9)':ac(style),fontFamily:bf(style)}}>{config.offerText}</FieldTap>}{config.expiryText&&<p className="text-xs font-bold uppercase tracking-widest" style={{color:hasBg?'rgba(255,255,255,0.5)':'#94a3b8'}}>{config.expiryText}</p>}{config.finePrint&&<p className="text-xs" style={{color:hasBg?'rgba(255,255,255,0.4)':'#94a3b8'}}>{config.finePrint}</p>}</div><FieldTap sectionId={sectionId} fieldKey="ctaText" isPreview={isPreview} onFieldTap={onFieldTap} as="span"><button onClick={cta(config.ctaAction,config.ctaUrl)} className="shrink-0 px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Claim Offer'}</button></FieldTap></div></div></section>);
}

function FAQSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const[open,setOpen]=React.useState<number|null>(null),layout=config.layout||'accordion';
  const items=[1,2,3,4,5,6].map(n=>({q:config[`q${n}`],a:config[`a${n}`]})).filter(i=>i.q&&i.a);
  const H=()=><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-14" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Common Questions'}</FieldTap>;
  if(layout==='two-col')return<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-5xl mx-auto px-6 md:px-16"><H/><div className="grid md:grid-cols-2 gap-6">{items.map((item,i)=><div key={i} className="p-6 bg-white space-y-2" style={{borderRadius:br(style),border:`2px solid ${ac(style)}20`}}><p className="text-sm font-black uppercase tracking-tight text-slate-900" style={{fontFamily:bf(style)}}>{item.q}</p><p className="text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{item.a}</p></div>)}</div></div></section>;
  if(layout==='minimal')return<section className={py(style)} style={{background:style.bgColor}}><div className="max-w-3xl mx-auto px-6 md:px-16"><H/><div className="space-y-6">{items.map((item,i)=><div key={i} className="border-b pb-6" style={{borderColor:ac(style)+'18'}}><p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2" style={{fontFamily:bf(style)}}>{item.q}</p><p className="text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{item.a}</p></div>)}</div></div></section>;
  return<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-3xl mx-auto px-6 md:px-16"><H/><div className="space-y-2">{items.map((item,i)=><div key={i} className="overflow-hidden bg-white" style={{borderRadius:br(style),border:`2px solid ${ac(style)}22`}}><button onClick={()=>setOpen(open===i?null:i)} className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50/80 transition-colors"><span className="font-black text-sm uppercase tracking-tight text-slate-900 pr-4" style={{fontFamily:bf(style)}}>{item.q}</span>{open===i?<ChevronUp className="w-4 h-4 shrink-0" style={{color:ac(style)}}/>:<ChevronDown className="w-4 h-4 shrink-0 text-slate-300"/>}</button>{open===i&&<div className="px-6 pb-6 text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{item.a}</div>}</div>)}</div></div></section>;
}

function PoliciesSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const policyItems:any[]=Array.isArray(config.policies)?config.policies:[],layout=config.layout||'cards';
  const ie:Record<string,string>={shield:'🛡','shield-check':'✅',clock:'🕐',clock3:'⏰',alert:'⚠️',ban:'🚫',credit:'💳',heart:'❤️',badge:'🏅',info:'ℹ️',zap:'⚡',leaf:'🌿',coffee:'☕',flame:'🔥',phone:'📞',mail:'✉️'};
  return(<section className={py(style)} style={{background:style.bgColor}}><div className="max-w-5xl mx-auto px-6 md:px-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-4" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Policies'}</FieldTap>{config.subheading?<p className="text-base text-slate-500 text-center mb-14" style={{fontFamily:bf(style)}}>{config.subheading}</p>:<div className="mb-14"/>}{policyItems.length>0?(layout==='list'?(<div className="max-w-2xl mx-auto space-y-5">{policyItems.map((p:any,i:number)=><div key={p.id||i} className="flex items-start gap-4 py-4 border-b" style={{borderColor:ac(style)+'18'}}><span className="text-xl shrink-0 mt-0.5">{ie[p.icon]||'🛡'}</span><div><p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-1" style={{fontFamily:bf(style)}}>{p.title}</p><p className="text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{p.body}</p></div></div>)}</div>):(<div className="grid md:grid-cols-3 gap-6">{policyItems.map((p:any,i:number)=><div key={p.id||i} className="p-7 bg-white space-y-3" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22`}}><div className="flex items-center gap-2.5"><span className="text-xl">{ie[p.icon]||'🛡'}</span><p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>{p.title}</p></div><p className="text-sm text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{p.body}</p></div>)}</div>)):<p className="text-center text-[11px] font-black uppercase tracking-widest text-slate-300 py-12">No policies configured yet</p>}</div></section>);
}

function ContactSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps){
  const tenant=data.tenant,socialLinks:any[]=Array.isArray(config.socialLinks)?config.socialLinks:[],layout=config.layout||'split-map';
  const Info=()=>(
    <div className="space-y-7">
      {config.showHours!==false&&config.customHours&&<div className="space-y-2.5"><div className="flex items-center gap-2"><Clock className="w-4 h-4" style={{color:ac(style)}}/><p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>Hours</p></div><p className="text-sm text-slate-500 leading-relaxed whitespace-pre-line" style={{fontFamily:bf(style)}}>{config.customHours}</p></div>}
      {tenant?.studioAddress&&<div className="space-y-2.5"><div className="flex items-center gap-2"><MapPin className="w-4 h-4" style={{color:ac(style)}}/><p className="text-[11px] font-black uppercase tracking-widest" style={{color:ac(style)}}>Location</p></div><p className="text-sm text-slate-500" style={{fontFamily:bf(style)}}>{tenant.studioAddress}</p></div>}
      {config.showPhone!==false&&tenant?.phone&&<div className="flex items-center gap-3"><Phone className="w-4 h-4" style={{color:ac(style)}}/><a href={`tel:${tenant.phone}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.phone}</a></div>}
      {config.showEmail!==false&&tenant?.email&&<div className="flex items-center gap-3"><Mail className="w-4 h-4" style={{color:ac(style)}}/><a href={`mailto:${tenant.email}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{tenant.email}</a></div>}
      {config.showSocial!==false&&socialLinks.length>0&&<div className="flex gap-3 flex-wrap">{socialLinks.map((link:any)=><a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors border rounded-full" style={{borderColor:ac(style)+'30'}}>{link.platform}</a>)}</div>}
      {config.showSocial!==false&&tenant?.instagramHandle&&<div className="flex items-center gap-3"><Instagram className="w-4 h-4" style={{color:ac(style)}}/><a href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">@{tenant.instagramHandle}</a></div>}
      {config.ctaText&&<button onClick={cta(config.ctaAction,config.ctaUrl)} className="mt-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText}</button>}
    </div>
  );
  const Map=()=>tenant?.studioLocation?(<div className="overflow-hidden shadow-xl" style={{height:'280px',borderRadius:br(style,1.5)}}><iframe src={`https://maps.google.com/maps?q=${tenant.studioLocation.lat},${tenant.studioLocation.lng}&z=15&output=embed`} className="w-full h-full border-0" loading="lazy" title="Studio location"/></div>):null;
  return(<section id="contact" className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-5xl mx-auto px-6 md:px-16"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light text-center mb-16" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Find Us'}</FieldTap>{layout==='stacked'?(<div className="space-y-10 max-w-2xl mx-auto">{config.showMap!==false&&<Map/>}<Info/></div>):(<div className="grid md:grid-cols-2 gap-14 items-start"><Info/>{config.showMap!==false&&<Map/>}</div>)}</div></section>);
}

function EventsSection({config,style,data,isPreview,sectionId,onFieldTap}:SectionProps){
  const events=data.events;
  return(<section className={py(style)} style={{background:style.bgColor}}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className="text-center mb-16 space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Upcoming Events'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500" style={{fontFamily:bf(style)}}>{config.subheading}</p>}</div>{events.length>0?(<div className="space-y-4">{events.map((event:any)=>{const d=event.date?new Date(event.date?.toDate?.()??event.date):null;return(<div key={event.id} className="flex items-center gap-6 p-6 bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22`}}>{d&&<div className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-white" style={{background:ac(style),borderRadius:br(style)}}><span className="text-[9px] font-black uppercase">{d.toLocaleString('default',{month:'short'})}</span><span className="text-xl font-black leading-none">{d.getDate()}</span></div>}<div className="flex-1 min-w-0"><p className="font-black uppercase tracking-tight text-slate-900 text-sm truncate" style={{fontFamily:bf(style)}}>{event.title||event.name}</p>{event.description&&<p className="text-xs text-slate-400 mt-1 truncate">{event.description}</p>}</div><button onClick={cta(config.ctaAction,config.ctaUrl)} className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'RSVP'}</button></div>);})}</div>):(<div className="text-center py-16 space-y-4"><Calendar className="w-12 h-12 mx-auto text-slate-200"/><p className="text-[11px] font-black uppercase tracking-widest text-slate-300">{config.emptyText||'Check back soon!'}</p></div>)}</div></section>);
}

function ReferralSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  return(<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-3xl mx-auto px-6 md:px-16 text-center space-y-12"><div className="space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Refer a Friend'}</FieldTap>{config.subheading&&<p className="text-base text-slate-500 max-w-xl mx-auto" style={{fontFamily:bf(style)}}>{config.subheading}</p>}</div><div className="grid grid-cols-2 gap-5 max-w-md mx-auto">{[{l:'You get',v:config.rewardYou,k:'rewardYou'},{l:'Friend gets',v:config.rewardFriend,k:'rewardFriend'}].map((item,i)=><div key={i} className="p-6 bg-white space-y-2" style={{borderRadius:br(style,1.5),border:`2px solid ${ac(style)}22`}}><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.l}</p><FieldTap sectionId={sectionId} fieldKey={item.k} isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-2xl font-black" style={{fontFamily:hf(style),color:ac(style)}}>{item.v}</FieldTap></div>)}</div><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-10 py-4 font-black text-sm uppercase tracking-widest shadow-xl hover:opacity-90 hover:scale-[1.02] transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Get My Referral Link'}</button></div></section>);
}

function StorySection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const hasImage=!!config.image;
  return(<section className={py(style)} style={{background:style.bgColor}}><div className="max-w-5xl mx-auto px-6 md:px-16"><div className={cn('grid gap-14 items-center',hasImage?'md:grid-cols-2':'max-w-2xl mx-auto')}><div className="space-y-8"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-6xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Our Story'}</FieldTap><div className="w-12 h-px" style={{background:ac(style)}}/>{config.pullQuote&&<FieldTap sectionId={sectionId} fieldKey="pullQuote" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-2xl font-light italic" style={{fontFamily:hf(style),color:ac(style)}}>"{config.pullQuote}"</FieldTap>}<FieldTap sectionId={sectionId} fieldKey="body" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-500 leading-relaxed" style={{fontFamily:bf(style)}}>{config.body}</FieldTap>{config.ctaText&&<button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{...btnStyle(style,'secondary'),fontFamily:bf(style)}}>{config.ctaText}</button>}</div>{hasImage&&<img src={config.image} alt="Our Story" className="w-full aspect-square object-cover shadow-2xl" style={{borderRadius:br(style,2)}}/>}</div></div></section>);
}

function InstagramSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const uploaded:any[]=Array.isArray(config.images)?config.images:[],layout=config.layout||'grid',cols=parseInt(config.columns)||4;
  const gridCls=cols===3?'grid-cols-3':cols===6?'grid-cols-3 md:grid-cols-6':'grid-cols-2 md:grid-cols-4';
  const shades=['10','14','18','12','16','1a'],imgs=uploaded.length>0?uploaded.slice(0,8):shades.map((s,i)=>({id:i,url:null,shade:s}));
  const Head=()=><div className="space-y-3"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-4xl md:text-5xl font-light" style={{fontFamily:hf(style),color:'#0f172a'}}>{config.heading||'Follow Along'}</FieldTap><FieldTap sectionId={sectionId} fieldKey="handle" isPreview={isPreview} onFieldTap={onFieldTap} as="p" className="text-base text-slate-400">{config.handle||'@studio'}</FieldTap></div>;
  if(layout==='banner')return(<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-6xl mx-auto px-6 md:px-16 text-center space-y-10"><Head/><div className="flex gap-3 overflow-x-auto snap-x pb-2" style={{scrollbarWidth:'none'}}>{[...imgs,...imgs].map((item:any,i:number)=><div key={i} className="shrink-0 snap-start w-48 h-48 overflow-hidden rounded-xl group">{item.url?<img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>:<div className="w-full h-full" style={{background:ac(style)+item.shade}}/>}</div>)}</div><a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{...btnStyle(style,'secondary'),fontFamily:bf(style)}}><Instagram className="w-4 h-4"/>{config.ctaText||'Follow us'}</a></div></section>);
  return(<section className={py(style)} style={{background:'#f8fafc'}}><div className="max-w-5xl mx-auto px-6 md:px-16 text-center space-y-12"><Head/><div className={`grid ${gridCls} gap-2`}>{imgs.map((item:any,i:number)=><div key={i} className="aspect-square overflow-hidden group" style={{borderRadius:br(style)}}>{item.url?<img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"/>:<div className="w-full h-full" style={{background:ac(style)+item.shade}}/>}</div>)}</div><a href={`https://instagram.com/${(config.handle||'').replace('@','')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-8 py-3.5 font-black text-sm uppercase tracking-widest hover:opacity-80 transition-all" style={{...btnStyle(style,'secondary'),fontFamily:bf(style)}}><Instagram className="w-4 h-4"/>{config.ctaText||'Follow us on Instagram'}</a></div></section>);
}

function WaitlistSection({config,style,isPreview,sectionId,onFieldTap}:SectionProps){
  const hasBg=!!config.bgImage;
  return(<section className={cn(py(style),'relative')} style={{background:hasBg?`url(${config.bgImage}) center/cover no-repeat`:style.bgColor}}>{hasBg&&<div className="absolute inset-0" style={{background:'rgba(0,0,0,0.55)'}}/>}<div className="relative max-w-lg mx-auto px-6 md:px-16 text-center space-y-8"><div className="space-y-4"><FieldTap sectionId={sectionId} fieldKey="heading" isPreview={isPreview} onFieldTap={onFieldTap} as="h2" className="text-3xl md:text-5xl font-light" style={{fontFamily:hf(style),color:hasBg?'white':'#0f172a'}}>{config.heading||'Fully Booked?'}</FieldTap>{config.subheading&&<p className="text-base" style={{fontFamily:bf(style),color:hasBg?'rgba(255,255,255,0.75)':'#64748b'}}>{config.subheading}</p>}</div><div className="flex gap-2"><input type="email" placeholder="your@email.com" className="flex-1 px-4 py-3 text-sm focus:outline-none" style={{borderRadius:br(style),border:`2px solid ${hasBg?'rgba(255,255,255,0.3)':ac(style)+'40'}`,fontFamily:bf(style),background:hasBg?'rgba(255,255,255,0.1)':'white',color:hasBg?'white':'inherit'}}/><button onClick={cta(config.ctaAction,config.ctaUrl)} className="px-6 py-3 font-black text-sm uppercase tracking-widest whitespace-nowrap hover:opacity-90 transition-all" style={{...btnStyle(style),fontFamily:bf(style)}}>{config.ctaText||'Join'}</button></div></div></section>);
}

function Footer({tenant,style}:{tenant:any;style:StyleConfig}){
  return<footer className="py-8 border-t text-center" style={{borderColor:ac(style)+'20'}}><p className="text-[10px] font-black uppercase tracking-widest text-slate-400" style={{fontFamily:bf(style)}}>{tenant?.name||'Studio'} · Powered by ClarityFlow</p></footer>;
}

function SectionRenderer(p:{section:PageSection;style:StyleConfig;data:PageData;isPreview:boolean;onFieldTap:(s:string,f:string)=>void}){
  const{section,style,data,isPreview,onFieldTap}=p;
  const sp:SectionProps={config:section.config,style,data,isPreview,sectionId:section.id,onFieldTap};
  switch(section.type){
    case 'nav':         return<NavSection         {...sp}/>;
    case 'hero':        return<HeroSection        {...sp}/>;
    case 'trust':       return<TrustSection       {...sp}/>;
    case 'services':    return<ServicesSection    {...sp}/>;
    case 'team':        return<TeamSection        {...sp}/>;
    case 'reviews':     return<ReviewsSection     {...sp}/>;
    case 'gallery':     return<GallerySection     {...sp}/>;
    case 'beforeafter': return<BeforeAfterSection {...sp}/>;
    case 'memberships': return<MembershipsSection {...sp}/>;
    case 'packages':    return<PackagesSection    {...sp}/>;
    case 'giftcards':   return<GiftCardsSection   {...sp}/>;
    case 'quote':       return<QuoteSection       {...sp}/>;
    case 'newclient':   return<NewClientSection   {...sp}/>;
    case 'faq':         return<FAQSection         {...sp}/>;
    case 'policies':    return<PoliciesSection    {...sp}/>;
    case 'contact':     return<ContactSection     {...sp}/>;
    case 'events':      return<EventsSection      {...sp}/>;
    case 'referral':    return<ReferralSection    {...sp}/>;
    case 'story':       return<StorySection       {...sp}/>;
    case 'instagram':   return<InstagramSection   {...sp}/>;
    case 'waitlist':    return<WaitlistSection    {...sp}/>;
    default:            return null;
  }
}

// ─── Main page ─────────────────────────────────────────────────────────────────
function BookingPageContent({tenantId}:{tenantId:string}){
  // ── Detect whether we're inside the page builder iframe ──────────────────
  const isPreview = typeof window !== 'undefined' && window !== window.parent;

  // ── Data state ────────────────────────────────────────────────────────────
  const[tenant,setTenant]         = useState<any>(null);
  const[services,setServices]     = useState<any[]>([]);
  const[staff,setStaff]           = useState<any[]>([]);
  const[events,setEvents]         = useState<any[]>([]);
  const[appointments,setAppointments]         = useState<any[]>([]);
  const[scheduleProfiles,setScheduleProfiles] = useState<any[]>([]);
  const[pricingTiers,setPricingTiers]         = useState<any[]>([]);
  const[consentForms,setConsentForms]         = useState<any[]>([]);

  // ── Config state ──────────────────────────────────────────────────────────
  // savedConfig: what's in Firestore — the ONLY source of truth for the public page
  const[savedConfig,setSavedConfig] = useState<PageBuilderConfig|null>(null);
  // liveConfig: real-time updates from the page builder, ONLY used when isPreview
  const[liveConfig,setLiveConfig]   = useState<{sections:PageSection[];style:any}|null>(null);

  // ── Loading gates ─────────────────────────────────────────────────────────
  // configReady: Firestore fetch finished (unblocks public render)
  const[configReady,setConfigReady]   = useState(false);
  // liveReady: builder sent first CLARITY_PREVIEW message (unblocks preview render to avoid flash)
  const[liveReady,setLiveReady]       = useState(false);

  // ── Booking UI state ──────────────────────────────────────────────────────
  const[dialogOpen,setDialogOpen]     = useState(false);
  const[dialogService,setDialogService] = useState<any>(null);
  const[showPicker,setShowPicker]     = useState(false);

  const getDb = useCallback(()=>{try{return getFirestore(getApp());}catch{return null;}},[]);

  // ── Inject animation CSS once ─────────────────────────────────────────────
  useEffect(()=>{
    if(!document.getElementById('cf-anim')){
      const s=document.createElement('style');s.id='cf-anim';s.textContent=ANIM_CSS;
      document.head.appendChild(s);
    }
  },[]);

  // ── Phase 1: Load tenant doc + saved page config from Firestore ───────────
  useEffect(()=>{
    if(!tenantId){setConfigReady(true);return;}
    let cancelled=false;
    const run=async()=>{
      const db=getDb();
      if(!db){setConfigReady(true);return;}
      try{
        const tSnap=await getDoc(doc(db,'tenants',tenantId));
        if(!cancelled&&tSnap.exists()){
          const t={id:tSnap.id,...tSnap.data()} as any;
          setTenant(t);
          // Only accept configs that were genuinely written by the page builder
          const pc=t?.bookingPageSettings?.cfPageConfig;
          if(isBuilderConfig(pc)) setSavedConfig(pc as PageBuilderConfig);
        }
      }catch(e){console.warn('[booking:config]',e);}
      if(!cancelled) setConfigReady(true);
    };
    run();
    return()=>{cancelled=true;};
  },[tenantId,getDb]);

  // ── Phase 2: Load services, staff, events etc (non-blocking) ─────────────
  useEffect(()=>{
    if(!tenantId||!configReady) return;
    let cancelled=false;
    const run=async()=>{
      const db=getDb();if(!db)return;
      try{
        const[svSnap,stSnap,evSnap,aptSnap,spSnap,ptSnap,cfSnap]=await Promise.all([
          getDocs(collection(db,`tenants/${tenantId}/services`)),
          getDocs(collection(db,`tenants/${tenantId}/staff`)),
          getDocs(query(collection(db,`tenants/${tenantId}/studioEvents`),orderBy('date','asc'))).catch(()=>getDocs(collection(db,`tenants/${tenantId}/studioEvents`))),
          getDocs(query(collection(db,`tenants/${tenantId}/appointments`),where('startTime','>=',new Date().toISOString().split('T')[0]))).catch(()=>({docs:[]})),
          getDocs(collection(db,`tenants/${tenantId}/scheduleProfiles`)).catch(()=>({docs:[]})),
          getDocs(collection(db,`tenants/${tenantId}/pricingTiers`)).catch(()=>({docs:[]})),
          getDocs(collection(db,`tenants/${tenantId}/consentForms`)).catch(()=>({docs:[]})),
        ]);
        if(!cancelled){
          setServices(svSnap.docs.map(d=>({id:d.id,...d.data()})).filter((s:any)=>s.isActive!==false));
          setStaff(stSnap.docs.map(d=>({id:d.id,...d.data()})).filter((s:any)=>s.isActive!==false));
          setEvents(evSnap.docs.map(d=>({id:d.id,...d.data()})));
          setAppointments((aptSnap as any).docs.map((d:any)=>({id:d.id,...d.data()})));
          setScheduleProfiles((spSnap as any).docs.map((d:any)=>({id:d.id,...d.data()})));
          setPricingTiers((ptSnap as any).docs.map((d:any)=>({id:d.id,...d.data()})));
          setConsentForms((cfSnap as any).docs.map((d:any)=>({id:d.id,...d.data()})));
        }
      }catch(e){console.warn('[booking:data]',e);}
    };
    run();
    return()=>{cancelled=true;};
  },[tenantId,configReady,getDb]);

  // ── Preview: listen for live config from the page builder ─────────────────
  // This only matters when isPreview is true. On the public page these
  // messages never arrive, so liveConfig stays null and is never used.
  useEffect(()=>{
    if(!isPreview) return;
    const h=(e:MessageEvent)=>{
      if(e.data?.type==='CLARITY_PREVIEW'){
        setLiveConfig({sections:e.data.sections,style:e.data.style});
        setLiveReady(true);
      }
    };
    window.addEventListener('message',h);
    return()=>window.removeEventListener('message',h);
  },[isPreview]);

  // ── Preview: signal builder that iframe is ready, retry until ack ─────────
  useEffect(()=>{
    if(!isPreview) return;
    window.parent.postMessage({type:'BOOKING_READY'},'*');
    const retry=setInterval(()=>{
      if(!liveReady) window.parent.postMessage({type:'BOOKING_READY'},'*');
      else clearInterval(retry);
    },300);
    return()=>clearInterval(retry);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isPreview,liveReady]);

  // ── Handle booking open events ────────────────────────────────────────────
  useEffect(()=>{
    const h=(e:Event)=>{
      const d=(e as CustomEvent).detail;
      if(d?.service){setDialogService(d.service);setDialogOpen(true);}
      else{if(services.length===1){setDialogService(services[0]);setDialogOpen(true);}else setShowPicker(true);}
    };
    window.addEventListener('cf-book',h);
    return()=>window.removeEventListener('cf-book',h);
  },[services]);

  // ── Click-to-edit callbacks (preview only) ────────────────────────────────
  const handleFieldTap=useCallback((sectionId:string,fieldKey:string)=>{
    if(isPreview) window.parent.postMessage({type:'EDIT_FIELD',sectionId,fieldKey},'*');
  },[isPreview]);
  const handleEditSection=useCallback((sectionId:string)=>{
    if(isPreview) window.parent.postMessage({type:'EDIT_SECTION',sectionId},'*');
  },[isPreview]);

  // ── Resolve which config to render ────────────────────────────────────────
  // PUBLIC page  → always savedConfig (or fallback defaults). liveConfig is ignored.
  // PREVIEW iframe → liveConfig takes precedence over savedConfig so builder
  //                  changes reflect instantly without saving.
  const resolvedSections: PageSection[] = isPreview
    ? (liveConfig?.sections ?? savedConfig?.sections ?? buildDefaults())
    : (savedConfig?.sections ?? buildDefaults());

  const resolvedStyle: StyleConfig = {
    accentColor:  (isPreview ? liveConfig?.style?.accentColor  : undefined) ?? savedConfig?.accentColor  ?? DS.accentColor,
    bgColor:      (isPreview ? liveConfig?.style?.bgColor      : undefined) ?? savedConfig?.bgColor      ?? DS.bgColor,
    headingFont:  (isPreview ? liveConfig?.style?.headingFont  : undefined) ?? savedConfig?.headingFont  ?? DS.headingFont,
    bodyFont:     (isPreview ? liveConfig?.style?.bodyFont     : undefined) ?? savedConfig?.bodyFont     ?? DS.bodyFont,
    borderRadius: (isPreview ? liveConfig?.style?.borderRadius : undefined) ?? savedConfig?.borderRadius ?? DS.borderRadius,
    buttonStyle:  (isPreview ? liveConfig?.style?.buttonStyle  : undefined) ?? savedConfig?.buttonStyle  ?? DS.buttonStyle,
    density:      (isPreview ? liveConfig?.style?.density      : undefined) ?? savedConfig?.density      ?? DS.density,
  };

  const activeSections = resolvedSections
    .filter(s=>s.enabled)
    .sort((a,b)=>a.order-b.order);

  // ── Inject Google Fonts + CSS variables ───────────────────────────────────
  useEffect(()=>{injectFonts(resolvedStyle.headingFont,resolvedStyle.bodyFont);},[resolvedStyle.headingFont,resolvedStyle.bodyFont]);
  useEffect(()=>{
    const root=document.documentElement;
    root.style.setProperty('--booking-heading-font',hf(resolvedStyle));
    root.style.setProperty('--booking-body-font',bf(resolvedStyle));
    root.style.setProperty('--radius',`${resolvedStyle.borderRadius}px`);
    try{ root.style.setProperty('--primary',hexToHsl(resolvedStyle.accentColor)); }catch{}
  },[resolvedStyle]);

  // ── Loading spinner ───────────────────────────────────────────────────────
  // Public page: show spinner only until Firestore config has loaded.
  // Preview iframe: also wait for first live config message to avoid
  //                 a flash of saved-config state before builder sync.
  if(!configReady || (isPreview && !liveReady)){
    return(
      <div className="w-full min-h-dvh flex items-center justify-center" style={{background:DS.bgColor}}>
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{borderColor:DS.accentColor}}/>
      </div>
    );
  }

  // ── Booking confirm handler ───────────────────────────────────────────────
  const handleConfirm=async(
    formData:{clientName:string;clientEmail:string;clientPhone?:string;notes?:string},
    apptDetails:any,
    signedForms:any[],
    setStep:(s:string)=>void,
  )=>{
    try{
      const db=getFirestore(getApp());
      await addDoc(collection(db,`tenants/${tenantId}/bookingRequests`),{
        ...formData,...apptDetails,signedForms,
        status:'pending',source:'booking-page',createdAt:new Date(),
      });
      setStep('confirmation');
    }catch(e){console.error('[booking-confirm]',e);}
  };

  const data:PageData={tenant,services,staff,events,tenantId};

  return(
    <div className="w-full min-h-dvh overflow-x-hidden" style={{background:resolvedStyle.bgColor,fontFamily:bf(resolvedStyle)}}>

      {/* Preview mode indicator */}
      {isPreview&&(
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 bg-slate-900/90 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-2xl backdrop-blur pointer-events-none select-none">
          Hover to select · Tap text to edit ✏️
        </div>
      )}

      {/* Service picker */}
      {showPicker&&(
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={()=>setShowPicker(false)}/>
          <div className="relative w-full sm:max-w-lg sm:mx-4 bg-white overflow-hidden" style={{borderRadius:'24px 24px 0 0',maxHeight:'80dvh'}}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{borderColor:ac(resolvedStyle)+'20'}}>
              <p className="font-black text-sm uppercase tracking-widest" style={{fontFamily:bf(resolvedStyle),color:ac(resolvedStyle)}}>Select a Service</p>
              <button onClick={()=>setShowPicker(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><XIcon className="w-4 h-4"/></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2" style={{maxHeight:'60dvh'}}>
              {services.map((s:any)=>(
                <button key={s.id} onClick={()=>{setDialogService(s);setShowPicker(false);setDialogOpen(true);}}
                  className="w-full flex items-center justify-between p-4 text-left hover:shadow-md transition-all"
                  style={{borderRadius:br(resolvedStyle),border:`2px solid ${ac(resolvedStyle)}25`,background:'white'}}>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate" style={{fontFamily:bf(resolvedStyle)}}>{s.name}</p>
                    {s.duration&&<p className="text-[10px] font-black uppercase tracking-widest mt-0.5" style={{color:ac(resolvedStyle)+'80'}}>{s.duration} min</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {s.price&&<span className="text-xl font-light" style={{fontFamily:hf(resolvedStyle),color:ac(resolvedStyle)}}>${s.price}</span>}
                    <ArrowRight className="w-4 h-4 text-slate-300"/>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Booking sheet */}
      {dialogOpen&&dialogService&&(
        <BookingSheet
          open={dialogOpen}
          onOpenChange={(o)=>{if(!o){setDialogOpen(false);setDialogService(null);}}}
          service={dialogService}
          staff={staff}
          pricingTiers={pricingTiers}
          appointments={appointments}
          events={events}
          scheduleProfiles={scheduleProfiles}
          services={services}
          consentForms={consentForms}
          tenant={tenant}
          onConfirm={handleConfirm}
        />
      )}

      {/* Sections */}
      {activeSections.map(section=>{
        const _a=(section.config as any)._animation;
        const wrapKey=isPreview?`${section.id}-${_a?.type||'fu'}-${_a?.speed||700}`:section.id;
        return(
          <SectionWrapper key={wrapKey} section={section} isPreview={isPreview} onEdit={handleEditSection} onFieldTap={handleFieldTap}>
            <SectionRenderer section={section} style={resolvedStyle} data={data} isPreview={isPreview} onFieldTap={handleFieldTap}/>
          </SectionWrapper>
        );
      })}

      <Footer tenant={tenant} style={resolvedStyle}/>
    </div>
  );
}

export default function BookingPage({params}:{params:{tenantId:string}}){
  return<BookingPageContent tenantId={params.tenantId}/>;
}