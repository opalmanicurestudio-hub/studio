'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import nextDynamic from 'next/dynamic';
const AppHeader = nextDynamic(
  () => import('@/components/shared/AppHeader').then(m => ({ default: m.AppHeader })),
  { ssr: false, loading: () => <div className="h-14 border-b bg-white shrink-0" /> }
);
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import {
  Navigation, ImageIcon, Award, Scissors, Users, Star,
  LayoutDashboard, RotateCcw, Crown, Package, Gift,
  FileText, Sparkles, HelpCircle, Shield, MapPin,
  Calendar, Share2, BookOpen, Camera, Clock,
  ChevronUp, ChevronDown, Plus, Eye, Save, ExternalLink,
  Loader, Check, Palette, Settings, X, Monitor, Smartphone,
  RefreshCw, AlertCircle, Copy, GripVertical,
  Instagram, Facebook, Twitter, Youtube, Globe, Music2,
  Linkedin, MessageCircle, Phone, Mail,
  AtSign, Hash, Layers, Undo2, Redo2,
  ShieldCheck, Heart, Zap, Coffee, Leaf, Flame,
  AlertTriangle, Info, Ban, Clock3, CreditCard, BadgeCheck,
  ArrowLeftRight, Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';

// ─── Types ────────────────────────────────────────────────────────────────────
type SectionType =
  | 'nav' | 'hero' | 'trust' | 'services' | 'team' | 'reviews'
  | 'gallery' | 'beforeafter' | 'memberships' | 'packages' | 'giftcards'
  | 'quote' | 'newclient' | 'faq' | 'policies' | 'contact' | 'events'
  | 'referral' | 'story' | 'instagram' | 'waitlist';

type FieldType =
  | 'text' | 'textarea' | 'toggle' | 'select' | 'image' | 'color'
  | 'range' | 'image-array' | 'social-links' | 'policy-list' | 'tag-list'
  | 'beforeafter-pairs';

interface SectionField { k:string; t:FieldType; l:string; d:any; opts?:string[]; min?:number; max?:number; step?:number; }
interface SectionLayoutOption { id:string; label:string; preview:string; }
interface SectionDef { label:string; icon:React.ElementType; color:string; fields:SectionField[]; layouts?:SectionLayoutOption[]; }
interface PolicyItem { id:string; icon:string; title:string; body:string; }
interface SocialLink { platform:string; url:string; }
interface GalleryImage { id:string; url:string; caption?:string; category?:string; }
interface BeforeAfterPair { id:string; beforeUrl:string; afterUrl:string; caption?:string; }

// ─── Animation config ─────────────────────────────────────────────────────────
interface AnimConfig { type:string; speed:number; }
const ANIM_TYPES = [
  { id:'fade-up',    label:'Fade Up',     emoji:'↑' },
  { id:'fade-in',    label:'Fade In',     emoji:'○' },
  { id:'slide-left', label:'Slide Left',  emoji:'←' },
  { id:'slide-right',label:'Slide Right', emoji:'→' },
  { id:'scale-up',   label:'Scale Up',   emoji:'⊕' },
  { id:'zoom-in',    label:'Zoom In',    emoji:'🔍' },
  { id:'none',       label:'None',       emoji:'—' },
];

// ─── Google Fonts ─────────────────────────────────────────────────────────────
const GFONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&'+
  'family=Playfair+Display:wght@400;700&family=Lora:wght@400;600&'+
  'family=Merriweather:wght@300;400;700&family=EB+Garamond:wght@400;600&'+
  'family=Libre+Baskerville:wght@400;700&family=DM+Serif+Display&'+
  'family=Domine:wght@400;700&family=Space+Grotesk:wght@300;400;700&'+
  'family=Josefin+Sans:wght@300;400;700&family=Raleway:wght@300;400;700&'+
  'family=Montserrat:wght@300;400;700&family=Nunito:wght@300;400;700&'+
  'family=Poppins:wght@300;400;700&family=Outfit:wght@300;400;700&'+
  'family=DM+Sans:wght@300;400;700&family=Inter:wght@300;400;700&'+
  'family=Figtree:wght@300;400;700&family=Bebas+Neue&'+
  'family=Oswald:wght@300;400;700&family=Anton&family=Righteous&'+
  'family=Abril+Fatface&family=Pacifico&family=Dancing+Script:wght@400;700&'+
  'family=Great+Vibes&family=JetBrains+Mono:wght@400;700&'+
  'family=Space+Mono:wght@400;700&display=swap';

function useGoogleFonts() {
  useEffect(()=>{
    if(document.getElementById('pb-gfonts')) return;
    const pre=document.createElement('link'); pre.rel='preconnect'; pre.href='https://fonts.googleapis.com'; document.head.appendChild(pre);
    const pre2=document.createElement('link'); pre2.rel='preconnect'; pre2.href='https://fonts.gstatic.com'; pre2.crossOrigin='anonymous'; document.head.appendChild(pre2);
    const link=document.createElement('link'); link.id='pb-gfonts'; link.rel='stylesheet'; link.href=GFONTS_HREF; document.head.appendChild(link);
  },[]);
}

// ─── Fonts ────────────────────────────────────────────────────────────────────
const FONTS = [
  {id:'cormorant',label:'Cormorant Garamond',stack:"'Cormorant Garamond',Georgia,serif",desc:'Luxury serif',group:'Serif'},
  {id:'playfair',label:'Playfair Display',stack:"'Playfair Display',Georgia,serif",desc:'Editorial serif',group:'Serif'},
  {id:'lora',label:'Lora',stack:"'Lora',Georgia,serif",desc:'Elegant serif',group:'Serif'},
  {id:'merriweather',label:'Merriweather',stack:"'Merriweather',Georgia,serif",desc:'Classic serif',group:'Serif'},
  {id:'eb-garamond',label:'EB Garamond',stack:"'EB Garamond',Georgia,serif",desc:'Old-style serif',group:'Serif'},
  {id:'libre-bask',label:'Libre Baskerville',stack:"'Libre Baskerville',Georgia,serif",desc:'Traditional',group:'Serif'},
  {id:'dm-serif',label:'DM Serif Display',stack:"'DM Serif Display',Georgia,serif",desc:'Modern serif',group:'Serif'},
  {id:'domine',label:'Domine',stack:"'Domine',Georgia,serif",desc:'Humanist serif',group:'Serif'},
  {id:'space',label:'Space Grotesk',stack:"'Space Grotesk',system-ui,sans-serif",desc:'Modern sans',group:'Sans'},
  {id:'josefin',label:'Josefin Sans',stack:"'Josefin Sans',system-ui,sans-serif",desc:'Geometric sans',group:'Sans'},
  {id:'raleway',label:'Raleway',stack:"'Raleway',system-ui,sans-serif",desc:'Elegant sans',group:'Sans'},
  {id:'montserrat',label:'Montserrat',stack:"'Montserrat',system-ui,sans-serif",desc:'Clean sans',group:'Sans'},
  {id:'nunito',label:'Nunito',stack:"'Nunito',system-ui,sans-serif",desc:'Friendly rounded',group:'Sans'},
  {id:'poppins',label:'Poppins',stack:"'Poppins',system-ui,sans-serif",desc:'Geometric clean',group:'Sans'},
  {id:'outfit',label:'Outfit',stack:"'Outfit',system-ui,sans-serif",desc:'Minimalist sans',group:'Sans'},
  {id:'dm-sans',label:'DM Sans',stack:"'DM Sans',system-ui,sans-serif",desc:'Neutral sans',group:'Sans'},
  {id:'inter',label:'Inter',stack:"'Inter',system-ui,sans-serif",desc:'UI-optimized',group:'Sans'},
  {id:'figtree',label:'Figtree',stack:"'Figtree',system-ui,sans-serif",desc:'Contemporary',group:'Sans'},
  {id:'bebas',label:'Bebas Neue',stack:"'Bebas Neue',Impact,sans-serif",desc:'Bold display',group:'Display'},
  {id:'oswald',label:'Oswald',stack:"'Oswald',system-ui,sans-serif",desc:'Condensed bold',group:'Display'},
  {id:'anton',label:'Anton',stack:"'Anton',Impact,sans-serif",desc:'Heavy impact',group:'Display'},
  {id:'righteous',label:'Righteous',stack:"'Righteous',system-ui,sans-serif",desc:'Bold retro',group:'Display'},
  {id:'abril',label:'Abril Fatface',stack:"'Abril Fatface',Georgia,serif",desc:'Fat display',group:'Display'},
  {id:'pacifico',label:'Pacifico',stack:"'Pacifico',cursive",desc:'Casual script',group:'Display'},
  {id:'dancing',label:'Dancing Script',stack:"'Dancing Script',cursive",desc:'Elegant script',group:'Display'},
  {id:'great-vibes',label:'Great Vibes',stack:"'Great Vibes',cursive",desc:'Luxury script',group:'Display'},
  {id:'system',label:'System UI',stack:'system-ui,sans-serif',desc:'Default clean',group:'System'},
  {id:'georgia',label:'Georgia',stack:'Georgia,serif',desc:'Classic system',group:'System'},
];
const FONT_GROUPS=['Serif','Sans','Display','System'];

// ─── Brand kits ───────────────────────────────────────────────────────────────
const BRAND_KITS=[
  {id:'champagne',label:'Champagne',accentColor:'#8b6914',bgColor:'#f8f4ef',headingFont:'cormorant',bodyFont:'raleway',borderRadius:8,desc:'Warm luxury'},
  {id:'midnight',label:'Midnight',accentColor:'#534AB7',bgColor:'#0b0b0b',headingFont:'playfair',bodyFont:'dm-sans',borderRadius:4,desc:'Dark editorial'},
  {id:'blush',label:'Blush',accentColor:'#c4718a',bgColor:'#fff5f7',headingFont:'dancing',bodyFont:'nunito',borderRadius:16,desc:'Soft feminine'},
  {id:'sage',label:'Sage',accentColor:'#0F6E56',bgColor:'#f0f8f4',headingFont:'dm-serif',bodyFont:'poppins',borderRadius:12,desc:'Natural calm'},
  {id:'slate',label:'Slate',accentColor:'#334155',bgColor:'#ffffff',headingFont:'josefin',bodyFont:'inter',borderRadius:6,desc:'Clean minimal'},
  {id:'coral',label:'Coral',accentColor:'#A32D2D',bgColor:'#fafafa',headingFont:'abril',bodyFont:'montserrat',borderRadius:4,desc:'Bold & warm'},
  {id:'lavender',label:'Lavender',accentColor:'#7c3aed',bgColor:'#faf8ff',headingFont:'playfair',bodyFont:'outfit',borderRadius:14,desc:'Modern luxe'},
  {id:'espresso',label:'Espresso',accentColor:'#854F0B',bgColor:'#f5f0eb',headingFont:'merriweather',bodyFont:'lora',borderRadius:6,desc:'Rich warmth'},
  {id:'electric',label:'Electric',accentColor:'#185FA5',bgColor:'#ffffff',headingFont:'bebas',bodyFont:'figtree',borderRadius:3,desc:'Bold modern'},
  {id:'forest',label:'Forest',accentColor:'#3B6D11',bgColor:'#f4f7f0',headingFont:'eb-garamond',bodyFont:'dm-sans',borderRadius:10,desc:'Earthy organic'},
  {id:'noir',label:'Noir',accentColor:'#c9a84c',bgColor:'#111111',headingFont:'cormorant',bodyFont:'space',borderRadius:2,desc:'Gold on black'},
  {id:'bubbly',label:'Bubbly',accentColor:'#c4718a',bgColor:'#fff5f7',headingFont:'righteous',bodyFont:'nunito',borderRadius:24,desc:'Fun & playful'},
];

// ─── Socials ──────────────────────────────────────────────────────────────────
const SOCIAL_PLATFORMS=[
  {id:'instagram',label:'Instagram',icon:Instagram,placeholder:'https://instagram.com/yourstudio',color:'#E1306C'},
  {id:'facebook',label:'Facebook',icon:Facebook,placeholder:'https://facebook.com/yourstudio',color:'#1877F2'},
  {id:'tiktok',label:'TikTok',icon:Music2,placeholder:'https://tiktok.com/@yourstudio',color:'#000000'},
  {id:'youtube',label:'YouTube',icon:Youtube,placeholder:'https://youtube.com/@yourstudio',color:'#FF0000'},
  {id:'twitter',label:'X/Twitter',icon:Twitter,placeholder:'https://x.com/yourstudio',color:'#000000'},
  {id:'pinterest',label:'Pinterest',icon:Hash,placeholder:'https://pinterest.com/yourstudio',color:'#E60023'},
  {id:'linkedin',label:'LinkedIn',icon:Linkedin,placeholder:'https://linkedin.com/in/yourstudio',color:'#0A66C2'},
  {id:'threads',label:'Threads',icon:AtSign,placeholder:'https://threads.net/@yourstudio',color:'#000000'},
  {id:'website',label:'Website',icon:Globe,placeholder:'https://yourstudio.com',color:'#334155'},
];

// ─── Policy icons ─────────────────────────────────────────────────────────────
const POLICY_ICONS=[
  {id:'shield',icon:Shield,label:'Shield'},{id:'shield-check',icon:ShieldCheck,label:'Check'},
  {id:'clock',icon:Clock,label:'Clock'},{id:'clock3',icon:Clock3,label:'Alarm'},
  {id:'alert',icon:AlertTriangle,label:'Warning'},{id:'ban',icon:Ban,label:'No'},
  {id:'credit',icon:CreditCard,label:'Payment'},{id:'heart',icon:Heart,label:'Heart'},
  {id:'badge',icon:BadgeCheck,label:'Badge'},{id:'info',icon:Info,label:'Info'},
  {id:'zap',icon:Zap,label:'Zap'},{id:'leaf',icon:Leaf,label:'Leaf'},
  {id:'coffee',icon:Coffee,label:'Care'},{id:'flame',icon:Flame,label:'Hot'},
  {id:'phone',icon:Phone,label:'Phone'},{id:'mail',icon:Mail,label:'Mail'},
];

// ─── Section defs ─────────────────────────────────────────────────────────────
const SECTION_DEFS: Record<SectionType, SectionDef> = {
  nav: { label:'Navigation',icon:Navigation,color:'#3B6D11', fields:[
    {k:'logoUrl',t:'image',l:'Logo image',d:''},{k:'logoText',t:'text',l:'Studio name',d:'Opal'},
    {k:'ctaText',t:'text',l:'Button label',d:'Book Now'},{k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','scroll-services','scroll-contact','url']},
    {k:'ctaUrl',t:'text',l:'Custom URL',d:''},{k:'showLinks',t:'toggle',l:'Show nav links',d:true},
    {k:'sticky',t:'toggle',l:'Sticky nav',d:true},{k:'transparent',t:'toggle',l:'Transparent on hero',d:false},
    {k:'socialLinks',t:'social-links',l:'Social links',d:[]},
  ], layouts:[
    {id:'centered',label:'Centered',preview:'[ logo | links | cta ]'},{id:'split',label:'Logo left',preview:'[ logo ] ─ [ links | cta ]'},
    {id:'minimal',label:'Minimal',preview:'[ logo ] ──────── [ cta ]'},{id:'logo-top',label:'Logo stacked',preview:'[ logo ]\n[ links | cta ]'},
  ]},
  hero: { label:'Hero',icon:ImageIcon,color:'#534AB7', fields:[
    {k:'bgImage',t:'image',l:'Background image',d:''},{k:'heroImage',t:'image',l:'Feature image (split)',d:''},
    {k:'overlayOpacity',t:'range',l:'Overlay opacity',d:40,min:0,max:90,step:5},
    {k:'headline',t:'text',l:'Headline',d:'Book Your Experience'},{k:'subheadline',t:'textarea',l:'Subheadline',d:'A sanctuary of craft, curated for those who appreciate the details.'},
    {k:'ctaText',t:'text',l:'Primary button',d:'Book a Session'},{k:'ctaAction',t:'select',l:'Primary action',d:'booking',opts:['booking','scroll-services','url']},
    {k:'showWalkIn',t:'toggle',l:'Show walk-in button',d:true},{k:'cta2Text',t:'text',l:'Walk-in label',d:'Walk In Today'},
    {k:'cta2Action',t:'select',l:'Walk-in action',d:'scroll-contact',opts:['booking','scroll-contact','scroll-services','url']},
    {k:'videoUrl',t:'text',l:'Background video URL',d:''},{k:'showBadge',t:'toggle',l:'Show trust badge',d:false},
    {k:'badgeText',t:'text',l:'Badge text',d:'⭐ 4.9 · 500+ clients'},
  ], layouts:[
    {id:'centered',label:'Centered',preview:'[ bg · headline · cta ]'},{id:'split',label:'Split',preview:'[ text | image ]'},
    {id:'fullbleed',label:'Full bleed',preview:'[ full bg · overlay ]'},{id:'minimal',label:'Minimal',preview:'[ white · centered ]'},
    {id:'cinematic',label:'Cinematic',preview:'[ 100vh · bottom text ]'},{id:'magazine',label:'Magazine',preview:'[ large text | image ]'},
  ]},
  trust: { label:'Trust Strip',icon:Award,color:'#854F0B', fields:[
    {k:'stat1l',t:'text',l:'Stat 1 label',d:'Happy clients'},{k:'stat1v',t:'text',l:'Stat 1 value',d:'500+'},
    {k:'stat2l',t:'text',l:'Stat 2 label',d:'Avg rating'},{k:'stat2v',t:'text',l:'Stat 2 value',d:'4.9'},
    {k:'stat3l',t:'text',l:'Stat 3 label',d:'Years open'},{k:'stat3v',t:'text',l:'Stat 3 value',d:'6'},
    {k:'stat4l',t:'text',l:'Stat 4 label',d:'Services'},{k:'stat4v',t:'text',l:'Stat 4 value',d:'20+'},
    {k:'animate',t:'toggle',l:'Animate counters on scroll',d:true},{k:'showDividers',t:'toggle',l:'Show dividers',d:true},
  ], layouts:[
    {id:'strip',label:'Horizontal strip',preview:'[ stat | stat | stat | stat ]'},{id:'cards',label:'Stat cards',preview:'┌──┐┌──┐┌──┐┌──┐'},
    {id:'centered',label:'Centered large',preview:'   stat   stat   stat   '},{id:'banner',label:'Dark banner',preview:'▓[ stat | stat | stat ]▓'},
    {id:'ticker',label:'Scrolling ticker',preview:'→ stat · stat · stat →'},
  ]},
  services: { label:'Services',icon:Scissors,color:'#185FA5', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Our Services'},{k:'subheading',t:'text',l:'Subheading',d:'Handcrafted treatments for every occasion'},
    {k:'ctaText',t:'text',l:'Book button text',d:'Book this service'},{k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},
    {k:'columns',t:'select',l:'Columns',d:'2',opts:['1','2','3']},{k:'showPrices',t:'toggle',l:'Show prices',d:true},
    {k:'showDuration',t:'toggle',l:'Show duration',d:true},{k:'showFilters',t:'toggle',l:'Category filter',d:false},
    {k:'showDesc',t:'toggle',l:'Show descriptions',d:true},{k:'showImages',t:'toggle',l:'Show service images',d:false},
    {k:'hoverEffect',t:'toggle',l:'Hover lift effect',d:true},
  ], layouts:[
    {id:'cards',label:'Cards',preview:'┌────┐ ┌────┐'},{id:'list',label:'List',preview:'── Service · price ──'},
    {id:'magazine',label:'Magazine',preview:'[ large img | text ]'},{id:'grid',label:'Compact grid',preview:'┌──┬──┬──┐'},
    {id:'accordion',label:'Accordion',preview:'▶ Category\n  · item'},{id:'featured',label:'Featured',preview:'[ hero ]\n[ other · other ]'},
  ]},
  team: { label:'Team',icon:Users,color:'#0F6E56', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'The Artists'},{k:'subheading',t:'text',l:'Subheading',d:'Expert hands for every style'},
    {k:'showBio',t:'toggle',l:'Show bio',d:false},{k:'showSpecialties',t:'toggle',l:'Show specialties',d:true},
    {k:'showBookButton',t:'toggle',l:'Book per artist',d:false},{k:'bookCta',t:'text',l:'Book button text',d:'Book with me'},
    {k:'bookAction',t:'select',l:'Book action',d:'booking',opts:['booking','url']},{k:'hoverReveal',t:'toggle',l:'Hover reveal bio',d:true},
  ], layouts:[
    {id:'circles',label:'Circle avatars',preview:'  ◯   ◯   ◯\n name name name'},{id:'editorial',label:'Editorial cards',preview:'┌────┐ ┌────┐'},
    {id:'row',label:'Horizontal row',preview:'[ ◯ name ][ ◯ name ]'},{id:'grid',label:'Grid',preview:'┌──┬──┬──┐'},
    {id:'featured',label:'Featured artist',preview:'[ large lead ]\n◯ ◯ ◯ team'},{id:'minimal',label:'Minimal list',preview:'— Name · Title'},
  ]},
  reviews: { label:'Reviews',icon:Star,color:'#993556', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'What Clients Say'},{k:'subheading',t:'text',l:'Subheading',d:'Real words from real guests'},
    {k:'showRating',t:'toggle',l:'Show star ratings',d:true},{k:'showPhotos',t:'toggle',l:'Show client photos',d:true},
    {k:'autoScroll',t:'toggle',l:'Auto-scroll carousel',d:false},{k:'scrollSpeed',t:'range',l:'Scroll speed (s)',d:4,min:2,max:10,step:1},
  ], layouts:[
    {id:'grid',label:'Grid',preview:'┌────┐ ┌────┐'},{id:'masonry',label:'Masonry',preview:'┌──┐ ┌────┐'},
    {id:'carousel',label:'Carousel',preview:'← [ review ] →'},{id:'quotes',label:'Large quotes',preview:'" quote text "'},
    {id:'ticker',label:'Auto-scroll',preview:'→ review · review →'},{id:'featured',label:'Featured',preview:'[ big quote ]\n[ ★ small ]'},
  ]},
  gallery: { label:'Portfolio Gallery',icon:LayoutDashboard,color:'#534AB7', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Our Work'},{k:'subheading',t:'text',l:'Subheading',d:'Every set, a canvas'},
    {k:'images',t:'image-array',l:'Gallery images',d:[]},{k:'showFilters',t:'toggle',l:'Style filter tabs',d:true},
    {k:'showCaptions',t:'toggle',l:'Show captions',d:false},{k:'lightbox',t:'toggle',l:'Lightbox on click',d:true},
    {k:'hoverEffect',t:'select',l:'Hover effect',d:'zoom',opts:['zoom','fade','slide-up','none']},
    {k:'columns',t:'select',l:'Columns',d:'3',opts:['2','3','4']},
  ], layouts:[
    {id:'masonry',label:'Masonry',preview:'┌──┐ ┌────┐\n│  │ │    │'},{id:'grid',label:'Uniform grid',preview:'┌──┬──┬──┐'},
    {id:'carousel',label:'Carousel',preview:'← [ img ] →'},{id:'editorial',label:'Editorial',preview:'[ large ][ sm ]'},
    {id:'fullwidth',label:'Full-width scroll',preview:'← img · img · img →'},{id:'mosaic',label:'Mosaic',preview:'┌────┬──┐\n│    │  │'},
  ]},
  beforeafter: { label:'Before / After',icon:RotateCcw,color:'#0F6E56', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Transformations'},{k:'subheading',t:'text',l:'Subheading',d:'See the difference we make'},
    {k:'pairs',t:'beforeafter-pairs',l:'Before / After pairs',d:[]},{k:'sliderColor',t:'color',l:'Slider handle color',d:'#8b6914'},
    {k:'autoPlay',t:'toggle',l:'Auto-reveal on scroll',d:true},{k:'showLabels',t:'toggle',l:'Show Before/After labels',d:true},
  ], layouts:[
    {id:'slider',label:'Drag slider',preview:'[ before ←→ after ]'},{id:'side',label:'Side by side',preview:'[ before ] [ after ]'},
    {id:'stack',label:'Stacked hover',preview:'[ hover to reveal ]'},{id:'carousel',label:'Carousel pairs',preview:'← [ B/A pair ] →'},
  ]},
  memberships: { label:'Memberships',icon:Crown,color:'#534AB7', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Join the Club'},{k:'subheading',t:'text',l:'Subheading',d:'Exclusive perks for loyal guests'},
    {k:'ctaText',t:'text',l:'Button text',d:'Get started'},{k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},
    {k:'showSavings',t:'toggle',l:'Highlight savings',d:true},{k:'showBadge',t:'toggle',l:'Show popular badge',d:true},
  ], layouts:[
    {id:'cards',label:'Pricing cards',preview:'┌────┐ ┌────┐ ┌────┐'},{id:'table',label:'Feature table',preview:'| ✓  | ✓  | ✓  |'},
    {id:'minimal',label:'Minimal list',preview:'── Tier · price ──'},{id:'featured',label:'Featured tier',preview:'[ best ] [sm] [sm]'},
  ]},
  packages: { label:'Packages',icon:Package,color:'#185FA5', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Prepaid Sessions'},{k:'subheading',t:'text',l:'Subheading',d:'Buy more, save more'},
    {k:'ctaText',t:'text',l:'Button text',d:'Buy package'},{k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},
    {k:'showExpiry',t:'toggle',l:'Show expiry',d:true},{k:'showSavings',t:'toggle',l:'Show savings %',d:true},
  ], layouts:[
    {id:'cards',label:'Cards',preview:'┌────┐ ┌────┐'},{id:'list',label:'List',preview:'── 5-pack · $xxx ──'},
    {id:'featured',label:'Featured',preview:'[ best deal ] [ sm ]'},
  ]},
  giftcards: { label:'Gift Cards',icon:Gift,color:'#993556', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Give the Gift of Beauty'},{k:'subheading',t:'text',l:'Subheading',d:'For birthdays, holidays, or just because'},
    {k:'bgImage',t:'image',l:'Background / card image',d:''},{k:'ctaText',t:'text',l:'Button text',d:'Send a Gift Card'},
    {k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},{k:'amounts',t:'text',l:'Preset amounts (comma-sep)',d:'25,50,75,100'},
  ], layouts:[
    {id:'hero',label:'Hero style',preview:'[ bg image | text + cta ]'},{id:'card',label:'Card preview',preview:'┌─gift card design─┐'},
    {id:'minimal',label:'Minimal',preview:'[ amounts ] [buy]'},
  ]},
  quote: { label:'Quote Request',icon:FileText,color:'#3B6D11', fields:[
    {k:'heading',t:'text',l:'Heading',d:'Need Something Bigger?'},{k:'subheading',t:'textarea',l:'Description',d:'Planning a wedding, bridal party, or corporate event? We craft bespoke experiences.'},
    {k:'ctaText',t:'text',l:'Button text',d:'Request a Quote'},{k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},
    {k:'bgImage',t:'image',l:'Background image',d:''},{k:'tags',t:'tag-list',l:'Event types',d:['Bridal Parties','Corporate Events','Destination Services']},
  ], layouts:[
    {id:'split',label:'Split',preview:'[ text | form ]'},{id:'centered',label:'Centered',preview:'  heading\n  tags\n  [cta]'},
    {id:'banner',label:'Dark banner',preview:'▓▓[ text · cta ]▓▓'},
  ]},
  newclient: { label:'New Client Offer',icon:Sparkles,color:'#854F0B', fields:[
    {k:'heading',t:'text',l:'Heading',d:'First Visit Special'},{k:'offerText',t:'text',l:'Offer description',d:'20% off your first appointment'},
    {k:'finePrint',t:'text',l:'Fine print',d:'Valid for new clients only.'},{k:'ctaText',t:'text',l:'Button text',d:'Claim Offer'},
    {k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},{k:'bgImage',t:'image',l:'Background image',d:''},
    {k:'expiryText',t:'text',l:'Expiry text',d:'Limited time only'},{k:'showTimer',t:'toggle',l:'Show countdown',d:false},
  ], layouts:[
    {id:'banner',label:'Banner',preview:'[ offer · highlight · cta ]'},{id:'card',label:'Offer card',preview:'┌──────────────┐'},
    {id:'fullbleed',label:'Full bleed',preview:'[ bg img · overlay · text ]'},{id:'popup',label:'Callout',preview:'⚡ banner across top'},
  ]},
  faq: { label:'FAQ',icon:HelpCircle,color:'#185FA5', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Common Questions'},
    {k:'q1',t:'text',l:'Question 1',d:'How do I book an appointment?'},{k:'a1',t:'textarea',l:'Answer 1',d:'Use the Book Now button above or select any service to get started.'},
    {k:'q2',t:'text',l:'Question 2',d:'What is your cancellation policy?'},{k:'a2',t:'textarea',l:'Answer 2',d:'We require 24 hours notice to avoid a cancellation fee.'},
    {k:'q3',t:'text',l:'Question 3',d:'Do you accept walk-ins?'},{k:'a3',t:'textarea',l:'Answer 3',d:'Yes! Walk-ins welcome based on availability.'},
    {k:'q4',t:'text',l:'Question 4',d:'Do you offer gift cards?'},{k:'a4',t:'textarea',l:'Answer 4',d:'Absolutely — gift cards available in any amount.'},
    {k:'q5',t:'text',l:'Question 5 (optional)',d:''},{k:'a5',t:'textarea',l:'Answer 5',d:''},
    {k:'q6',t:'text',l:'Question 6 (optional)',d:''},{k:'a6',t:'textarea',l:'Answer 6',d:''},
  ], layouts:[
    {id:'accordion',label:'Accordion',preview:'▶ Question 1\n▶ Question 2'},{id:'two-col',label:'Two columns',preview:'┌──┬──┐\n│Q │Q │'},
    {id:'cards',label:'Cards',preview:'┌────┐ ┌────┐'},{id:'minimal',label:'Minimal list',preview:'Q · A\nQ · A'},
  ]},
  policies: { label:'Policies',icon:Shield,color:'#0F6E56', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Our Policies'},{k:'subheading',t:'text',l:'Subheading',d:''},
    {k:'policies',t:'policy-list',l:'Policy items',d:[
      {id:'p1',icon:'clock',title:'Cancellation',body:'Please provide 24 hours notice for all cancellations.'},
      {id:'p2',icon:'clock3',title:'Late Arrival',body:'Arrivals 15+ minutes late may need to reschedule.'},
      {id:'p3',icon:'ban',title:'No-Shows',body:'No-shows may be required to prepay future bookings.'},
    ]},
  ], layouts:[
    {id:'cards',label:'Icon cards',preview:'┌──┐ ┌──┐ ┌──┐'},{id:'list',label:'Icon list',preview:'🛡 Cancellation\n🕐 Late arrival'},
    {id:'table',label:'Compact table',preview:'│policy │ details │'},{id:'minimal',label:'Minimal',preview:'Policy · details'},
  ]},
  contact: { label:'Location & Contact',icon:MapPin,color:'#993556', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Find Us'},{k:'customHours',t:'textarea',l:'Hours text',d:'Monday – Saturday: 9am – 7pm\nSunday: 10am – 5pm'},
    {k:'showMap',t:'toggle',l:'Show map embed',d:true},{k:'showHours',t:'toggle',l:'Show hours',d:true},
    {k:'showPhone',t:'toggle',l:'Show phone',d:true},{k:'showEmail',t:'toggle',l:'Show email',d:true},
    {k:'showSocial',t:'toggle',l:'Show social links',d:true},{k:'ctaText',t:'text',l:'Book CTA text',d:'Book an Appointment'},
    {k:'ctaAction',t:'select',l:'CTA action',d:'booking',opts:['booking','url']},{k:'socialLinks',t:'social-links',l:'Social links',d:[]},
  ], layouts:[
    {id:'split-map',label:'Map + info',preview:'[ map | hours · address ]'},{id:'stacked',label:'Stacked',preview:'[ map ]\n[ details ]'},
    {id:'cards',label:'Info cards',preview:'┌──┐┌──┐┌──┐'},{id:'minimal',label:'Minimal',preview:'  address · hours  '},
  ]},
  events: { label:'Events Calendar',icon:Calendar,color:'#854F0B', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Upcoming Events'},{k:'subheading',t:'text',l:'Subheading',d:'Workshops, pop-ups & studio specials'},
    {k:'emptyText',t:'text',l:'When no events',d:'Check back soon for upcoming events!'},{k:'ctaText',t:'text',l:'RSVP button',d:'RSVP Now'},
    {k:'ctaAction',t:'select',l:'RSVP action',d:'booking',opts:['booking','url']},
  ], layouts:[
    {id:'cards',label:'Event cards',preview:'┌────┐ ┌────┐'},{id:'list',label:'List',preview:'── date · event ──'},
    {id:'calendar',label:'Calendar',preview:'┌su│mo│tu│we┐'},
  ]},
  referral: { label:'Referral Program',icon:Share2,color:'#185FA5', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Refer a Friend'},{k:'subheading',t:'text',l:'Description',d:'Share the love — give $15, get $15 toward your next visit'},
    {k:'rewardYou',t:'text',l:'Your reward',d:'$15 credit'},{k:'rewardFriend',t:'text',l:'Friend reward',d:'$15 off first visit'},
    {k:'ctaText',t:'text',l:'Button text',d:'Get My Referral Link'},{k:'ctaAction',t:'select',l:'Button action',d:'booking',opts:['booking','url']},
  ], layouts:[
    {id:'split',label:'Split reward',preview:'[ you get | friend gets ]'},{id:'centered',label:'Centered',preview:'  offer · [get link]  '},
    {id:'banner',label:'Banner',preview:'▓[ refer a friend · cta ]▓'},
  ]},
  story: { label:'Studio Story',icon:BookOpen,color:'#3B6D11', fields:[
    {k:'image',t:'image',l:'Section image',d:''},{k:'heading',t:'text',l:'Section heading',d:'Our Story'},
    {k:'body',t:'textarea',l:'Story text',d:'Opal was born from a belief that nail care is more than maintenance — it is a ritual of self-expression.'},
    {k:'ctaText',t:'text',l:'Button text',d:'Meet the team'},{k:'ctaAction',t:'select',l:'Button action',d:'scroll-team',opts:['booking','scroll-team','url']},
    {k:'pullQuote',t:'text',l:'Pull quote (optional)',d:''},
  ], layouts:[
    {id:'split',label:'Text + image',preview:'[ text | image ]'},{id:'centered',label:'Centered',preview:'  heading\n  body\n  [cta]'},
    {id:'editorial',label:'Editorial',preview:'[ large img ]\n[ quote ] [ text ]'},{id:'timeline',label:'Timeline',preview:'2019 ── 2021 ── 2024'},
  ]},
  instagram: { label:'Instagram Feed',icon:Camera,color:'#993556', fields:[
    {k:'heading',t:'text',l:'Section heading',d:'Follow Along'},{k:'handle',t:'text',l:'Instagram handle',d:'@opalmanicure'},
    {k:'ctaText',t:'text',l:'Button text',d:'Follow us on Instagram'},{k:'images',t:'image-array',l:'Preview images (if no API)',d:[]},
    {k:'columns',t:'select',l:'Columns',d:'4',opts:['3','4','6']},
  ], layouts:[
    {id:'grid',label:'Square grid',preview:'┌──┬──┬──┬──┐'},{id:'masonry',label:'Masonry',preview:'┌──┐ ┌────┐'},
    {id:'banner',label:'Wide banner',preview:'← scroll row →'},
  ]},
  waitlist: { label:'Waitlist',icon:Clock,color:'#534AB7', fields:[
    {k:'heading',t:'text',l:'Heading',d:'Fully Booked?'},{k:'subheading',t:'text',l:'Subheading',d:"Join our waitlist and we'll notify you when a slot opens"},
    {k:'ctaText',t:'text',l:'Button text',d:'Join Waitlist'},{k:'ctaAction',t:'select',l:'Action',d:'booking',opts:['booking','url']},
    {k:'bgImage',t:'image',l:'Background image',d:''},
  ], layouts:[
    {id:'banner',label:'Banner',preview:'[ heading · form · cta ]'},{id:'centered',label:'Centered',preview:'  heading\n  [join]'},
    {id:'card',label:'Card',preview:'┌────────────┐\n│ join list  │'},
  ]},
};

const DEFAULT_ON: SectionType[]=['nav','hero','services','team','quote'];

function buildDefaultSections(): PageSection[] {
  return (Object.keys(SECTION_DEFS) as SectionType[]).map((key,i) => {
    const cfg: Record<string,any>={};
    SECTION_DEFS[key].fields.forEach(f=>{cfg[f.k]=f.d;});
    cfg.layout=SECTION_DEFS[key].layouts?.[0]?.id??'default';
    const defIdx=DEFAULT_ON.indexOf(key);
    return {id:key,type:key,enabled:defIdx>=0,order:defIdx>=0?defIdx:DEFAULT_ON.length+i,config:cfg};
  }).sort((a,b)=>a.order-b.order);
}

function generateId(){return Math.random().toString(36).slice(2,8);}

// ─── Animation picker ─────────────────────────────────────────────────────────
const AnimationPicker=({value,onChange}:{value:AnimConfig|undefined;onChange:(v:AnimConfig)=>void})=>{
  const cur=value||{type:'fade-up',speed:700};
  return(
    <div className="space-y-4 p-4 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.02]">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/60 flex items-center gap-2"><Wand2 className="w-3 h-3"/>Entrance animation</p>
      <div className="grid grid-cols-4 gap-1.5">
        {ANIM_TYPES.map(t=>(
          <button key={t.id} onClick={()=>onChange({...cur,type:t.id})}
                  className={cn('p-2 rounded-xl border-2 text-center transition-all',cur.type===t.id?'border-primary/40 bg-primary/5':'border-border hover:border-primary/20')}>
            <div className="text-base mb-0.5">{t.emoji}</div>
            <p className={cn('text-[7px] font-black uppercase tracking-wider leading-tight',cur.type===t.id?'text-primary':'text-slate-500')}>{t.label}</p>
          </button>
        ))}
      </div>
      {cur.type!=='none'&&(
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Speed</p>
            <span className="text-[9px] font-bold text-muted-foreground">{(cur.speed/1000).toFixed(1)}s</span>
          </div>
          <Slider value={[cur.speed]} onValueChange={([v])=>onChange({...cur,speed:v})} min={300} max={1200} step={100} className="w-full"/>
          <div className="flex justify-between"><span className="text-[8px] text-muted-foreground/50">Snappy</span><span className="text-[8px] text-muted-foreground/50">Subtle</span></div>
        </div>
      )}
    </div>
  );
};

// ─── Layout picker ────────────────────────────────────────────────────────────
const LayoutPicker=({layouts,value,onChange}:{layouts:SectionLayoutOption[];value:string;onChange:(v:string)=>void})=>(
  <div className="space-y-2">
    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Section layout</p>
    <div className="grid grid-cols-2 gap-2">
      {layouts.map(l=>(
        <button key={l.id} onClick={()=>onChange(l.id)}
                className={cn('p-3 rounded-xl border-2 text-left transition-all',value===l.id?'border-primary/40 bg-primary/5':'border-border hover:border-primary/20')}>
          <pre className="text-[8px] text-muted-foreground/60 font-mono leading-tight overflow-hidden whitespace-pre-wrap">{l.preview}</pre>
          <p className={cn('text-[9px] font-black uppercase tracking-widest mt-1.5',value===l.id?'text-primary':'text-slate-500')}>{l.label}</p>
        </button>
      ))}
    </div>
  </div>
);

// ─── Social links editor ──────────────────────────────────────────────────────
const SocialLinksEditor=({value,onChange}:{value:SocialLink[];onChange:(v:SocialLink[])=>void})=>{
  const links:SocialLink[]=Array.isArray(value)?value:[];
  const addPlatform=(id:string)=>{if(links.some(l=>l.platform===id))return;onChange([...links,{platform:id,url:''}]);};
  const updateUrl=(id:string,url:string)=>onChange(links.map(l=>l.platform===id?{...l,url}:l));
  const remove=(id:string)=>onChange(links.filter(l=>l.platform!==id));
  const active=links.map(l=>l.platform);
  const available=SOCIAL_PLATFORMS.filter(p=>!active.includes(p.id));
  return(
    <div className="space-y-3">
      {links.map(link=>{
        const p=SOCIAL_PLATFORMS.find(x=>x.id===link.platform); if(!p) return null;
        const PI=p.icon;
        return(
          <div key={link.platform} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{background:p.color+'18'}}><PI className="w-3.5 h-3.5" style={{color:p.color}}/></div>
            <Input value={link.url} onChange={e=>updateUrl(link.platform,e.target.value)} placeholder={p.placeholder} className="flex-1 h-8 rounded-lg border-2 text-xs"/>
            <button onClick={()=>remove(link.platform)} className="p-1 text-muted-foreground hover:text-red-500"><X className="w-3.5 h-3.5"/></button>
          </div>
        );
      })}
      {available.length>0&&(
        <div className="flex flex-wrap gap-1.5">
          {available.map(p=>{const PI=p.icon;return(
            <button key={p.id} onClick={()=>addPlatform(p.id)} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-dashed border-border text-[10px] font-bold text-muted-foreground hover:border-primary/30 hover:text-primary transition-all">
              <Plus className="w-2.5 h-2.5"/>{p.label}
            </button>
          );})}
        </div>
      )}
    </div>
  );
};

// ─── Policy list editor ───────────────────────────────────────────────────────
const PolicyListEditor=({value,onChange}:{value:PolicyItem[];onChange:(v:PolicyItem[])=>void})=>{
  const policies:PolicyItem[]=Array.isArray(value)?value:[];
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const add=()=>{const n:PolicyItem={id:generateId(),icon:'shield',title:'New Policy',body:''};onChange([...policies,n]);setExpandedId(n.id);};
  const update=(id:string,f:keyof PolicyItem,v:string)=>onChange(policies.map(p=>p.id===id?{...p,[f]:v}:p));
  const remove=(id:string)=>onChange(policies.filter(p=>p.id!==id));
  return(
    <div className="space-y-2">
      {policies.map(policy=>{
        const icon=POLICY_ICONS.find(i=>i.id===policy.icon)??POLICY_ICONS[0];
        const PI=icon.icon; const isExp=expandedId===policy.id;
        return(
          <div key={policy.id} className="rounded-xl border-2 border-border overflow-hidden">
            <div className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={()=>setExpandedId(isExp?null:policy.id)}>
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0"><PI className="w-3.5 h-3.5 text-primary"/></div>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">{policy.title||'Untitled'}</span>
              <button onClick={e=>{e.stopPropagation();remove(policy.id);}} className="p-0.5 text-muted-foreground hover:text-red-500"><X className="w-3 h-3"/></button>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform',isExp&&'rotate-180')}/>
            </div>
            {isExp&&(
              <div className="p-3 pt-0 space-y-3 border-t border-border/50">
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Icon</p>
                  <div className="flex flex-wrap gap-1.5">
                    {POLICY_ICONS.map(ic=>{const II=ic.icon;return(
                      <button key={ic.id} onClick={()=>update(policy.id,'icon',ic.id)} title={ic.label}
                              className={cn('w-8 h-8 rounded-lg flex items-center justify-center border-2 transition-all',policy.icon===ic.id?'border-primary/40 bg-primary/10':'border-border hover:border-primary/20')}>
                        <II className="w-3.5 h-3.5 text-slate-600"/>
                      </button>
                    );})}
                  </div>
                </div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Title</Label><Input value={policy.title} onChange={e=>update(policy.id,'title',e.target.value)} className="h-8 rounded-lg border-2 text-xs"/></div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Description</Label><Textarea value={policy.body} onChange={e=>update(policy.id,'body',e.target.value)} className="rounded-xl border-2 text-xs min-h-[60px] resize-none"/></div>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={add} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"><Plus className="w-3.5 h-3.5"/>Add policy</button>
    </div>
  );
};

// ─── Before/After pairs editor ────────────────────────────────────────────────
const BeforeAfterPairsEditor=({value,onChange}:{value:BeforeAfterPair[];onChange:(v:BeforeAfterPair[])=>void})=>{
  const pairs:BeforeAfterPair[]=Array.isArray(value)?value:[];
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const add=()=>{const n:BeforeAfterPair={id:generateId(),beforeUrl:'',afterUrl:'',caption:''};onChange([...pairs,n]);setExpandedId(n.id);};
  const update=(id:string,f:keyof BeforeAfterPair,v:string)=>onChange(pairs.map(p=>p.id===id?{...p,[f]:v}:p));
  const remove=(id:string)=>onChange(pairs.filter(p=>p.id!==id));
  return(
    <div className="space-y-3">
      {pairs.map((pair,idx)=>{
        const isExp=expandedId===pair.id;
        return(
          <div key={pair.id} className="rounded-xl border-2 border-border overflow-hidden">
            <div className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={()=>setExpandedId(isExp?null:pair.id)}>
              <div className="flex gap-1 shrink-0">
                <div className="w-7 h-7 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">{pair.beforeUrl?<img src={pair.beforeUrl} alt="before" className="w-full h-full object-cover"/>:<span className="text-[7px] font-black text-muted-foreground/40">B</span>}</div>
                <ArrowLeftRight className="w-3 h-3 text-muted-foreground/40 self-center"/>
                <div className="w-7 h-7 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">{pair.afterUrl?<img src={pair.afterUrl} alt="after" className="w-full h-full object-cover"/>:<span className="text-[7px] font-black text-muted-foreground/40">A</span>}</div>
              </div>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">{pair.caption||`Pair ${idx+1}`}</span>
              <button onClick={e=>{e.stopPropagation();remove(pair.id);}} className="p-0.5 text-muted-foreground hover:text-red-500"><X className="w-3 h-3"/></button>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform',isExp&&'rotate-180')}/>
            </div>
            {isExp&&(
              <div className="p-3 pt-2 space-y-4 border-t border-border/50">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-400"/><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">Before image</Label></div>
                  {pair.beforeUrl&&<div className="relative rounded-xl overflow-hidden border-2 border-border aspect-video mb-2"><img src={pair.beforeUrl} alt="before" className="w-full h-full object-cover"/><button onClick={()=>update(pair.id,'beforeUrl','')} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-500 transition-colors"><X className="w-3 h-3"/></button><div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[8px] font-black uppercase tracking-widest">Before</div></div>}
                  {!pair.beforeUrl&&<ImageUpload initialImage="" onImageUploaded={url=>update(pair.id,'beforeUrl',url)}/>}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-primary"/><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">After image</Label></div>
                  {pair.afterUrl&&<div className="relative rounded-xl overflow-hidden border-2 border-border aspect-video mb-2"><img src={pair.afterUrl} alt="after" className="w-full h-full object-cover"/><button onClick={()=>update(pair.id,'afterUrl','')} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-500 transition-colors"><X className="w-3 h-3"/></button><div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-primary/80 text-white text-[8px] font-black uppercase tracking-widest">After</div></div>}
                  {!pair.afterUrl&&<ImageUpload initialImage="" onImageUploaded={url=>update(pair.id,'afterUrl',url)}/>}
                </div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Caption (optional)</Label><Input value={pair.caption||''} onChange={e=>update(pair.id,'caption',e.target.value)} placeholder="e.g. Gel removal & fresh set" className="h-8 rounded-lg border-2 text-xs"/></div>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={add} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"><Plus className="w-3.5 h-3.5"/>Add before/after pair</button>
    </div>
  );
};

// ─── Image array editor ───────────────────────────────────────────────────────
const ImageArrayEditor=({value,onChange,maxImages=50}:{value:GalleryImage[];onChange:(v:GalleryImage[])=>void;maxImages?:number})=>{
  const images:GalleryImage[]=Array.isArray(value)?value:[];
  const remove=(id:string)=>onChange(images.filter(img=>img.id!==id));
  return(
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {images.map(img=>(
          <div key={img.id} className="relative group rounded-xl overflow-hidden border-2 border-border aspect-square">
            {img.url?<img src={img.url} alt={img.caption||''} className="w-full h-full object-cover"/>:<div className="w-full h-full bg-muted flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground/40"/></div>}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><button onClick={()=>remove(img.id)} className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center"><X className="w-3 h-3"/></button></div>
          </div>
        ))}
      </div>
      {images.length<maxImages&&(
        <div><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2">Upload new image</p><ImageUpload initialImage="" onImageUploaded={url=>onChange([...images,{id:generateId(),url,caption:'',category:''}])}/></div>
      )}
      {images.length>0&&<p className="text-[9px] text-muted-foreground/50 text-center">{images.length} image{images.length!==1?'s':''} uploaded</p>}
    </div>
  );
};

// ─── Tag list editor ──────────────────────────────────────────────────────────
const TagListEditor=({value,onChange}:{value:string[];onChange:(v:string[])=>void})=>{
  const tags:string[]=Array.isArray(value)?value:[];
  const [input,setInput]=useState('');
  const add=()=>{const v=input.trim();if(v&&!tags.includes(v)){onChange([...tags,v]);setInput('');}};
  return(
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">{tags.map(tag=><span key={tag} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-bold">{tag}<button onClick={()=>onChange(tags.filter(t=>t!==tag))}><X className="w-2.5 h-2.5"/></button></span>)}</div>
      <div className="flex gap-2"><Input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} placeholder="Add tag…" className="h-8 rounded-lg border-2 text-xs flex-1"/><Button size="sm" onClick={add} variant="outline" className="h-8 px-3 rounded-lg text-xs">Add</Button></div>
    </div>
  );
};

// ─── Field renderer ───────────────────────────────────────────────────────────
const FieldRenderer=({field,value,onChange,highlightedField}:{
  field:SectionField; value:any; onChange:(v:any)=>void; highlightedField?:string|null;
})=>{
  const fieldRef=useRef<HTMLDivElement>(null);
  const isHighlighted=highlightedField===field.k;
  const labelCls='text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70';

  // Auto-scroll to highlighted field
  useEffect(()=>{
    if(isHighlighted&&fieldRef.current){
      fieldRef.current.scrollIntoView({behavior:'smooth',block:'center'});
    }
  },[isHighlighted]);

  const wrapper=(children:React.ReactNode)=>(
    <div ref={fieldRef} className={cn('transition-all duration-300',isHighlighted&&'ring-2 ring-indigo-400/60 rounded-xl p-2 bg-indigo-50/50')}>
      {children}
    </div>
  );

  if(field.t==='image') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><ImageUpload initialImage={value||''} onImageUploaded={onChange}/></div>);
  if(field.t==='image-array') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><ImageArrayEditor value={value||[]} onChange={onChange}/></div>);
  if(field.t==='beforeafter-pairs') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><BeforeAfterPairsEditor value={value||[]} onChange={onChange}/></div>);
  if(field.t==='social-links') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><SocialLinksEditor value={value||[]} onChange={onChange}/></div>);
  if(field.t==='policy-list') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><PolicyListEditor value={value||[]} onChange={onChange}/></div>);
  if(field.t==='tag-list') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><TagListEditor value={value||[]} onChange={onChange}/></div>);
  if(field.t==='toggle') return wrapper(<div className="flex items-center justify-between py-2.5 border-b border-dashed last:border-0"><span className={labelCls}>{field.l}</span><Switch checked={!!value} onCheckedChange={onChange}/></div>);
  if(field.t==='textarea') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><Textarea value={value||''} onChange={e=>onChange(e.target.value)} className="rounded-xl border-2 text-sm min-h-[80px] resize-none"/></div>);
  if(field.t==='select') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><Select value={value??field.d} onValueChange={onChange}><SelectTrigger className="h-10 rounded-xl border-2 text-xs font-black uppercase"><SelectValue/></SelectTrigger><SelectContent className="rounded-xl border-2">{field.opts!.map(o=><SelectItem key={o} value={o} className="text-xs font-black uppercase">{o.replace(/-/g,' ').charAt(0).toUpperCase()+o.replace(/-/g,' ').slice(1)}</SelectItem>)}</SelectContent></Select></div>);
  if(field.t==='color') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><div className="flex items-center gap-2"><input type="color" value={value||'#8b6914'} onChange={e=>onChange(e.target.value)} className="w-10 h-10 rounded-xl border-2 cursor-pointer p-0.5"/><Input value={value||''} onChange={e=>/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)&&onChange(e.target.value)} className="h-10 rounded-xl border-2 font-mono text-xs w-28" maxLength={7} placeholder="#000000"/></div></div>);
  if(field.t==='range') return wrapper(<div className="space-y-2"><div className="flex items-center justify-between"><Label className={labelCls}>{field.l}</Label><span className="text-xs font-bold text-muted-foreground">{value??field.d}</span></div><Slider value={[value??field.d]} onValueChange={([v])=>onChange(v)} min={field.min??0} max={field.max??100} step={field.step??1} className="w-full"/></div>);
  return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><Input value={value||''} onChange={e=>onChange(e.target.value)} className="h-10 rounded-xl border-2 text-sm"/></div>);
};

// ─── Section list item ────────────────────────────────────────────────────────
const SectionListItem=({section,isSelected,isFirst,isLast,onSelect,onMoveUp,onMoveDown,onHide,onDuplicate}:{
  section:PageSection;isSelected:boolean;isFirst:boolean;isLast:boolean;
  onSelect:()=>void;onMoveUp:()=>void;onMoveDown:()=>void;onHide:()=>void;onDuplicate:()=>void;
})=>{
  const def=SECTION_DEFS[section.type as SectionType]; const Icon=def.icon;
  return(
    <div onClick={onSelect} className={cn('flex items-center gap-2.5 p-2.5 rounded-2xl border-2 cursor-pointer transition-all group',isSelected?'border-primary/30 bg-primary/5 shadow-md':'border-border bg-background hover:border-primary/20')}>
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0"/>
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{background:def.color+'18'}}><Icon className="w-3.5 h-3.5" style={{color:def.color}}/></div>
      <span className={cn('flex-1 text-[10px] font-black uppercase tracking-tight truncate',isSelected?'text-primary':'text-slate-700')}>{def.label}</span>
      <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e=>e.stopPropagation()}>
        <button onClick={onDuplicate} title="Duplicate" className="p-1 rounded hover:bg-muted text-muted-foreground"><Copy className="w-3 h-3"/></button>
        <button onClick={onMoveUp} disabled={isFirst} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"><ChevronUp className="w-3 h-3"/></button>
        <button onClick={onMoveDown} disabled={isLast} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"><ChevronDown className="w-3 h-3"/></button>
        <button onClick={onHide} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"><X className="w-3 h-3"/></button>
      </div>
    </div>
  );
};

// ─── Library item ─────────────────────────────────────────────────────────────
const LibraryItem=({section,onAdd}:{section:PageSection;onAdd:()=>void})=>{
  const def=SECTION_DEFS[section.type as SectionType]; const Icon=def.icon;
  return(
    <button onClick={onAdd} className="w-full flex items-center gap-2.5 p-2.5 rounded-2xl border-2 border-border bg-background hover:border-primary/30 hover:bg-primary/5 transition-all text-left">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{background:def.color+'18'}}><Icon className="w-3.5 h-3.5" style={{color:def.color}}/></div>
      <span className="flex-1 text-[10px] font-black uppercase tracking-tight text-slate-700 truncate">{def.label}</span>
      <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0"/>
    </button>
  );
};

// ─── Font picker ──────────────────────────────────────────────────────────────
const FontPicker=({value,onChange}:{value:string;onChange:(v:string)=>void})=>{
  const [activeGroup,setActiveGroup]=useState('Serif');
  const groupFonts=FONTS.filter(f=>f.group===activeGroup);
  return(
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">{FONT_GROUPS.map(g=><button key={g} onClick={()=>setActiveGroup(g)} className={cn('px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',activeGroup===g?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-muted')}>{g}</button>)}</div>
      <div className="space-y-0.5">
        {groupFonts.map(f=>(
          <button key={f.id} onClick={()=>onChange(f.id)} className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all',value===f.id?'bg-primary/8 border border-primary/20':'hover:bg-muted/40 border border-transparent')}>
            <span className="text-sm flex-1 truncate" style={{fontFamily:f.stack}}>{f.label}</span>
            <span className="text-[9px] text-muted-foreground shrink-0">{f.desc}</span>
            {value===f.id&&<Check className="w-3 h-3 text-primary shrink-0"/>}
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── Brand kit picker ─────────────────────────────────────────────────────────
const BrandKitPicker=({style,onApply}:{style:any;onApply:(kit:typeof BRAND_KITS[0])=>void})=>(
  <div className="grid grid-cols-2 gap-2">
    {BRAND_KITS.map(kit=>(
      <button key={kit.id} onClick={()=>onApply(kit)}
              className={cn('p-3 rounded-2xl border-2 text-left transition-all hover:shadow-md',style.brandKit===kit.id?'border-primary/40 shadow-md':'border-border hover:border-primary/20')}
              style={{background:kit.bgColor}}>
        <div className="w-6 h-6 rounded-full mb-2" style={{background:kit.accentColor}}/>
        <p className="text-[10px] font-black uppercase tracking-tight" style={{color:kit.accentColor,fontFamily:FONTS.find(f=>f.id===kit.headingFont)?.stack}}>{kit.label}</p>
        <p className="text-[8px] mt-0.5" style={{color:kit.accentColor+'aa',fontFamily:FONTS.find(f=>f.id===kit.bodyFont)?.stack}}>{kit.desc}</p>
      </button>
    ))}
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PageBuilderPage() {
  const {firestore}=useFirebase();
  const {selectedTenant}=useTenant();
  const {toast}=useToast();
  useGoogleFonts();

  const previewRef=useRef<HTMLIFrameElement>(null);
  const isFirstLoad=useRef(true);
  const historyRef=useRef<{sections:PageSection[];style:any}[]>([]);
  const futureRef=useRef<{sections:PageSection[];style:any}[]>([]);

  const [sections,setSections]=useState<PageSection[]>(buildDefaultSections());
  const [selectedId,setSelectedId]=useState<string|null>('hero');
  const [highlightedField,setHighlightedField]=useState<string|null>(null);
  const [showLibrary,setShowLibrary]=useState(false);
  const [activePanel,setActivePanel]=useState<'sections'|'style'>('sections');
  const [styleTab,setStyleTab]=useState<'kits'|'colors'|'fonts'|'spacing'>('kits');
  const [isSaving,setIsSaving]=useState(false);
  const [isDirty,setIsDirty]=useState(false);
  const [previewMode,setPreviewMode]=useState<'desktop'|'mobile'>('desktop');
  const [previewKey,setPreviewKey]=useState(0);
  const [canUndo,setCanUndo]=useState(false);
  const [canRedo,setCanRedo]=useState(false);
  const [mobilePreviewOpen,setMobilePreviewOpen]=useState(false);

  const [style,setStyle]=useState({
    accentColor:'#8b6914', bgColor:'#f8f4ef', headingFont:'cormorant', bodyFont:'space',
    borderRadius:8, buttonStyle:'filled' as 'filled'|'outline'|'ghost'|'pill',
    density:'balanced' as 'compact'|'balanced'|'airy', brandKit:null as string|null,
  });

  // Load existing config
  useEffect(()=>{
    const existing=(selectedTenant?.bookingPageSettings as any)?.pageConfig as PageBuilderConfig|undefined;
    if(existing?.sections?.length) setSections(existing.sections);
    if(existing?.accentColor)               setStyle(p=>({...p,accentColor:existing.accentColor}));
    if(existing?.bgColor)                   setStyle(p=>({...p,bgColor:existing.bgColor}));
    if(existing?.headingFont)               setStyle(p=>({...p,headingFont:existing.headingFont}));
    if(existing?.bodyFont)                  setStyle(p=>({...p,bodyFont:existing.bodyFont}));
    if(existing?.borderRadius!==undefined)  setStyle(p=>({...p,borderRadius:existing.borderRadius}));
    if(existing?.buttonStyle)               setStyle(p=>({...p,buttonStyle:existing.buttonStyle}));
    if(existing?.density)                   setStyle(p=>({...p,density:existing.density}));
    if(existing?.brandKit)                  setStyle(p=>({...p,brandKit:existing.brandKit}));
  },[selectedTenant]);

  // Dirty tracking
  useEffect(()=>{
    if(isFirstLoad.current){isFirstLoad.current=false;return;}
    setIsDirty(true);
  },[sections,style]);

  // History
  const pushHistory=useCallback(()=>{
    historyRef.current=[...historyRef.current.slice(-19),{sections:JSON.parse(JSON.stringify(sections)),style:{...style}}];
    futureRef.current=[]; setCanUndo(true); setCanRedo(false);
  },[sections,style]);

  const undo=useCallback(()=>{
    if(!historyRef.current.length) return;
    const last=historyRef.current[historyRef.current.length-1];
    futureRef.current=[{sections,style},...futureRef.current.slice(0,19)];
    historyRef.current=historyRef.current.slice(0,-1);
    setSections(last.sections); setStyle(last.style);
    setCanUndo(historyRef.current.length>0); setCanRedo(true);
  },[sections,style]);

  const redo=useCallback(()=>{
    if(!futureRef.current.length) return;
    const next=futureRef.current[0];
    historyRef.current=[...historyRef.current.slice(-19),{sections,style}];
    futureRef.current=futureRef.current.slice(1);
    setSections(next.sections); setStyle(next.style);
    setCanUndo(true); setCanRedo(futureRef.current.length>0);
  },[sections,style]);

  // Keyboard shortcuts
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}
      if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();handleSave();}
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[undo,redo]);

  // Live preview sync
  useEffect(()=>{
    const timer=setTimeout(()=>{
      previewRef.current?.contentWindow?.postMessage({type:'CLARITY_PREVIEW',sections,style},window.location.origin);
    },400);
    return()=>clearTimeout(timer);
  },[sections,style]);

  // Listen for click-to-edit messages from iframe
  useEffect(()=>{
    const handler=(e:MessageEvent)=>{
      if(e.data?.type==='EDIT_SECTION'){
        setSelectedId(e.data.sectionId);
        setActivePanel('sections');
        setShowLibrary(false);
        setHighlightedField(null);
      }
      if(e.data?.type==='EDIT_FIELD'){
        setSelectedId(e.data.sectionId);
        setActivePanel('sections');
        setShowLibrary(false);
        setHighlightedField(e.data.fieldKey);
        // Auto-clear highlight after 4s
        setTimeout(()=>setHighlightedField(null),4000);
      }
    };
    window.addEventListener('message',handler);
    return()=>window.removeEventListener('message',handler);
  },[]);

  // Derived
  const enabledSections=useMemo(()=>sections.filter(s=>s.enabled).sort((a,b)=>a.order-b.order),[sections]);
  const disabledSections=useMemo(()=>sections.filter(s=>!s.enabled),[sections]);
  const selectedSection=useMemo(()=>sections.find(s=>s.id===selectedId),[sections,selectedId]);

  // Mutations
  const moveUp=(id:string)=>{
    pushHistory();
    setSections(prev=>{
      const en=prev.filter(s=>s.enabled).sort((a,b)=>a.order-b.order);
      const idx=en.findIndex(s=>s.id===id); if(idx<=0)return prev;
      const[a,b]=[en[idx-1],en[idx]];
      return prev.map(s=>s.id===a.id?{...s,order:b.order}:s.id===b.id?{...s,order:a.order}:s);
    });
  };
  const moveDown=(id:string)=>{
    pushHistory();
    setSections(prev=>{
      const en=prev.filter(s=>s.enabled).sort((a,b)=>a.order-b.order);
      const idx=en.findIndex(s=>s.id===id); if(idx>=en.length-1)return prev;
      const[a,b]=[en[idx],en[idx+1]];
      return prev.map(s=>s.id===a.id?{...s,order:b.order}:s.id===b.id?{...s,order:a.order}:s);
    });
  };
  const hideSection=(id:string)=>{pushHistory();setSections(prev=>prev.map(s=>s.id===id?{...s,enabled:false}:s));if(selectedId===id)setSelectedId(null);};
  const addSection=(id:string)=>{
    pushHistory();
    const maxOrder=enabledSections.reduce((m,s)=>Math.max(m,s.order),0);
    setSections(prev=>prev.map(s=>s.id===id?{...s,enabled:true,order:maxOrder+1}:s));
    setSelectedId(id); setShowLibrary(false);
  };
  const duplicateSection=(id:string)=>{
    pushHistory();
    const src=sections.find(s=>s.id===id); if(!src)return;
    const maxOrder=enabledSections.reduce((m,s)=>Math.max(m,s.order),0);
    const newSection:PageSection={...src,id:`${src.type}-${generateId()}`,order:maxOrder+1};
    setSections(prev=>[...prev,newSection]); setSelectedId(newSection.id);
  };
  const updateField=(sectionId:string,key:string,value:any)=>{
    setSections(prev=>prev.map(s=>s.id===sectionId?{...s,config:{...s.config,[key]:value}}:s));
  };
  const updateAnimation=(sectionId:string,animConfig:AnimConfig)=>{
    setSections(prev=>prev.map(s=>s.id===sectionId?{...s,config:{...s.config,_animation:animConfig}}:s));
  };
  const updateStyle=(updates:Partial<typeof style>)=>{pushHistory();setStyle(p=>({...p,...updates}));};
  const applyBrandKit=(kit:typeof BRAND_KITS[0])=>{
    pushHistory();
    setStyle(p=>({...p,accentColor:kit.accentColor,bgColor:kit.bgColor,headingFont:kit.headingFont,bodyFont:kit.bodyFont,borderRadius:kit.borderRadius,brandKit:kit.id}));
    toast({title:`${kit.label} brand kit applied`});
  };

  const handleSave=async()=>{
    if(!selectedTenant||!firestore)return;
    setIsSaving(true);
    try{
      const config:PageBuilderConfig={sections,...style};
      await updateDoc(doc(firestore,'tenants',selectedTenant.id),{'bookingPageSettings.pageConfig':config});
      setIsDirty(false);
      toast({title:'Page saved',description:'Your booking page is updated and live.'});
    }catch{toast({variant:'destructive',title:'Save failed',description:'Please try again.'});}
    finally{setIsSaving(false);}
  };

  const headingFontDef=FONTS.find(f=>f.id===style.headingFont);
  const bodyFontDef=FONTS.find(f=>f.id===style.bodyFont);
  const previewUrl=selectedTenant?`/book/${selectedTenant.id}`:null;
  const selectedDef=selectedSection?SECTION_DEFS[selectedSection.type as SectionType]:null;

  return(
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50/50">
      <AppHeader title="Page Builder"/>

      {/* Unsaved banner */}
      {isDirty&&(
        <div className="flex items-center justify-between gap-4 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <div className="flex items-center gap-2 text-amber-700"><AlertCircle className="w-3.5 h-3.5 shrink-0"/><span className="text-[10px] font-black uppercase tracking-widest">Unsaved changes</span></div>
          <div className="flex items-center gap-2">
            <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 disabled:opacity-30 transition-all" title="Undo (⌘Z)"><Undo2 className="w-3.5 h-3.5"/></button>
            <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 disabled:opacity-30 transition-all" title="Redo (⌘⇧Z)"><Redo2 className="w-3.5 h-3.5"/></button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-7 px-4 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md shadow-primary/20">
              {isSaving?<Loader className="animate-spin w-3 h-3"/>:<><Save className="w-3 h-3 mr-1.5"/>Save now</>}
            </Button>
          </div>
        </div>
      )}

      {/* Mobile preview button */}
      <div className="lg:hidden shrink-0 px-3 py-2 border-b bg-white flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Page Builder</span>
        <button onClick={()=>setMobilePreviewOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest">
          <Eye className="w-3.5 h-3.5"/>Preview
        </button>
      </div>

      {/* Mobile preview dialog */}
      <Dialog open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen}>
        <DialogContent className="max-w-full w-full h-[90vh] p-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[10px] font-black uppercase tracking-widest">Live Preview</DialogTitle>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                <button onClick={()=>setPreviewMode('desktop')} className={cn('p-1.5 rounded-md transition-all',previewMode==='desktop'?'bg-white shadow-sm':'text-slate-400')}><Monitor className="w-3.5 h-3.5"/></button>
                <button onClick={()=>setPreviewMode('mobile')} className={cn('p-1.5 rounded-md transition-all',previewMode==='mobile'?'bg-white shadow-sm':'text-slate-400')}><Smartphone className="w-3.5 h-3.5"/></button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 p-4 bg-slate-100 flex items-center justify-center overflow-hidden">
            {previewUrl?(
              <div className={cn('h-full transition-all duration-300',previewMode==='mobile'?'w-[390px] max-w-full':'w-full')}>
                <iframe key={`mobile-${previewKey}`} src={previewUrl} className={cn('w-full h-full border-0 bg-white',previewMode==='mobile'?'rounded-[2rem] shadow-2xl ring-8 ring-slate-800':'rounded-2xl shadow-xl')} title="Mobile booking preview"/>
              </div>
            ):<p className="text-[10px] font-black uppercase tracking-widest text-slate-300">No tenant selected</p>}
          </div>
        </DialogContent>
      </Dialog>

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full">

          {/* ── Left sidebar ── */}
          <div className="w-72 h-full flex flex-col border-r bg-white shrink-0">
            <div className="p-3 border-b flex items-center gap-2 shrink-0">
              <div className="flex gap-1 flex-1">
                <button onClick={()=>{setShowLibrary(false);setActivePanel('sections');}} className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',activePanel==='sections'&&!showLibrary?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-muted')}>Sections</button>
                <button onClick={()=>{setShowLibrary(false);setActivePanel('style');}} className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',activePanel==='style'?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-muted')}>Style</button>
              </div>
              {activePanel==='sections'&&<button onClick={()=>setShowLibrary(!showLibrary)} className="w-7 h-7 rounded-lg border-2 border-primary/20 bg-primary/5 flex items-center justify-center text-primary hover:bg-primary/10 transition-all">{showLibrary?<X className="w-3.5 h-3.5"/>:<Plus className="w-3.5 h-3.5"/>}</button>}
            </div>

            <ScrollArea className="flex-1 min-h-0 p-3">
              {/* Active sections */}
              {activePanel==='sections'&&!showLibrary&&(
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Active sections</p>
                  {enabledSections.map((s,idx)=>(
                    <SectionListItem key={s.id} section={s} isSelected={selectedId===s.id} isFirst={idx===0} isLast={idx===enabledSections.length-1}
                      onSelect={()=>{setSelectedId(s.id);setActivePanel('sections');setHighlightedField(null);}}
                      onMoveUp={()=>moveUp(s.id)} onMoveDown={()=>moveDown(s.id)} onHide={()=>hideSection(s.id)} onDuplicate={()=>duplicateSection(s.id)}/>
                  ))}
                  {enabledSections.length===0&&<div className="py-8 text-center text-muted-foreground/40 text-xs font-black uppercase tracking-widest">No active sections</div>}
                </div>
              )}

              {/* Library */}
              {activePanel==='sections'&&showLibrary&&(
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Add sections</p>
                  {disabledSections.length===0?<div className="py-8 text-center text-muted-foreground/40 text-xs font-black uppercase tracking-widest">All sections active</div>:disabledSections.map(s=><LibraryItem key={s.id} section={s} onAdd={()=>addSection(s.id)}/>)}
                </div>
              )}

              {/* Style panel */}
              {activePanel==='style'&&(
                <div className="space-y-6">
                  <div className="flex gap-1 flex-wrap">
                    {(['kits','colors','fonts','spacing'] as const).map(t=>(
                      <button key={t} onClick={()=>setStyleTab(t)} className={cn('px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',styleTab===t?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-muted')}>{t}</button>
                    ))}
                  </div>
                  {styleTab==='kits'&&<div className="space-y-3"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Brand kits</p><BrandKitPicker style={style} onApply={applyBrandKit}/></div>}
                  {styleTab==='colors'&&(
                    <div className="space-y-5">
                      <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Accent color</p><div className="flex items-center gap-2"><input type="color" value={style.accentColor} onChange={e=>updateStyle({accentColor:e.target.value,brandKit:null})} className="w-10 h-10 rounded-xl border-2 cursor-pointer p-0.5"/><Input value={style.accentColor} onChange={e=>/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)&&updateStyle({accentColor:e.target.value,brandKit:null})} className="h-10 rounded-xl border-2 font-mono text-xs w-28" maxLength={7}/></div></div>
                      <Separator className="border-dashed"/>
                      <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Background</p><div className="flex items-center gap-2"><input type="color" value={style.bgColor} onChange={e=>updateStyle({bgColor:e.target.value,brandKit:null})} className="w-10 h-10 rounded-xl border-2 cursor-pointer p-0.5"/><Input value={style.bgColor} onChange={e=>/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)&&updateStyle({bgColor:e.target.value,brandKit:null})} className="h-10 rounded-xl border-2 font-mono text-xs w-28" maxLength={7}/></div></div>
                      <Separator className="border-dashed"/>
                      <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Button style</p><div className="grid grid-cols-2 gap-1.5">{(['filled','outline','ghost','pill'] as const).map(bs=><button key={bs} onClick={()=>updateStyle({buttonStyle:bs})} className={cn('py-2 px-3 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all',style.buttonStyle===bs?'border-primary/40 bg-primary/5 text-primary':'border-border text-muted-foreground hover:border-primary/20')}>{bs}</button>)}</div></div>
                    </div>
                  )}
                  {styleTab==='fonts'&&(
                    <div className="space-y-5">
                      <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Heading font</p><FontPicker value={style.headingFont} onChange={v=>updateStyle({headingFont:v,brandKit:null})}/></div>
                      <Separator className="border-dashed"/>
                      <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Body font</p><FontPicker value={style.bodyFont} onChange={v=>updateStyle({bodyFont:v,brandKit:null})}/></div>
                    </div>
                  )}
                  {styleTab==='spacing'&&(
                    <div className="space-y-5">
                      <div className="space-y-3"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Corner roundness</p><div className="space-y-2"><div className="flex items-center justify-between"><span className="text-[9px] text-muted-foreground">Sharp</span><span className="text-[9px] font-bold text-muted-foreground">{style.borderRadius}px</span><span className="text-[9px] text-muted-foreground">Pill</span></div><Slider value={[style.borderRadius]} onValueChange={([v])=>updateStyle({borderRadius:v})} min={0} max={32} step={2} className="w-full"/><div className="flex gap-2 justify-center mt-1">{[0,6,12,24,32].map(r=><div key={r} className="w-8 h-8 bg-primary/20 border-2 border-primary/30" style={{borderRadius:r}}/>)}</div></div></div>
                      <Separator className="border-dashed"/>
                      <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Section spacing</p><div className="grid grid-cols-3 gap-1.5">{(['compact','balanced','airy'] as const).map(d=><button key={d} onClick={()=>updateStyle({density:d})} className={cn('py-2 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all',style.density===d?'border-primary/40 bg-primary/5 text-primary':'border-border text-muted-foreground hover:border-primary/20')}>{d}</button>)}</div></div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t bg-white space-y-2 shrink-0">
              <div className="flex gap-1.5">
                <button onClick={undo} disabled={!canUndo} className="flex-1 h-8 rounded-xl border-2 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-30 hover:border-primary/20 transition-all"><Undo2 className="w-3 h-3"/>Undo</button>
                <button onClick={redo} disabled={!canRedo} className="flex-1 h-8 rounded-xl border-2 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-30 hover:border-primary/20 transition-all">Redo<Redo2 className="w-3 h-3"/></button>
              </div>
              {selectedTenant&&<a href={`/book/${selectedTenant.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full h-8 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"><Eye className="w-3.5 h-3.5"/>Open live page<ExternalLink className="w-3 h-3"/></a>}
              <Button onClick={handleSave} disabled={isSaving} className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                {isSaving?<><Loader className="animate-spin w-3.5 h-3.5 mr-2"/>Saving...</>:<><Save className="w-3.5 h-3.5 mr-2"/>Save page</>}
              </Button>
            </div>
          </div>

          {/* ── Center: field editor ── */}
          <div className="w-80 xl:w-[420px] h-full flex flex-col border-r bg-white shrink-0">
            {selectedSection&&activePanel==='sections'?(
              <>
                <div className="p-4 border-b bg-white flex items-center gap-3 shrink-0">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{background:selectedDef!.color+'18'}}>
                    {React.createElement(selectedDef!.icon,{className:'w-4 h-4',style:{color:selectedDef!.color}})}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">{selectedDef!.label}</h2>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Content & configuration</p>
                  </div>
                  {highlightedField&&(
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"/>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Editing: {highlightedField}</span>
                    </div>
                  )}
                </div>

                <ScrollArea className="flex-1 min-h-0 p-4">
                  <div className="space-y-5">
                    {/* Animation picker — universal for all sections */}
                    <AnimationPicker
                      value={(selectedSection.config as any)._animation}
                      onChange={v=>updateAnimation(selectedSection.id,v)}
                    />

                    <Separator className="border-dashed"/>

                    {/* Layout picker */}
                    {selectedDef!.layouts&&selectedDef!.layouts.length>1&&(
                      <>
                        <LayoutPicker layouts={selectedDef!.layouts} value={selectedSection.config.layout??selectedDef!.layouts[0].id} onChange={val=>updateField(selectedSection.id,'layout',val)}/>
                        <Separator className="border-dashed"/>
                      </>
                    )}

                    {/* Content fields */}
                    {SECTION_DEFS[selectedSection.type as SectionType].fields.map(field=>(
                      <FieldRenderer key={field.k} field={field} value={selectedSection.config[field.k]??field.d} onChange={val=>updateField(selectedSection.id,field.k,val)} highlightedField={highlightedField}/>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ):activePanel==='style'?(
              <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="w-16 h-16 rounded-[1.5rem] bg-primary/10 flex items-center justify-center"><Palette className="w-8 h-8 text-primary"/></div>
                <div className="flex flex-col items-center gap-4 w-full">
                  <div style={{fontFamily:headingFontDef?.stack,color:style.accentColor,fontSize:'28px',fontWeight:300}}>{headingFontDef?.label}</div>
                  <div style={{fontFamily:bodyFontDef?.stack,color:'#64748b',fontSize:'14px'}}>Body — {bodyFontDef?.label}</div>
                  <div className="flex gap-2 mt-2"><div className="w-8 h-8 rounded-full" style={{background:style.accentColor}}/><div className="w-8 h-8 rounded-full" style={{background:style.bgColor,border:'2px solid #e2e8f0'}}/></div>
                  <div className="px-5 py-2 text-sm font-bold transition-all"
                       style={{background:style.buttonStyle==='filled'?style.accentColor:'transparent',color:style.buttonStyle==='filled'?'#fff':style.accentColor,border:style.buttonStyle==='ghost'?'none':`2px solid ${style.accentColor}`,borderRadius:style.buttonStyle==='pill'?999:style.borderRadius}}>
                    Book Now
                  </div>
                  <p className="text-[9px] text-muted-foreground/50 text-center">Adjust colors, fonts & spacing in the left panel</p>
                </div>
              </div>
            ):(
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                <div className="w-16 h-16 rounded-[1.5rem] bg-muted flex items-center justify-center"><Settings className="w-8 h-8 text-muted-foreground/40"/></div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900">Select a section</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 max-w-xs">Click any section in the left panel to edit its content</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-xs mt-1">
                  {enabledSections.slice(0,6).map(s=>{
                    const d=SECTION_DEFS[s.type as SectionType];
                    return<button key={s.id} onClick={()=>setSelectedId(s.id)} className="px-3 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all hover:shadow-md" style={{borderColor:d.color+'40',color:d.color,background:d.color+'0a'}}>{d.label}</button>;
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: live preview ── */}
          <div className="flex-1 min-w-0 h-full flex-col bg-slate-100 hidden lg:flex">
            <div className="h-12 px-4 border-b bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live Preview</span>
                {isDirty&&<Badge variant="secondary" className="text-[8px] font-black uppercase tracking-widest">Unsaved</Badge>}
                <span className="text-[9px] text-slate-300 font-bold hidden xl:block">· Hover sections to edit · Tap text to jump to field</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 p-1 bg-slate-100 rounded-lg">
                  <button onClick={()=>setPreviewMode('desktop')} className={cn('p-1.5 rounded-md transition-all',previewMode==='desktop'?'bg-white shadow-sm text-slate-900':'text-slate-400 hover:text-slate-600')} title="Desktop"><Monitor className="w-3.5 h-3.5"/></button>
                  <button onClick={()=>setPreviewMode('mobile')} className={cn('p-1.5 rounded-md transition-all',previewMode==='mobile'?'bg-white shadow-sm text-slate-900':'text-slate-400 hover:text-slate-600')} title="Mobile"><Smartphone className="w-3.5 h-3.5"/></button>
                </div>
                <button onClick={()=>setPreviewKey(k=>k+1)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all" title="Reload preview"><RefreshCw className="w-3.5 h-3.5"/></button>
                {previewUrl&&<a href={previewUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all" title="Open live"><ExternalLink className="w-3.5 h-3.5"/></a>}
              </div>
            </div>
            <div className="flex-1 min-h-0 p-6 overflow-hidden flex items-center justify-center">
              {previewUrl?(
                previewMode==='desktop'?(
                  <iframe key={previewKey} ref={previewRef} src={previewUrl} className="w-full h-full border-0 bg-white rounded-2xl shadow-xl" title="Booking page preview"/>
                ):(
                  <div className="h-full w-[390px] max-w-full flex-shrink-0">
                    <iframe key={previewKey} ref={previewRef} src={previewUrl} className="w-full h-full border-0 bg-white rounded-[2.5rem] shadow-2xl ring-8 ring-slate-800" title="Booking page preview"/>
                  </div>
                )
              ):(
                <div className="text-center space-y-3"><Eye className="w-10 h-10 text-slate-200 mx-auto"/><p className="text-[10px] font-black uppercase tracking-widest text-slate-300">No tenant selected</p></div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}