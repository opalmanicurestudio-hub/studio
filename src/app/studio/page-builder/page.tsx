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

import { ImageUpload } from '@/components/shared/ImageUpload';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { doc, updateDoc, getDocs, collection } from 'firebase/firestore';
import {
  StyleConfig, PageData,
  DS as PreviewDS, ac as pac, hf as phf, bf as pbf,
  ANIM_CSS, injectFonts as previewInjectFonts,
  SectionWrapper, SectionRenderer, Footer as PreviewFooter,
  buildDefaults as previewBuildDefaults,
} from '@/lib/booking-sections';
import { useTenant } from '@/context/TenantContext';
import {
  Navigation, ImageIcon, Award, Scissors, Users, Star,
  LayoutDashboard, RotateCcw, Crown, Package, Gift,
  FileText, Sparkles, HelpCircle, Shield, MapPin,
  Calendar, Share2, BookOpen, Camera, Clock,
  ChevronUp, ChevronDown, Plus, Eye, EyeOff, Save, ExternalLink,
  Loader, Check, Palette, Settings, X, Monitor, Smartphone,
  RefreshCw, AlertCircle, Copy, GripVertical,
  Instagram, Facebook, Twitter, Youtube, Globe, Music2,
  Linkedin, Phone, Mail,
  AtSign, Hash, Layers, Undo2, Redo2,
  ShieldCheck, Heart, Zap, Coffee, Leaf, Flame,
  AlertTriangle, Info, Ban, Clock3, CreditCard, BadgeCheck,
  ArrowLeftRight, Wand2, ChevronRight,
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

interface SectionField { k: string; t: FieldType; l: string; d: any; opts?: string[]; min?: number; max?: number; step?: number; }
interface SectionLayoutOption { id: string; label: string; preview: string; }
interface SectionDef { label: string; icon: React.ElementType; color: string; fields: SectionField[]; layouts?: SectionLayoutOption[]; }
interface PolicyItem { id: string; icon: string; title: string; body: string; }
interface SocialLink { platform: string; url: string; }
interface GalleryImage { id: string; url: string; caption?: string; category?: string; }
interface BeforeAfterPair { id: string; beforeUrl: string; afterUrl: string; caption?: string; }
interface AnimConfig { type: string; speed: number; }

const ANIM_TYPES = [
  { id: 'fade-up',    label: 'Fade Up',    emoji: '↑' },
  { id: 'fade-in',    label: 'Fade In',    emoji: '○' },
  { id: 'slide-left', label: 'Slide Left', emoji: '←' },
  { id: 'slide-right',label: 'Slide Right',emoji: '→' },
  { id: 'scale-up',   label: 'Scale Up',   emoji: '⊕' },
  { id: 'zoom-in',    label: 'Zoom In',    emoji: '🔍' },
  { id: 'none',       label: 'None',       emoji: '—' },
];

const GFONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&' +
  'family=Playfair+Display:wght@400;700&family=Lora:wght@400;600&' +
  'family=Merriweather:wght@300;400;700&family=EB+Garamond:wght@400;600&' +
  'family=Libre+Baskerville:wght@400;700&family=DM+Serif+Display&' +
  'family=Domine:wght@400;700&family=Space+Grotesk:wght@300;400;700&' +
  'family=Josefin+Sans:wght@300;400;700&family=Raleway:wght@300;400;700&' +
  'family=Montserrat:wght@300;400;700&family=Nunito:wght@300;400;700&' +
  'family=Poppins:wght@300;400;700&family=Outfit:wght@300;400;700&' +
  'family=DM+Sans:wght@300;400;700&family=Inter:wght@300;400;700&' +
  'family=Figtree:wght@300;400;700&family=Bebas+Neue&' +
  'family=Oswald:wght@300;400;700&family=Anton&family=Righteous&' +
  'family=Abril+Fatface&family=Pacifico&family=Dancing+Script:wght@400;700&' +
  'family=Great+Vibes&family=JetBrains+Mono:wght@400;700&' +
  'family=Space+Mono:wght@400;700&display=swap';

function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById('pb-gfonts')) return;
    const pre = document.createElement('link'); pre.rel = 'preconnect'; pre.href = 'https://fonts.googleapis.com'; document.head.appendChild(pre);
    const pre2 = document.createElement('link'); pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous'; document.head.appendChild(pre2);
    const link = document.createElement('link'); link.id = 'pb-gfonts'; link.rel = 'stylesheet'; link.href = GFONTS_HREF; document.head.appendChild(link);
  }, []);
}

const FONTS = [
  { id: 'cormorant',  label: 'Cormorant Garamond',  stack: "'Cormorant Garamond',Georgia,serif",       desc: 'Luxury serif',    group: 'Serif'   },
  { id: 'playfair',   label: 'Playfair Display',     stack: "'Playfair Display',Georgia,serif",         desc: 'Editorial serif', group: 'Serif'   },
  { id: 'lora',       label: 'Lora',                 stack: "'Lora',Georgia,serif",                     desc: 'Elegant serif',   group: 'Serif'   },
  { id: 'merriweather',label:'Merriweather',          stack: "'Merriweather',Georgia,serif",             desc: 'Classic serif',   group: 'Serif'   },
  { id: 'eb-garamond',label: 'EB Garamond',          stack: "'EB Garamond',Georgia,serif",              desc: 'Old-style serif', group: 'Serif'   },
  { id: 'libre-bask', label: 'Libre Baskerville',    stack: "'Libre Baskerville',Georgia,serif",        desc: 'Traditional',     group: 'Serif'   },
  { id: 'dm-serif',   label: 'DM Serif Display',     stack: "'DM Serif Display',Georgia,serif",         desc: 'Modern serif',    group: 'Serif'   },
  { id: 'domine',     label: 'Domine',               stack: "'Domine',Georgia,serif",                   desc: 'Humanist serif',  group: 'Serif'   },
  { id: 'space',      label: 'Space Grotesk',        stack: "'Space Grotesk',system-ui,sans-serif",     desc: 'Modern sans',     group: 'Sans'    },
  { id: 'josefin',    label: 'Josefin Sans',         stack: "'Josefin Sans',system-ui,sans-serif",      desc: 'Geometric sans',  group: 'Sans'    },
  { id: 'raleway',    label: 'Raleway',              stack: "'Raleway',system-ui,sans-serif",           desc: 'Elegant sans',    group: 'Sans'    },
  { id: 'montserrat', label: 'Montserrat',           stack: "'Montserrat',system-ui,sans-serif",        desc: 'Clean sans',      group: 'Sans'    },
  { id: 'nunito',     label: 'Nunito',               stack: "'Nunito',system-ui,sans-serif",            desc: 'Friendly rounded',group: 'Sans'    },
  { id: 'poppins',    label: 'Poppins',              stack: "'Poppins',system-ui,sans-serif",           desc: 'Geometric clean', group: 'Sans'    },
  { id: 'outfit',     label: 'Outfit',               stack: "'Outfit',system-ui,sans-serif",            desc: 'Minimalist sans', group: 'Sans'    },
  { id: 'dm-sans',    label: 'DM Sans',              stack: "'DM Sans',system-ui,sans-serif",           desc: 'Neutral sans',    group: 'Sans'    },
  { id: 'inter',      label: 'Inter',                stack: "'Inter',system-ui,sans-serif",             desc: 'UI-optimized',    group: 'Sans'    },
  { id: 'figtree',    label: 'Figtree',              stack: "'Figtree',system-ui,sans-serif",           desc: 'Contemporary',    group: 'Sans'    },
  { id: 'bebas',      label: 'Bebas Neue',           stack: "'Bebas Neue',Impact,sans-serif",           desc: 'Bold display',    group: 'Display' },
  { id: 'oswald',     label: 'Oswald',               stack: "'Oswald',system-ui,sans-serif",            desc: 'Condensed bold',  group: 'Display' },
  { id: 'anton',      label: 'Anton',                stack: "'Anton',Impact,sans-serif",                desc: 'Heavy impact',    group: 'Display' },
  { id: 'righteous',  label: 'Righteous',            stack: "'Righteous',system-ui,sans-serif",         desc: 'Bold retro',      group: 'Display' },
  { id: 'abril',      label: 'Abril Fatface',        stack: "'Abril Fatface',Georgia,serif",            desc: 'Fat display',     group: 'Display' },
  { id: 'pacifico',   label: 'Pacifico',             stack: "'Pacifico',cursive",                       desc: 'Casual script',   group: 'Display' },
  { id: 'dancing',    label: 'Dancing Script',       stack: "'Dancing Script',cursive",                 desc: 'Elegant script',  group: 'Display' },
  { id: 'great-vibes',label: 'Great Vibes',          stack: "'Great Vibes',cursive",                    desc: 'Luxury script',   group: 'Display' },
  { id: 'system',     label: 'System UI',            stack: 'system-ui,sans-serif',                     desc: 'Default clean',   group: 'System'  },
  { id: 'georgia',    label: 'Georgia',              stack: 'Georgia,serif',                            desc: 'Classic system',  group: 'System'  },
];
const FONT_GROUPS = ['Serif', 'Sans', 'Display', 'System'];

const BRAND_KITS = [
  { id: 'edition',   label: 'Édition',   accentColor: '#1a1a1a', bgColor: '#fafafa', headingFont: 'eb-garamond', bodyFont: 'josefin',     borderRadius: 2,  desc: 'Magazine editorial'   },
  { id: 'atelier',   label: 'Atelier',   accentColor: '#3d2b1f', bgColor: '#f9f6f1', headingFont: 'cormorant',   bodyFont: 'raleway',     borderRadius: 10, desc: 'Warm studio serif'    },
  { id: 'lumiere',   label: 'Lumière',   accentColor: '#1a1a1a', bgColor: '#ffffff', headingFont: 'playfair',    bodyFont: 'outfit',      borderRadius: 16, desc: 'Pure white editorial' },
  { id: 'grotesk',   label: 'Grotesk',   accentColor: '#111111', bgColor: '#f7f6f4', headingFont: 'josefin',     bodyFont: 'inter',       borderRadius: 0,  desc: 'Swiss grid minimal'   },
  { id: 'terroir',   label: 'Terroir',   accentColor: '#1c3a2e', bgColor: '#f5f2ed', headingFont: 'dm-serif',    bodyFont: 'dm-sans',     borderRadius: 12, desc: 'Organic linen'        },
  { id: 'encre',     label: 'Encre',     accentColor: '#111111', bgColor: '#f8f8f6', headingFont: 'lora',        bodyFont: 'space',       borderRadius: 6,  desc: 'Ink serif rules'      },
  { id: 'ardoise',   label: 'Ardoise',   accentColor: '#1a1a1a', bgColor: '#fefefe', headingFont: 'merriweather',bodyFont: 'figtree',     borderRadius: 6,  desc: 'Blueprint authority'  },
  { id: 'sable',     label: 'Sable',     accentColor: '#3a2c1e', bgColor: '#fdfcfa', headingFont: 'great-vibes', bodyFont: 'dm-sans',     borderRadius: 4,  desc: 'Script on linen'      },
  { id: 'manifesto', label: 'Manifesto', accentColor: '#111111', bgColor: '#f9f9f7', headingFont: 'bebas',       bodyFont: 'montserrat',  borderRadius: 2,  desc: 'Bold display slash'   },
  { id: 'matcha',    label: 'Matcha',    accentColor: '#1a3d30', bgColor: '#f6f9f7', headingFont: 'domine',      bodyFont: 'poppins',     borderRadius: 14, desc: 'Jade wellness'        },
  { id: 'petale',    label: 'Pétale',    accentColor: '#2d1a1a', bgColor: '#fff8f9', headingFont: 'dancing',     bodyFont: 'nunito',      borderRadius: 28, desc: 'Script blush orbs'   },
  { id: 'riviera',   label: 'Riviera',   accentColor: '#111111', bgColor: '#f9f8f6', headingFont: 'space',       bodyFont: 'figtree',     borderRadius: 5,  desc: 'Coastal precision'    },
];

const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: Instagram, placeholder: 'https://instagram.com/yourstudio', color: '#E1306C' },
  { id: 'facebook',  label: 'Facebook',  icon: Facebook,  placeholder: 'https://facebook.com/yourstudio', color: '#1877F2' },
  { id: 'tiktok',    label: 'TikTok',    icon: Music2,    placeholder: 'https://tiktok.com/@yourstudio',  color: '#000000' },
  { id: 'youtube',   label: 'YouTube',   icon: Youtube,   placeholder: 'https://youtube.com/@yourstudio', color: '#FF0000' },
  { id: 'twitter',   label: 'X/Twitter', icon: Twitter,   placeholder: 'https://x.com/yourstudio',       color: '#000000' },
  { id: 'pinterest', label: 'Pinterest', icon: Hash,      placeholder: 'https://pinterest.com/yourstudio',color: '#E60023' },
  { id: 'linkedin',  label: 'LinkedIn',  icon: Linkedin,  placeholder: 'https://linkedin.com/in/yourstudio',color:'#0A66C2'},
  { id: 'threads',   label: 'Threads',   icon: AtSign,    placeholder: 'https://threads.net/@yourstudio', color: '#000000' },
  { id: 'website',   label: 'Website',   icon: Globe,     placeholder: 'https://yourstudio.com',          color: '#334155' },
];

const POLICY_ICONS = [
  { id: 'shield',       icon: Shield,        label: 'Shield'  },
  { id: 'shield-check', icon: ShieldCheck,   label: 'Check'   },
  { id: 'clock',        icon: Clock,         label: 'Clock'   },
  { id: 'clock3',       icon: Clock3,        label: 'Alarm'   },
  { id: 'alert',        icon: AlertTriangle, label: 'Warning' },
  { id: 'ban',          icon: Ban,           label: 'No'      },
  { id: 'credit',       icon: CreditCard,    label: 'Payment' },
  { id: 'heart',        icon: Heart,         label: 'Heart'   },
  { id: 'badge',        icon: BadgeCheck,    label: 'Badge'   },
  { id: 'info',         icon: Info,          label: 'Info'    },
  { id: 'zap',          icon: Zap,           label: 'Zap'     },
  { id: 'leaf',         icon: Leaf,          label: 'Leaf'    },
  { id: 'coffee',       icon: Coffee,        label: 'Care'    },
  { id: 'flame',        icon: Flame,         label: 'Hot'     },
  { id: 'phone',        icon: Phone,         label: 'Phone'   },
  { id: 'mail',         icon: Mail,          label: 'Mail'    },
];

const SECTION_DEFS: Record<SectionType, SectionDef> = {
  nav: { label: 'Navigation', icon: Navigation, color: '#3B6D11', fields: [
    { k: 'logoUrl',           t: 'image',  l: 'Logo (primary)',                      d: '' },
    { k: 'logoDarkUrl',       t: 'image',  l: 'Logo — dark variant (on light navs)', d: '' },
    { k: 'logoLightUrl',      t: 'image',  l: 'Logo — light variant (on dark navs)', d: '' },
    { k: 'logoText',          t: 'text',   l: 'Studio name (text fallback)',          d: 'Opal' },
    { k: 'logoMaxHeight',     t: 'select', l: 'Logo size',                            d: '40', opts: ['28','32','36','40','48','56'] },
    { k: 'ctaText',           t: 'text',   l: 'Button label',                         d: 'Book Now' },
    { k: 'ctaAction',         t: 'select', l: 'Button action',                        d: 'scroll-contact', opts: ['scroll-contact','scroll-services','booking','url'] },
    { k: 'ctaUrl',            t: 'text',   l: 'Custom URL (if url action)',            d: '' },
    { k: 'showLinks',         t: 'toggle', l: 'Show nav links',                        d: true },
    { k: 'sticky',            t: 'toggle', l: 'Sticky nav',                            d: true },
    { k: 'navBgColor',        t: 'color',  l: 'Nav bar color (blank = default white)', d: '' },
    { k: 'drawerIconStyle',   t: 'select', l: 'Drawer icon style',                    d: 'hamburger', opts: ['hamburger','minimal','bold','dots','grid'] },
    { k: 'transparent',       t: 'toggle', l: 'Start transparent over hero',           d: false },
    { k: 'transparentScroll', t: 'toggle', l: 'Become solid on scroll',                d: true },
    { k: 'navTheme',          t: 'select', l: 'Nav text color',                        d: 'auto', opts: ['auto','light','dark'] },
    { k: 'socialLinks',       t: 'social-links', l: 'Social icons in nav',             d: [] },
    { k: 'showQuickBook',     t: 'toggle', l: 'Show Quick Book in drawer',             d: true },
    { k: 'quickBookLimit',    t: 'select', l: 'Max services shown',                    d: '6', opts: ['3','4','5','6','8','10'] },
  ], layouts: [
    { id: 'centered',   label: 'Centered',   preview: '[ logo · links · btn ]'       },
    { id: 'floating',   label: 'Floating',   preview: '( pill nav )'                 },
    { id: 'bold',       label: 'Bold',       preview: '[ LOGO ]\n[ links · btn ]'    },
    { id: 'split',      label: 'Split',      preview: '[ links | LOGO | links+btn ]' },
    { id: 'logo-top',   label: 'Logo Top',   preview: '[ LOGO ]\n[ links ]'          },
    { id: 'drawer',     label: 'Drawer',     preview: '[ logo · (≡) ]'               },
    { id: 'bottom-bar', label: 'Bottom Bar', preview: '[ ≡ ≡ ≡ ≡ | Book ]'          },
    { id: 'minimal',    label: 'Minimal',    preview: '[ logo · btn ]'               },
  ]},
  hero: { label: 'Hero', icon: ImageIcon, color: '#534AB7', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show headline',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show subheadline', d: true },
    { k: 'bgImage', t: 'image', l: 'Background image', d: '' }, { k: 'heroImage', t: 'image', l: 'Feature image (split/magazine)', d: '' },
    { k: 'overlayOpacity', t: 'range', l: 'Overlay opacity', d: 40, min: 0, max: 90, step: 5 },
    { k: 'headline', t: 'text', l: 'Headline', d: 'Book Your Experience' }, { k: 'subheadline', t: 'textarea', l: 'Subheadline', d: 'A sanctuary of craft, curated for those who appreciate the details.' },
    { k: 'ctaText', t: 'text', l: 'Primary button', d: 'Book a Session' }, { k: 'ctaAction', t: 'select', l: 'Primary action', d: 'booking', opts: ['booking','scroll-services','url'] },
    { k: 'showWalkIn', t: 'toggle', l: 'Show walk-in button', d: true }, { k: 'cta2Text', t: 'text', l: 'Walk-in label', d: 'Walk In Today' },
    { k: 'cta2Action', t: 'select', l: 'Walk-in action', d: 'scroll-contact', opts: ['booking','scroll-contact','scroll-services','url'] },
    { k: 'videoUrl', t: 'text', l: 'Background video URL', d: '' }, { k: 'showBadge', t: 'toggle', l: 'Show trust badge', d: false },
    { k: 'badgeText', t: 'text', l: 'Badge text', d: '⭐ 4.9 · 500+ clients' },
  ], layouts: [
    { id: 'centered',   label: 'Centered',       preview: '[ full image · centered text ]'    },
    { id: 'vogue',      label: 'Vogue Cover',     preview: '[ text | portrait photo ]'         },
    { id: 'immersive',  label: 'Immersive',       preview: '[ full-bleed · bottom editorial ]' },
    { id: 'oversized',  label: 'Oversized Type',  preview: 'GIANT HEADLINE\n─ subtext ─'       },
    { id: 'split',      label: 'Split',           preview: '[ text | image ]'                  },
    { id: 'editorial',  label: 'Editorial Grid',  preview: '[ portrait | GIANT TYPE ]'         },
    { id: 'dark',       label: 'Dark Luxury',     preview: '█▓▓ glow text on dark ▓▓█'         },
    { id: 'glass',      label: 'Glass Card',      preview: '[ image ] + ☐ glass card'          },
    { id: 'kinetic',    label: 'Kinetic Words',   preview: '[ w·o·r·d animate in ]'            },
    { id: 'layers',     label: 'Parallax Depth',  preview: '[ mouse-reactive 3D layers ]'      },
  ]},
  trust: { label: 'Trust Strip', icon: Award, color: '#854F0B', fields: [
    { k: 'stat1l', t: 'text', l: 'Stat 1 label', d: 'Happy clients' }, { k: 'stat1v', t: 'text', l: 'Stat 1 value', d: '500+' },
    { k: 'stat2l', t: 'text', l: 'Stat 2 label', d: 'Avg rating' },   { k: 'stat2v', t: 'text', l: 'Stat 2 value', d: '4.9' },
    { k: 'stat3l', t: 'text', l: 'Stat 3 label', d: 'Years open' },   { k: 'stat3v', t: 'text', l: 'Stat 3 value', d: '6' },
    { k: 'stat4l', t: 'text', l: 'Stat 4 label', d: 'Services' },     { k: 'stat4v', t: 'text', l: 'Stat 4 value', d: '20+' },
    { k: 'animate', t: 'toggle', l: 'Animate counters on scroll', d: true },
  ], layouts: [
    { id: 'strip',   label: 'Horizontal strip', preview: '[ stat | stat | stat | stat ]' },
    { id: 'cards',   label: 'Stat cards',       preview: '┌──┐┌──┐┌──┐┌──┐'             },
    { id: 'banner',  label: 'Dark banner',      preview: '▓[ stat | stat | stat ]▓'     },
    { id: 'ticker',  label: 'Scrolling ticker', preview: '→ stat · stat · stat →'        },
    { id: 'counter', label: 'Counter showcase', preview: '  ↑↑  ↑↑  ↑↑  ↑↑  '          },
  ]},
  services: { label: 'Services', icon: Scissors, color: '#185FA5', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Our Services' }, { k: 'subheading', t: 'text', l: 'Subheading', d: 'Handcrafted treatments for every occasion' },
    { k: 'ctaText', t: 'text', l: 'Book button text', d: 'Book this service' }, { k: 'ctaAction', t: 'select', l: 'Button action', d: 'booking', opts: ['booking','url'] },
    { k: 'columns', t: 'select', l: 'Columns', d: '2', opts: ['1','2','3'] }, { k: 'showPrices', t: 'toggle', l: 'Show prices', d: true },
    { k: 'showDuration', t: 'toggle', l: 'Show duration', d: true }, { k: 'showFilters', t: 'toggle', l: 'Category filter', d: false },
    { k: 'showDesc', t: 'toggle', l: 'Show descriptions', d: true }, { k: 'showImages', t: 'toggle', l: 'Show service images', d: false },
  ], layouts: [
    { id: 'cards',      label: 'Cards',           preview: '┌────┐ ┌────┐'                   },
    { id: 'carousel',   label: 'Carousel',        preview: '← [ card ] [ card ] →'           },
    { id: 'horizontal', label: 'Horizontal rows',  preview: '[ img | text ]\n[ text | img ]'  },
    { id: 'luxury',     label: 'Luxury list',      preview: '01  Service ··· $99  →'         },
    { id: 'magazine',   label: 'Editorial',        preview: '[ hero feature | sm sm sm ]'     },
    { id: 'masonry',    label: 'Masonry',          preview: '┌──┐ ┌───┐\n│  │ │   │'        },
    { id: 'list',       label: 'List',             preview: '┌──────────────┐\n│ name  $xx │' },
    { id: 'grid',       label: 'Grid',             preview: '┌──┬──┬──┐'                     },
  ]},
  team: { label: 'Team', icon: Users, color: '#0F6E56', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'The Artists' }, { k: 'subheading', t: 'text', l: 'Subheading', d: 'Expert hands for every style' },
    { k: 'showBio', t: 'toggle', l: 'Show bio', d: false }, { k: 'showSpecialties', t: 'toggle', l: 'Show specialties', d: true },
    { k: 'showBookButton', t: 'toggle', l: 'Book per artist', d: false }, { k: 'bookCta', t: 'text', l: 'Book button text', d: 'Book with me' },
    { k: 'hoverReveal', t: 'toggle', l: 'Hover reveal bio', d: true },
  ], layouts: [
    { id: 'circles',        label: 'Circle avatars',  preview: '  ◯   ◯   ◯'                   },
    { id: 'editorial',      label: 'Editorial cards', preview: '┌────┐ ┌────┐'                  },
    { id: 'row',            label: 'Horizontal row',  preview: '[ ◯ name ][ ◯ name ]'           },
    { id: 'grid',           label: 'Grid',            preview: '┌──┬──┬──┐'                     },
    { id: 'featured',       label: 'Featured artist', preview: '[ large lead ]\n◯ ◯ ◯ team'    },
    { id: 'minimal',        label: 'Minimal list',    preview: '— Name · Title'                  },
    { id: 'solo-hero',      label: 'Solo hero',       preview: '[ portrait band | info strip ]'  },
    { id: 'solo-card',      label: 'Solo card',       preview: '┌ mat frame ┐\n│ portrait  │'   },
    { id: 'solo-split',     label: 'Solo editorial',  preview: '[ photo | name + bio ]'          },
    { id: 'solo-cinematic', label: 'Solo cinematic',  preview: '█▓ full-bleed · name glow ▓█'   },
    { id: 'solo-magazine',  label: 'Solo magazine',   preview: '[ portrait | drop-cap · bio ]'   },
    { id: 'solo-spotlight', label: 'Solo spotlight',  preview: '  ◉ halo · name · skills · cta' },
  ]},
  reviews: { label: 'Reviews', icon: Star, color: '#993556', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'What Clients Say' }, { k: 'subheading', t: 'text', l: 'Subheading', d: 'Real words from real guests' },
    { k: 'showRating', t: 'toggle', l: 'Show star ratings', d: true }, { k: 'showPhotos', t: 'toggle', l: 'Show client photos', d: false },
    { k: 'rev1Name', t: 'text', l: 'Review 1 name', d: 'Sarah M.' }, { k: 'rev1Rating', t: 'range', l: 'Review 1 rating', d: 5, min: 1, max: 5, step: 1 }, { k: 'rev1Text', t: 'textarea', l: 'Review 1 text', d: 'Absolutely incredible experience.' },
    { k: 'rev2Name', t: 'text', l: 'Review 2 name', d: 'Jessica T.' }, { k: 'rev2Rating', t: 'range', l: 'Review 2 rating', d: 5, min: 1, max: 5, step: 1 }, { k: 'rev2Text', t: 'textarea', l: 'Review 2 text', d: 'Every visit exceeds my expectations.' },
    { k: 'rev3Name', t: 'text', l: 'Review 3 name', d: 'Priya K.' }, { k: 'rev3Rating', t: 'range', l: 'Review 3 rating', d: 5, min: 1, max: 5, step: 1 }, { k: 'rev3Text', t: 'textarea', l: 'Review 3 text', d: 'Luxurious yet so welcoming.' },
  ], layouts: [
    { id: 'grid',     label: 'Grid',         preview: '┌────┐ ┌────┐'  },
    { id: 'carousel', label: 'Carousel',     preview: '← [ review ] →' },
    { id: 'quotes',   label: 'Large quotes', preview: '" quote text "' },
  ]},
  gallery: { label: 'Portfolio Gallery', icon: LayoutDashboard, color: '#534AB7', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Our Work' }, { k: 'subheading', t: 'text', l: 'Subheading', d: 'Every set, a canvas' },
    { k: 'images', t: 'image-array', l: 'Gallery images (max 24)', d: [] }, { k: 'showCaptions', t: 'toggle', l: 'Show captions', d: false },
    { k: 'lightbox', t: 'toggle', l: 'Lightbox on click', d: true }, { k: 'columns', t: 'select', l: 'Columns', d: '3', opts: ['2','3','4'] },
    { k: 'hoverEffect', t: 'select', l: 'Hover effect', d: 'zoom', opts: ['zoom','fade','none'] },
  ], layouts: [
    { id: 'masonry',   label: 'Masonry',      preview: '┌──┐ ┌────┐\n│  │ │    │' },
    { id: 'grid',      label: 'Uniform grid', preview: '┌──┬──┬──┐'               },
    { id: 'carousel',  label: 'Carousel',     preview: '← [ img ] →'               },
    { id: 'bento',     label: 'Bento',        preview: '┌───┬──┐\n├──┬┴──┤'      },
    { id: 'spotlight', label: 'Spotlight',    preview: '[ HERO ]\n─ grid ─'        },
    { id: 'polaroid',  label: 'Polaroid',     preview: '⌐─╗  ⌐─╗\n╚─╝  ╚─╝'    },
    { id: 'filmstrip', label: 'Filmstrip',    preview: '▐███▌▐███▌▐███▌'          },
  ]},
  beforeafter: { label: 'Before / After', icon: RotateCcw, color: '#0F6E56', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Transformations' }, { k: 'subheading', t: 'text', l: 'Subheading', d: 'See the difference we make' },
    { k: 'pairs', t: 'beforeafter-pairs', l: 'Before / After pairs', d: [] }, { k: 'sliderColor', t: 'color', l: 'Slider handle color', d: '#000000' },
    { k: 'showLabels', t: 'toggle', l: 'Show Before/After labels', d: true },
  ], layouts: [
    { id: 'slider',   label: 'Drag slider',   preview: '[ before ←→ after ]' },
    { id: 'side',     label: 'Side by side',  preview: '[ before ] [ after ]' },
    { id: 'stack',    label: 'Stacked hover', preview: '[ hover to reveal ]'   },
    { id: 'carousel', label: 'Carousel pairs',preview: '← [ B/A pair ] →'     },
  ]},
  memberships: { label: 'Memberships', icon: Crown, color: '#534AB7', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Join the Club' }, { k: 'ctaText', t: 'text', l: 'Button text', d: 'Get started' },
    { k: 'ctaAction', t: 'select', l: 'Button action', d: 'scroll-contact', opts: ['booking','scroll-contact','url'] },
    { k: 'plan1Name', t: 'text', l: 'Tier 1 name', d: 'Essential' }, { k: 'plan1Price', t: 'text', l: 'Tier 1 price', d: '$89' },
    { k: 'plan1Features', t: 'textarea', l: 'Tier 1 features (one per line)', d: '2 services/month\nPriority booking\n10% off retail' },
    { k: 'plan2Name', t: 'text', l: 'Tier 2 name', d: 'Luxe' }, { k: 'plan2Price', t: 'text', l: 'Tier 2 price', d: '$149' },
    { k: 'plan2Features', t: 'textarea', l: 'Tier 2 features (one per line)', d: '4 services/month\nVIP priority\n20% off retail\nFree upgrades' },
    { k: 'plan2Featured', t: 'toggle', l: 'Mark as featured', d: true },
    { k: 'plan3Name', t: 'text', l: 'Tier 3 name', d: 'Elite' }, { k: 'plan3Price', t: 'text', l: 'Tier 3 price', d: '$249' },
    { k: 'plan3Features', t: 'textarea', l: 'Tier 3 features (one per line)', d: 'Unlimited services\nDedicated artist\n30% off retail\nExclusive events' },
  ], layouts: [
    { id: 'cards',   label: 'Pricing cards', preview: '┌────┐ ┌────┐ ┌────┐' },
    { id: 'minimal', label: 'Minimal list',  preview: '── Tier · price ──'    },
  ]},
  packages: { label: 'Packages', icon: Package, color: '#185FA5', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Prepaid Sessions' }, { k: 'ctaText', t: 'text', l: 'Button text', d: 'Buy package' },
    { k: 'ctaAction', t: 'select', l: 'Button action', d: 'scroll-contact', opts: ['booking','scroll-contact','url'] },
    { k: 'showExpiry', t: 'toggle', l: 'Show expiry', d: true }, { k: 'showSavings', t: 'toggle', l: 'Show savings %', d: true },
    { k: 'pkg1Name', t: 'text', l: 'Package 1 name', d: '5-Pack' }, { k: 'pkg1Price', t: 'text', l: 'Package 1 price', d: '$199' }, { k: 'pkg1Saving', t: 'text', l: 'Package 1 saving', d: 'Save 15%' },
    { k: 'pkg2Name', t: 'text', l: 'Package 2 name', d: '10-Pack' }, { k: 'pkg2Price', t: 'text', l: 'Package 2 price', d: '$349' }, { k: 'pkg2Saving', t: 'text', l: 'Package 2 saving', d: 'Save 25%' },
    { k: 'pkg3Name', t: 'text', l: 'Package 3 name', d: '20-Pack' }, { k: 'pkg3Price', t: 'text', l: 'Package 3 price', d: '$599' }, { k: 'pkg3Saving', t: 'text', l: 'Package 3 saving', d: 'Save 35%' },
  ], layouts: [
    { id: 'cards', label: 'Cards', preview: '┌────┐ ┌────┐' },
    { id: 'list',  label: 'List',  preview: '── 5-pack · $xxx ──' },
  ]},
  giftcards: { label: 'Gift Cards', icon: Gift, color: '#993556', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Give the Gift of Beauty' },
    { k: 'bgImage', t: 'image', l: 'Background / card image', d: '' },
    { k: 'ctaText', t: 'text', l: 'Button text', d: 'Send a Gift Card' },
    { k: 'ctaAction', t: 'select', l: 'Button action', d: 'booking', opts: ['booking','url'] },
    { k: 'amounts', t: 'text', l: 'Preset amounts (comma-sep)', d: '25,50,75,100' },
  ], layouts: [
    { id: 'hero',    label: 'Hero style', preview: '[ bg image | text + cta ]' },
    { id: 'minimal', label: 'Minimal',    preview: '[ amounts ] [buy]'          },
  ]},
  quote: { label: 'Quote Request', icon: FileText, color: '#3B6D11', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading',    t: 'text',     l: 'Heading',          d: 'Planning Something Unforgettable?' },
    { k: 'subheading', t: 'textarea', l: 'Description',       d: 'Planning a wedding, bridal party, or corporate event?' },
    { k: 'ctaText',    t: 'text',     l: 'Button text',       d: 'Request a Custom Quote' },
    { k: 'ctaNote',    t: 'text',     l: 'Below button note', d: 'We respond within 24 hours' },
    { k: 'ctaAction',  t: 'select',   l: 'Button action',     d: 'booking', opts: ['booking','url'] },
    { k: 'bgImage',    t: 'image',    l: 'Background image',  d: '' },
    { k: 'overlayStyle', t: 'select', l: 'Image overlay style', d: 'dark', opts: ['dark','accent','none'] },
    { k: 'tags',       t: 'tag-list', l: 'Event types',       d: ['Bridal Parties','Corporate Events','Destination Services'] },
  ], layouts: [
    { id: 'cinematic', label: 'Cinematic dark',  preview: '█ ambient glow · glow CTA █'       },
    { id: 'editorial', label: 'Editorial',       preview: 'GIANT TYPE | stacked tag cards'    },
    { id: 'luxury',    label: 'Luxury split',    preview: '[ color panel | event list + CTA ]'},
    { id: 'showcase',  label: 'Event showcase',  preview: '┌──┐┌──┐┌──┐\n─── bold CTA ───'  },
    { id: 'centered',  label: 'Centered overlay',preview: '[ bg · heading · tags · cta ]'     },
    { id: 'split',     label: 'Split',           preview: '[ text + tags | image/cards ]'     },
    { id: 'banner',    label: 'Banner',          preview: '▓[ heading · cta ]▓'               },
  ]},
  newclient: { label: 'New Client Offer', icon: Sparkles, color: '#854F0B', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Heading', d: 'First Visit Special' }, { k: 'offerText', t: 'text', l: 'Offer description', d: '20% off your first appointment' },
    { k: 'ctaText', t: 'text', l: 'Button text', d: 'Claim Offer' }, { k: 'ctaAction', t: 'select', l: 'Button action', d: 'booking', opts: ['booking','url'] },
    { k: 'bgImage', t: 'image', l: 'Background image', d: '' }, { k: 'expiryText', t: 'text', l: 'Expiry text', d: 'Limited time only' },
  ], layouts: [
    { id: 'banner',    label: 'Banner',     preview: '[ offer · highlight · cta ]' },
    { id: 'fullbleed', label: 'Full bleed', preview: '[ bg img · overlay · text ]' },
  ]},
  faq: { label: 'FAQ', icon: HelpCircle, color: '#185FA5', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Common Questions' },
    { k: 'q1', t: 'text', l: 'Question 1', d: 'How do I book an appointment?' }, { k: 'a1', t: 'textarea', l: 'Answer 1', d: 'Use the Book Now button above or select any service.' },
    { k: 'q2', t: 'text', l: 'Question 2', d: 'What is your cancellation policy?' }, { k: 'a2', t: 'textarea', l: 'Answer 2', d: 'We require 24 hours notice to avoid a cancellation fee.' },
    { k: 'q3', t: 'text', l: 'Question 3', d: 'Do you accept walk-ins?' }, { k: 'a3', t: 'textarea', l: 'Answer 3', d: 'Yes! Walk-ins welcome based on availability.' },
    { k: 'q4', t: 'text', l: 'Question 4', d: 'Do you offer gift cards?' }, { k: 'a4', t: 'textarea', l: 'Answer 4', d: 'Absolutely — gift cards available in any amount.' },
    { k: 'q5', t: 'text', l: 'Question 5 (optional)', d: '' }, { k: 'a5', t: 'textarea', l: 'Answer 5', d: '' },
    { k: 'q6', t: 'text', l: 'Question 6 (optional)', d: '' }, { k: 'a6', t: 'textarea', l: 'Answer 6', d: '' },
  ], layouts: [
    { id: 'accordion', label: 'Accordion',    preview: '▶ Question 1\n▶ Question 2'  },
    { id: 'two-col',   label: 'Two columns',  preview: '┌──┬──┐\n│Q │Q │'           },
    { id: 'minimal',   label: 'Minimal list', preview: 'Q · A\nQ · A'               },
    { id: 'cards',     label: 'Cards',        preview: '┌────┐ ┌────┐\n│Q+A │ │Q+A│'},
    { id: 'bold',      label: 'Bold numbers', preview: '01 Big Q?\n   Answer here'   },
    { id: 'split',     label: 'Split panel',  preview: '[ Questions | Answer ]'     },
  ]},
  policies: { label: 'Policies', icon: Shield, color: '#0F6E56', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading',    t: 'text',   l: 'Section heading',               d: 'Our Policies' },
    { k: 'subheading', t: 'text',   l: 'Subheading',                    d: '' },
    { k: 'maxItems',   t: 'select', l: 'Items shown before "View all"', d: '6', opts: ['3','4','5','6','8','all'] },
    { k: 'policies',   t: 'policy-list', l: 'Policy items', d: [
      { id: 'p1', icon: 'clock',  title: 'Cancellation', body: 'Please provide 24 hours notice for all cancellations.' },
      { id: 'p2', icon: 'clock3', title: 'Late Arrival',  body: 'Arrivals 15+ minutes late may need to reschedule.'    },
      { id: 'p3', icon: 'ban',    title: 'No-Shows',      body: 'No-shows may be required to prepay future bookings.'  },
    ]},
  ], layouts: [
    { id: 'cards',     label: 'Icon cards',    preview: '┌──┐ ┌──┐ ┌──┐'                  },
    { id: 'list',      label: 'Icon list',     preview: '🛡 Cancellation\n🕐 Late arrival' },
    { id: 'timeline',  label: 'Timeline',      preview: '●─ card\n│\n─● card'              },
    { id: 'accordion', label: 'Accordion',     preview: '▶ 01 · Policy title'              },
    { id: 'editorial', label: 'Editorial rows',preview: '01 | TITLE | body text here'      },
    { id: 'dark',      label: 'Dark luxury',   preview: '█▓ glowing cards on dark ▓█'      },
    { id: 'spotlight', label: 'Spotlight',     preview: '⬤ 01 ── TITLE → body'           },
    { id: 'frosted',   label: 'Frosted glass', preview: '░┌──┐░┌──┐░┌──┐░'               },
    { id: 'scroll',    label: 'Auto scroll',   preview: '→ [ card ][ card ][ card ] →'    },
  ]},
  contact: { label: 'Location & Contact', icon: MapPin, color: '#993556', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Find Us' }, { k: 'customHours', t: 'textarea', l: 'Hours text', d: 'Monday – Saturday: 9am – 7pm\nSunday: 10am – 5pm' },
    { k: 'showMap', t: 'toggle', l: 'Show map embed', d: true }, { k: 'showHours', t: 'toggle', l: 'Show hours', d: true },
    { k: 'showPhone', t: 'toggle', l: 'Show phone', d: true }, { k: 'showEmail', t: 'toggle', l: 'Show email', d: true },
    { k: 'showSocial', t: 'toggle', l: 'Show social links', d: true }, { k: 'ctaText', t: 'text', l: 'Book CTA text', d: 'Book an Appointment' },
    { k: 'ctaAction', t: 'select', l: 'CTA action', d: 'booking', opts: ['booking','url'] }, { k: 'socialLinks', t: 'social-links', l: 'Social links', d: [] },
  ], layouts: [
    { id: 'split-map', label: 'Map + info', preview: '[ map | hours · address ]' },
    { id: 'stacked',   label: 'Stacked',    preview: '[ map ]\n[ details ]'       },
  ]},
  events: { label: 'Events Calendar', icon: Calendar, color: '#854F0B', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Upcoming Events' }, { k: 'emptyText', t: 'text', l: 'When no events', d: 'Check back soon!' },
    { k: 'ctaText', t: 'text', l: 'RSVP button', d: 'RSVP Now' }, { k: 'ctaAction', t: 'select', l: 'RSVP action', d: 'booking', opts: ['booking','url'] },
  ], layouts: [
    { id: 'cards', label: 'Event cards', preview: '┌────┐ ┌────┐' },
    { id: 'list',  label: 'List',        preview: '── date · event ──' },
  ]},
  referral: { label: 'Referral Program', icon: Share2, color: '#185FA5', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Refer a Friend' }, { k: 'subheading', t: 'text', l: 'Description', d: 'Share the love — give $15, get $15' },
    { k: 'rewardYou', t: 'text', l: 'Your reward', d: '$15 credit' }, { k: 'rewardFriend', t: 'text', l: 'Friend reward', d: '$15 off first visit' },
    { k: 'ctaText', t: 'text', l: 'Button text', d: 'Get My Referral Link' }, { k: 'ctaAction', t: 'select', l: 'Button action', d: 'booking', opts: ['booking','url'] },
  ], layouts: [
    { id: 'split',    label: 'Split reward', preview: '[ you get | friend gets ]' },
    { id: 'centered', label: 'Centered',     preview: '  offer · [get link]  '   },
  ]},
  story: { label: 'Studio Story / Content', icon: BookOpen, color: '#3B6D11', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'image', t: 'image', l: 'Section image', d: '' },
    { k: 'heading', t: 'text', l: 'Heading', d: 'Our Story' }, { k: 'tag', t: 'text', l: 'Eyebrow label (optional)', d: '' },
    { k: 'pullQuote', t: 'text', l: 'Pull quote (optional)', d: '' },
    { k: 'body', t: 'textarea', l: 'Body text', d: 'Opal was born from a belief that nail care is more than maintenance.' },
    { k: 'body2', t: 'textarea', l: 'Second paragraph (optional)', d: '' },
    { k: 'stat1Value', t: 'text', l: 'Stat 1 value (optional)', d: '' }, { k: 'stat1Label', t: 'text', l: 'Stat 1 label', d: '' },
    { k: 'stat2Value', t: 'text', l: 'Stat 2 value (optional)', d: '' }, { k: 'stat2Label', t: 'text', l: 'Stat 2 label', d: '' },
    { k: 'ctaText', t: 'text', l: 'Button text', d: '' }, { k: 'ctaAction', t: 'select', l: 'Button action', d: 'scroll-team', opts: ['booking','scroll-team','scroll-services','url'] },
  ], layouts: [
    { id: 'split',     label: 'Text + image',  preview: '[ text | image ]'            },
    { id: 'centered',  label: 'Centered',      preview: '  heading\n  body'            },
    { id: 'immersive', label: 'Immersive',     preview: '[ full image + overlay text ]'},
    { id: 'founder',   label: 'Founder focus', preview: '[ portrait | bio + stats ]'  },
    { id: 'manifesto', label: 'Manifesto',     preview: 'GIANT TYPE\n── body ──'      },
    { id: 'editorial', label: 'Editorial',     preview: '▌ #01 │ HEADING\n   body'    },
    { id: 'minimal',   label: 'Minimal',       preview: '── heading ──\n    body'     },
  ]},
  instagram: { label: 'Instagram Feed', icon: Camera, color: '#993556', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'heading', t: 'text', l: 'Section heading', d: 'Follow Along' }, { k: 'handle', t: 'text', l: 'Instagram handle', d: '@opalmanicure' },
    { k: 'ctaText', t: 'text', l: 'Button text', d: 'Follow us on Instagram' }, { k: 'images', t: 'image-array', l: 'Preview images', d: [] },
    { k: 'columns', t: 'select', l: 'Columns', d: '4', opts: ['3','4','6'] },
  ], layouts: [
    { id: 'grid',   label: 'Square grid', preview: '┌──┬──┬──┬──┐' },
    { id: 'banner', label: 'Wide banner', preview: '← scroll row →' },
  ]},
  waitlist: { label: 'Waitlist', icon: Clock, color: '#534AB7', fields: [
    { k: 'showHeading',    t: 'toggle', l: 'Show section heading',    d: true },
    { k: 'showSubheading', t: 'toggle', l: 'Show section subheading', d: true },
    { k: 'heading', t: 'text', l: 'Heading', d: 'Fully Booked?' }, { k: 'subheading', t: 'text', l: 'Subheading', d: "Join our waitlist and we'll notify you when a slot opens" },
    { k: 'ctaText', t: 'text', l: 'Button text', d: 'Join Waitlist' }, { k: 'ctaAction', t: 'select', l: 'Action', d: 'booking', opts: ['booking','url'] },
    { k: 'bgImage', t: 'image', l: 'Background image', d: '' },
  ], layouts: [
    { id: 'banner',   label: 'Banner',   preview: '[ heading · form · cta ]' },
    { id: 'centered', label: 'Centered', preview: '  heading\n  [join]'       },
  ]},
};

const DEFAULT_ON: SectionType[] = ['nav','hero','services','team','quote'];

function buildDefaultSections(): PageSection[] {
  return (Object.keys(SECTION_DEFS) as SectionType[]).map((key, i) => {
    const cfg: Record<string,any> = {};
    SECTION_DEFS[key].fields.forEach(f => { cfg[f.k] = f.d; });
    cfg.layout = SECTION_DEFS[key].layouts?.[0]?.id ?? 'default';
    const defIdx = DEFAULT_ON.indexOf(key);
    return { id: key, type: key, enabled: defIdx >= 0, order: defIdx >= 0 ? defIdx : DEFAULT_ON.length + i, config: cfg };
  }).sort((a, b) => a.order - b.order);
}

function generateId() { return Math.random().toString(36).slice(2, 8); }

// ─── Sub-components ────────────────────────────────────────────────────────────

const AnimationPicker = ({ value, onChange }: { value: AnimConfig | undefined; onChange: (v: AnimConfig) => void }) => {
  const cur = value || { type: 'fade-up', speed: 700 };
  return (
    <div className="space-y-4 p-4 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.02]">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/60 flex items-center gap-2"><Wand2 className="w-3 h-3"/>Entrance animation</p>
      <div className="grid grid-cols-4 gap-1.5">
        {ANIM_TYPES.map(t => (
          <button key={t.id} onClick={() => onChange({ ...cur, type: t.id })}
            className={cn('p-2 rounded-xl border-2 text-center transition-all', cur.type === t.id ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20')}>
            <div className="text-base mb-0.5">{t.emoji}</div>
            <p className={cn('text-[7px] font-black uppercase tracking-wider leading-tight', cur.type === t.id ? 'text-primary' : 'text-slate-500')}>{t.label}</p>
          </button>
        ))}
      </div>
      {cur.type !== 'none' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Speed</p>
            <span className="text-[9px] font-bold text-muted-foreground">{(cur.speed / 1000).toFixed(1)}s</span>
          </div>
          <Slider value={[cur.speed]} onValueChange={([v]) => onChange({ ...cur, speed: v })} min={300} max={1200} step={100} className="w-full"/>
          <div className="flex justify-between"><span className="text-[8px] text-muted-foreground/50">Snappy</span><span className="text-[8px] text-muted-foreground/50">Subtle</span></div>
        </div>
      )}
    </div>
  );
};

const LayoutPicker = ({ layouts, value, onChange }: { layouts: SectionLayoutOption[]; value: string; onChange: (v: string) => void }) => (
  <div className="space-y-2">
    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Section layout</p>
    <div className="grid grid-cols-2 gap-2">
      {layouts.map(l => (
        <button key={l.id} onClick={() => onChange(l.id)}
          className={cn('p-3 rounded-xl border-2 text-left transition-all', value === l.id ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20')}>
          <pre className="text-[8px] text-muted-foreground/60 font-mono leading-tight overflow-hidden whitespace-pre-wrap">{l.preview}</pre>
          <p className={cn('text-[9px] font-black uppercase tracking-widest mt-1.5', value === l.id ? 'text-primary' : 'text-slate-500')}>{l.label}</p>
        </button>
      ))}
    </div>
  </div>
);

const SocialLinksEditor = ({ value, onChange }: { value: SocialLink[]; onChange: (v: SocialLink[]) => void }) => {
  const links: SocialLink[] = Array.isArray(value) ? value : [];
  const addPlatform = (id: string) => { if (links.some(l => l.platform === id)) return; onChange([...links, { platform: id, url: '' }]); };
  const updateUrl   = (id: string, url: string) => onChange(links.map(l => l.platform === id ? { ...l, url } : l));
  const remove      = (id: string) => onChange(links.filter(l => l.platform !== id));
  const active      = links.map(l => l.platform);
  const available   = SOCIAL_PLATFORMS.filter(p => !active.includes(p.id));
  return (
    <div className="space-y-3">
      {links.map(link => {
        const p = SOCIAL_PLATFORMS.find(x => x.id === link.platform); if (!p) return null;
        const PI = p.icon;
        return (
          <div key={link.platform} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: p.color + '18' }}><PI className="w-3.5 h-3.5" style={{ color: p.color }}/></div>
            <Input value={link.url} onChange={e => updateUrl(link.platform, e.target.value)} placeholder={p.placeholder} className="flex-1 h-8 rounded-lg border-2 text-xs"/>
            <button onClick={() => remove(link.platform)} className="p-1 text-muted-foreground hover:text-red-500"><X className="w-3.5 h-3.5"/></button>
          </div>
        );
      })}
      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {available.map(p => { const PI = p.icon; return (
            <button key={p.id} onClick={() => addPlatform(p.id)} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-dashed border-border text-[10px] font-bold text-muted-foreground hover:border-primary/30 hover:text-primary transition-all">
              <Plus className="w-2.5 h-2.5"/>{p.label}
            </button>
          ); })}
        </div>
      )}
    </div>
  );
};

const PolicyListEditor = ({ value, onChange }: { value: PolicyItem[]; onChange: (v: PolicyItem[]) => void }) => {
  const policies: PolicyItem[] = Array.isArray(value) ? value : [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const add    = () => { const n: PolicyItem = { id: generateId(), icon: 'shield', title: 'New Policy', body: '' }; onChange([...policies, n]); setExpandedId(n.id); };
  const update = (id: string, f: keyof PolicyItem, v: string) => onChange(policies.map(p => p.id === id ? { ...p, [f]: v } : p));
  const remove = (id: string) => onChange(policies.filter(p => p.id !== id));
  return (
    <div className="space-y-2">
      {policies.map(policy => {
        const icon = POLICY_ICONS.find(i => i.id === policy.icon) ?? POLICY_ICONS[0];
        const PI = icon.icon; const isExp = expandedId === policy.id;
        return (
          <div key={policy.id} className="rounded-xl border-2 border-border overflow-hidden">
            <div className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedId(isExp ? null : policy.id)}>
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0"><PI className="w-3.5 h-3.5 text-primary"/></div>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">{policy.title || 'Untitled'}</span>
              <button onClick={e => { e.stopPropagation(); remove(policy.id); }} className="p-0.5 text-muted-foreground hover:text-red-500"><X className="w-3 h-3"/></button>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isExp && 'rotate-180')}/>
            </div>
            {isExp && (
              <div className="p-3 pt-0 space-y-3 border-t border-border/50">
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Icon</p>
                  <div className="flex flex-wrap gap-1.5">
                    {POLICY_ICONS.map(ic => { const II = ic.icon; return (
                      <button key={ic.id} onClick={() => update(policy.id, 'icon', ic.id)} title={ic.label}
                        className={cn('w-8 h-8 rounded-lg flex items-center justify-center border-2 transition-all', policy.icon === ic.id ? 'border-primary/40 bg-primary/10' : 'border-border hover:border-primary/20')}>
                        <II className="w-3.5 h-3.5 text-slate-600"/>
                      </button>
                    ); })}
                  </div>
                </div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Title</Label><Input value={policy.title} onChange={e => update(policy.id, 'title', e.target.value)} className="h-8 rounded-lg border-2 text-xs"/></div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Description</Label><Textarea value={policy.body} onChange={e => update(policy.id, 'body', e.target.value)} className="rounded-xl border-2 text-xs min-h-[60px] resize-none"/></div>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={add} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"><Plus className="w-3.5 h-3.5"/>Add policy</button>
    </div>
  );
};

const BeforeAfterPairsEditor = ({ value, onChange }: { value: BeforeAfterPair[]; onChange: (v: BeforeAfterPair[]) => void }) => {
  const pairs: BeforeAfterPair[] = Array.isArray(value) ? value : [];
  const pairsRef = useRef(pairs); pairsRef.current = pairs;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const add    = () => { const n: BeforeAfterPair = { id: generateId(), beforeUrl: '', afterUrl: '', caption: '' }; onChange([...pairsRef.current, n]); setExpandedId(n.id); };
  const update = (id: string, f: keyof BeforeAfterPair, v: string) => onChange(pairsRef.current.map(p => p.id === id ? { ...p, [f]: v } : p));
  const remove = (id: string) => onChange(pairsRef.current.filter(p => p.id !== id));
  return (
    <div className="space-y-3">
      {pairs.map((pair, idx) => {
        const isExp = expandedId === pair.id;
        return (
          <div key={pair.id} className="rounded-xl border-2 border-border overflow-hidden">
            <div className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedId(isExp ? null : pair.id)}>
              <div className="flex gap-1 shrink-0">
                <div className="w-7 h-7 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">{pair.beforeUrl ? <img src={pair.beforeUrl} alt="before" className="w-full h-full object-cover"/> : <span className="text-[7px] font-black text-muted-foreground/40">B</span>}</div>
                <ArrowLeftRight className="w-3 h-3 text-muted-foreground/40 self-center"/>
                <div className="w-7 h-7 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">{pair.afterUrl ? <img src={pair.afterUrl} alt="after" className="w-full h-full object-cover"/> : <span className="text-[7px] font-black text-muted-foreground/40">A</span>}</div>
              </div>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">{pair.caption || `Pair ${idx + 1}`}</span>
              <button onClick={e => { e.stopPropagation(); remove(pair.id); }} className="p-0.5 text-muted-foreground hover:text-red-500"><X className="w-3 h-3"/></button>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isExp && 'rotate-180')}/>
            </div>
            {isExp && (
              <div className="p-3 pt-2 space-y-4 border-t border-border/50">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">Before image</Label>
                  {pair.beforeUrl && <div className="relative rounded-xl overflow-hidden border-2 border-border aspect-video mb-2"><img src={pair.beforeUrl} alt="before" className="w-full h-full object-cover"/><button onClick={() => update(pair.id, 'beforeUrl', '')} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-500 transition-colors"><X className="w-3 h-3"/></button></div>}
                  {!pair.beforeUrl && <ImageUpload initialImage="" onImageUploaded={url => update(pair.id, 'beforeUrl', url)}/>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">After image</Label>
                  {pair.afterUrl && <div className="relative rounded-xl overflow-hidden border-2 border-border aspect-video mb-2"><img src={pair.afterUrl} alt="after" className="w-full h-full object-cover"/><button onClick={() => update(pair.id, 'afterUrl', '')} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-500 transition-colors"><X className="w-3 h-3"/></button></div>}
                  {!pair.afterUrl && <ImageUpload initialImage="" onImageUploaded={url => update(pair.id, 'afterUrl', url)}/>}
                </div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Caption (optional)</Label><Input value={pair.caption || ''} onChange={e => update(pair.id, 'caption', e.target.value)} placeholder="e.g. Gel removal & fresh set" className="h-8 rounded-lg border-2 text-xs"/></div>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={add} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"><Plus className="w-3.5 h-3.5"/>Add before/after pair</button>
    </div>
  );
};

const ImageArrayEditor = ({ value, onChange, maxImages = 24 }: { value: GalleryImage[]; onChange: (v: GalleryImage[]) => void; maxImages?: number }) => {
  const images: GalleryImage[] = Array.isArray(value) ? value : [];
  const remove = (id: string) => onChange(images.filter(img => img.id !== id));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {images.map(img => (
          <div key={img.id} className="relative group rounded-xl overflow-hidden border-2 border-border aspect-square">
            {img.url ? <img src={img.url} alt={img.caption || ''} className="w-full h-full object-cover"/> : <div className="w-full h-full bg-muted flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground/40"/></div>}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><button onClick={() => remove(img.id)} className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center"><X className="w-3 h-3"/></button></div>
          </div>
        ))}
      </div>
      {images.length < maxImages && (
        <div><p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2">Upload new image</p><ImageUpload initialImage="" onImageUploaded={url => onChange([...images, { id: generateId(), url, caption: '', category: '' }])}/></div>
      )}
      {images.length > 0 && <p className="text-[9px] text-muted-foreground/50 text-center">{images.length} image{images.length !== 1 ? 's' : ''} uploaded</p>}
    </div>
  );
};

const TagListEditor = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => {
  const tags: string[] = Array.isArray(value) ? value : [];
  const [input, setInput] = useState('');
  const add = () => { const v = input.trim(); if (v && !tags.includes(v)) { onChange([...tags, v]); setInput(''); } };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-bold">{tag}<button onClick={() => onChange(tags.filter(t => t !== tag))}><X className="w-2.5 h-2.5"/></button></span>)}</div>
      <div className="flex gap-2"><Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add tag…" className="h-8 rounded-lg border-2 text-xs flex-1"/><Button size="sm" onClick={add} variant="outline" className="h-8 px-3 rounded-lg text-xs">Add</Button></div>
    </div>
  );
};

const renderFieldEditor_FieldRenderer = ({ field, value, onChange, highlightedField }: {
  field: SectionField; value: any; onChange: (v: any) => void; highlightedField?: string | null;
}) => {
  const fieldRef = useRef<HTMLDivElement>(null);
  const isHighlighted = highlightedField === field.k;
  const labelCls = 'text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70';
  useEffect(() => { if (isHighlighted && fieldRef.current) fieldRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [isHighlighted]);
  const wrapper = (children: React.ReactNode) => (
    <div ref={fieldRef} className={cn('transition-all duration-300', isHighlighted && 'ring-2 ring-indigo-400/60 rounded-xl p-2 bg-indigo-50/50')}>{children}</div>
  );
  if (field.t === 'image') {
    const isLogoField = field.k === 'logoUrl' || field.k === 'logoDarkUrl' || field.k === 'logoLightUrl';
    return wrapper(
      <div className="space-y-1.5">
        <Label className={labelCls}>{field.l}</Label>
        <ImageUpload initialImage={value || ''} onImageUploaded={onChange}/>
        {isLogoField && value && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Transparency preview</p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center justify-center p-3 rounded-xl border-2 border-border" style={{ background: '#ffffff', minHeight: 56 }}>
                <img src={value} alt="Logo on light" style={{ height: 32, width: 'auto', maxWidth: '100%', objectFit: 'contain' }}/>
              </div>
              <div className="flex-1 flex items-center justify-center p-3 rounded-xl border-2 border-border" style={{ backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)', backgroundSize: '10px 10px', backgroundPosition: '0 0,0 5px,5px -5px,-5px 0px', backgroundColor: '#fff', minHeight: 56 }}>
                <img src={value} alt="Logo transparency" style={{ height: 32, width: 'auto', maxWidth: '100%', objectFit: 'contain' }}/>
              </div>
              <div className="flex-1 flex items-center justify-center p-3 rounded-xl border-2 border-border" style={{ background: '#111111', minHeight: 56 }}>
                <img src={value} alt="Logo on dark" style={{ height: 32, width: 'auto', maxWidth: '100%', objectFit: 'contain', filter: 'brightness(0) invert(1)' }}/>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  if (field.t === 'image-array')       return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><ImageArrayEditor value={value || []} onChange={onChange}/></div>);
  if (field.t === 'beforeafter-pairs') return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><BeforeAfterPairsEditor value={value || []} onChange={onChange}/></div>);
  if (field.t === 'social-links')      return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><SocialLinksEditor value={value || []} onChange={onChange}/></div>);
  if (field.t === 'policy-list')       return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><PolicyListEditor value={value || []} onChange={onChange}/></div>);
  if (field.t === 'tag-list')          return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><TagListEditor value={value || []} onChange={onChange}/></div>);
  if (field.t === 'toggle')            return wrapper(<div className="flex items-center justify-between py-2.5 border-b border-dashed last:border-0"><span className={labelCls}>{field.l}</span><Switch checked={!!value} onCheckedChange={onChange}/></div>);
  if (field.t === 'textarea')          return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><Textarea value={value || ''} onChange={e => onChange(e.target.value)} className="rounded-xl border-2 text-sm min-h-[80px] resize-none"/></div>);
  if (field.t === 'select')            return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><Select value={value ?? field.d} onValueChange={onChange}><SelectTrigger className="h-10 rounded-xl border-2 text-xs font-black uppercase"><SelectValue/></SelectTrigger><SelectContent className="rounded-xl border-2">{field.opts!.map(o => <SelectItem key={o} value={o} className="text-xs font-black uppercase">{o.replace(/-/g,' ').charAt(0).toUpperCase()+o.replace(/-/g,' ').slice(1)}</SelectItem>)}</SelectContent></Select></div>);
  if (field.t === 'color')             return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><div className="flex items-center gap-2"><input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} className="w-10 h-10 rounded-xl border-2 cursor-pointer p-0.5"/><Input value={value || ''} onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)} className="h-10 rounded-xl border-2 font-mono text-xs w-28" maxLength={7} placeholder="#000000"/></div></div>);
  if (field.t === 'range')             return wrapper(<div className="space-y-2"><div className="flex items-center justify-between"><Label className={labelCls}>{field.l}</Label><span className="text-xs font-bold text-muted-foreground">{value ?? field.d}</span></div><Slider value={[value ?? field.d]} onValueChange={([v]) => onChange(v)} min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} className="w-full"/></div>);
  return wrapper(<div className="space-y-1.5"><Label className={labelCls}>{field.l}</Label><Input value={value || ''} onChange={e => onChange(e.target.value)} className="h-10 rounded-xl border-2 text-sm"/></div>);
};

// Alias so existing callers work
const FieldRenderer = renderFieldEditor_FieldRenderer;

const SectionListItem = ({ section, isSelected, isFirst, isLast, onSelect, onMoveUp, onMoveDown, onHide, onDuplicate, onToggleVisible }: {
  section: PageSection; isSelected: boolean; isFirst: boolean; isLast: boolean;
  onSelect: () => void; onMoveUp: () => void; onMoveDown: () => void; onHide: () => void;
  onDuplicate: () => void; onToggleVisible: () => void;
}) => {
  const def = SECTION_DEFS[section.type as SectionType]; const Icon = def.icon;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isHidden = (section as any).visible === false;
  return (
    <div onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 p-2.5 rounded-2xl border-2 cursor-pointer transition-all group',
        confirmDelete ? 'border-red-300 bg-red-50'
          : isSelected  ? 'border-primary/30 bg-primary/5 shadow-md'
          : isHidden    ? 'border-dashed border-amber-200 bg-amber-50/30'
          : 'border-border bg-background hover:border-primary/20'
      )}>
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0"/>
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: def.color + '18' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: def.color }}/>
      </div>
      {confirmDelete ? (
        <div className="flex-1 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <span className="text-[9px] font-black uppercase tracking-widest text-red-600 flex-1">Remove section?</span>
          <button onClick={() => { onHide(); setConfirmDelete(false); }} className="px-2 py-1 rounded-lg bg-red-500 text-white text-[9px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors">Yes</button>
          <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">Cancel</button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <span className={cn('text-[10px] font-black uppercase tracking-tight truncate block', isSelected ? 'text-primary' : isHidden ? 'text-slate-400' : 'text-slate-700')}>
              {def.label}
            </span>
            {isHidden && (
              <span className="text-[8px] font-black uppercase tracking-widest text-amber-500 leading-none">
                Hidden from visitors
              </span>
            )}
          </div>
          <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            <button onClick={onToggleVisible} title={isHidden ? 'Show on live page' : 'Hide from live page'}
              className="p-1 rounded hover:bg-muted">
              {isHidden
                ? <EyeOff className="w-3 h-3 text-amber-400"/>
                : <Eye className="w-3 h-3 text-muted-foreground"/>}
            </button>
            <button onClick={onDuplicate} title="Duplicate" className="p-1 rounded hover:bg-muted text-muted-foreground"><Copy className="w-3 h-3"/></button>
            <button onClick={onMoveUp}   disabled={isFirst} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"><ChevronUp className="w-3 h-3"/></button>
            <button onClick={onMoveDown} disabled={isLast}  className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"><ChevronDown className="w-3 h-3"/></button>
            <button onClick={e => { e.stopPropagation(); setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); }} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"><X className="w-3 h-3"/></button>
          </div>
        </>
      )}
    </div>
  );
};

const LibraryItem = ({ type, onAdd }: { type: SectionType; onAdd: () => void }) => {
  const def = SECTION_DEFS[type]; const Icon = def.icon;
  return (
    <button onClick={onAdd} className="w-full flex items-center gap-2.5 p-2.5 rounded-2xl border-2 border-border bg-background hover:border-primary/30 hover:bg-primary/5 transition-all text-left">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: def.color + '18' }}><Icon className="w-3.5 h-3.5" style={{ color: def.color }}/></div>
      <span className="flex-1 text-[10px] font-black uppercase tracking-tight text-slate-700 truncate">{def.label}</span>
      <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0"/>
    </button>
  );
};

const FontPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [activeGroup, setActiveGroup] = useState('Sans');
  const groupFonts = FONTS.filter(f => f.group === activeGroup);
  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">{FONT_GROUPS.map(g => <button key={g} onClick={() => setActiveGroup(g)} className={cn('px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all', activeGroup === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{g}</button>)}</div>
      <div className="space-y-0.5">
        {groupFonts.map(f => (
          <button key={f.id} onClick={() => onChange(f.id)} className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all', value === f.id ? 'bg-primary/8 border border-primary/20' : 'hover:bg-muted/40 border border-transparent')}>
            <span className="text-sm flex-1 truncate" style={{ fontFamily: f.stack }}>{f.label}</span>
            <span className="text-[9px] text-muted-foreground shrink-0">{f.desc}</span>
            {value === f.id && <Check className="w-3 h-3 text-primary shrink-0"/>}
          </button>
        ))}
      </div>
    </div>
  );
};

const BrandKitPicker = ({ style, onApply }: { style: any; onApply: (kit: typeof BRAND_KITS[0]) => void }) => (
  <div className="grid grid-cols-2 gap-2">
    {BRAND_KITS.map(kit => (
      <button key={kit.id} onClick={() => onApply(kit)}
        className={cn('p-3 rounded-2xl border-2 text-left transition-all hover:shadow-md', style.brandKit === kit.id ? 'border-primary/40 shadow-md' : 'border-border hover:border-primary/20')}
        style={{ background: kit.bgColor }}>
        <div className="w-6 h-6 rounded-full mb-2" style={{ background: kit.accentColor }}/>
        <p className="text-[10px] font-black uppercase tracking-tight" style={{ color: kit.accentColor, fontFamily: FONTS.find(f => f.id === kit.headingFont)?.stack }}>{kit.label}</p>
        <p className="text-[8px] mt-0.5" style={{ color: kit.accentColor + 'aa', fontFamily: FONTS.find(f => f.id === kit.bodyFont)?.stack }}>{kit.desc}</p>
      </button>
    ))}
  </div>
);

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function PageBuilderPage() {
  const { firestore }      = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast }          = useToast();
  useGoogleFonts();

  const isFirstLoad         = useRef(true);
  const historyRef          = useRef<{ sections: PageSection[]; style: any }[]>([]);
  const futureRef           = useRef<{ sections: PageSection[]; style: any }[]>([]);
  const fieldEditTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldEditActiveRef  = useRef(false);

  const [sections,         setSections]        = useState<PageSection[]>(buildDefaultSections());
  const [selectedId,       setSelectedId]      = useState<string | null>('hero');
  const [highlightedField, setHighlightedField]= useState<string | null>(null);
  const [showLibrary,      setShowLibrary]     = useState(false);
  const [activePanel,      setActivePanel]     = useState<'sections' | 'style'>('sections');
  const [styleTab,         setStyleTab]        = useState<'kits' | 'colors' | 'fonts' | 'spacing'>('kits');
  const [isSaving,         setIsSaving]        = useState(false);
  const [isDirty,          setIsDirty]         = useState(false);
  const [previewMode,      setPreviewMode]     = useState<'desktop' | 'mobile'>('desktop');
  const [canUndo,          setCanUndo]         = useState(false);
  const [canRedo,          setCanRedo]         = useState(false);
  const [mobileSheet,      setMobileSheet]     = useState<'closed' | 'half' | 'full'>('half');
  const [mobilePanelTab,   setMobilePanelTab]  = useState<'sections' | 'style'>('sections');
  const [mobileFieldView,  setMobileFieldView] = useState(false);
  const [isLandscape,      setIsLandscape]     = useState(false);
  const [drawerOpen,       setDrawerOpen]      = useState(true);
  const [dragId,           setDragId]          = useState<string | null>(null);
  const [dragOverId,       setDragOverId]      = useState<string | null>(null);

  const [previewData, setPreviewData] = useState<PageData>({
    tenant: null, services: [], staff: [], events: [], tenantId: '',
  });

  useEffect(() => {
    const update = () => setIsLandscape(window.innerWidth > window.innerHeight && window.innerHeight < 600);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => setTimeout(update, 100));
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!document.getElementById('cf-anim')) {
      const s = document.createElement('style'); s.id = 'cf-anim'; s.textContent = ANIM_CSS; document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (!selectedTenant || !firestore) return;
    let cancelled = false;
    const run = async () => {
      try {
        const [svSnap, stSnap, evSnap] = await Promise.all([
          getDocs(collection(firestore, `tenants/${selectedTenant.id}/services`)),
          getDocs(collection(firestore, `tenants/${selectedTenant.id}/staff`)),
          getDocs(collection(firestore, `tenants/${selectedTenant.id}/studioEvents`)).catch(() => ({ docs: [] as any[] })),
        ]);
        if (!cancelled) {
          setPreviewData({
            tenant: selectedTenant, tenantId: selectedTenant.id,
            services: svSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false),
            staff:    stSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false),
            events:   evSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          });
        }
      } catch (e) { console.warn('[builder:preview-data]', e); }
    };
    run();
    return () => { cancelled = true; };
  }, [selectedTenant?.id, firestore]); // eslint-disable-line

  const [style, setStyle] = useState({
    accentColor: '#000000', bgColor: '#ffffff', headingFont: 'josefin', bodyFont: 'inter',
    borderRadius: 4, buttonStyle: 'filled' as 'filled' | 'outline' | 'ghost' | 'pill',
    density: 'balanced' as 'compact' | 'balanced' | 'airy', brandKit: null as string | null,
  });

  useEffect(() => {
    const raw = (selectedTenant?.bookingPageSettings as any)?.cfPageConfig;
    if (!raw) return;
    const validTypes = new Set(Object.keys(SECTION_DEFS));
    const existing: PageBuilderConfig | undefined =
      Array.isArray(raw?.sections) && raw.sections.length > 0 &&
      (raw.sections as any[]).every((s: any) => typeof s?.type === 'string' && validTypes.has(s.type) && typeof s?.id === 'string')
        ? raw as PageBuilderConfig : undefined;
    if (!existing) return;
    isFirstLoad.current = true;
    if (existing.sections?.length) setSections(existing.sections);
    if (existing.accentColor)               setStyle(p => ({ ...p, accentColor:  existing.accentColor }));
    if (existing.bgColor)                   setStyle(p => ({ ...p, bgColor:      existing.bgColor }));
    if (existing.headingFont)               setStyle(p => ({ ...p, headingFont:  existing.headingFont }));
    if (existing.bodyFont)                  setStyle(p => ({ ...p, bodyFont:     existing.bodyFont }));
    if (existing.borderRadius !== undefined) setStyle(p => ({ ...p, borderRadius: existing.borderRadius }));
    if (existing.buttonStyle)               setStyle(p => ({ ...p, buttonStyle:  existing.buttonStyle }));
    if (existing.density)                   setStyle(p => ({ ...p, density:      existing.density }));
    if (existing.brandKit)                  setStyle(p => ({ ...p, brandKit:     existing.brandKit }));
    setTimeout(() => { isFirstLoad.current = false; }, 0);
  }, [selectedTenant]); // eslint-disable-line

  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setIsDirty(true);
  }, [sections, style]);

  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-19), { sections: JSON.parse(JSON.stringify(sections)), style: { ...style } }];
    futureRef.current = []; setCanUndo(true); setCanRedo(false);
  }, [sections, style]);

  const undo = useCallback(() => {
    if (!historyRef.current.length) return;
    const last = historyRef.current[historyRef.current.length - 1];
    futureRef.current = [{ sections, style }, ...futureRef.current.slice(0, 19)];
    historyRef.current = historyRef.current.slice(0, -1);
    setSections(last.sections); setStyle(last.style);
    setCanUndo(historyRef.current.length > 0); setCanRedo(true);
  }, [sections, style]);

  const redo = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[0];
    historyRef.current = [...historyRef.current.slice(-19), { sections, style }];
    futureRef.current = futureRef.current.slice(1);
    setSections(next.sections); setStyle(next.style);
    setCanUndo(true); setCanRedo(futureRef.current.length > 0);
  }, [sections, style]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]); // eslint-disable-line

  const enabledSections  = useMemo(() => sections.filter(s => s.enabled).sort((a,b) => a.order - b.order), [sections]);
  const disabledSections = useMemo(() => sections.filter(s => !s.enabled), [sections]);
  // Library shows one entry per section TYPE that has no enabled instance — prevents duplicates
  const availableTypes = useMemo(() => {
    const enabledTypes = new Set(enabledSections.map(s => s.type));
    return (Object.keys(SECTION_DEFS) as SectionType[]).filter(t => !enabledTypes.has(t));
  }, [enabledSections]);
  const selectedSection  = useMemo(() => sections.find(s => s.id === selectedId), [sections, selectedId]);
  const allSectionTypes  = useMemo(() => enabledSections.map(s => s.type), [enabledSections]);

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    pushHistory();
    setSections(prev => {
      const en = prev.filter(s => s.enabled).sort((a,b) => a.order - b.order);
      const dragIdx = en.findIndex(s => s.id === dragId);
      const dropIdx = en.findIndex(s => s.id === targetId);
      if (dragIdx < 0 || dropIdx < 0) return prev;
      const reordered = [...en]; const [moved] = reordered.splice(dragIdx, 1); reordered.splice(dropIdx, 0, moved);
      const orderMap: Record<string,number> = {}; reordered.forEach((s, i) => { orderMap[s.id] = i; });
      return prev.map(s => orderMap[s.id] !== undefined ? { ...s, order: orderMap[s.id] } : s);
    });
    setDragId(null); setDragOverId(null);
  };

  const moveUp = (id: string) => { pushHistory(); setSections(prev => { const en = prev.filter(s => s.enabled).sort((a,b) => a.order - b.order); const idx = en.findIndex(s => s.id === id); if (idx <= 0) return prev; const [a, b] = [en[idx-1], en[idx]]; return prev.map(s => s.id === a.id ? { ...s, order: b.order } : s.id === b.id ? { ...s, order: a.order } : s); }); };
  const moveDown = (id: string) => { pushHistory(); setSections(prev => { const en = prev.filter(s => s.enabled).sort((a,b) => a.order - b.order); const idx = en.findIndex(s => s.id === id); if (idx >= en.length - 1) return prev; const [a, b] = [en[idx], en[idx+1]]; return prev.map(s => s.id === a.id ? { ...s, order: b.order } : s.id === b.id ? { ...s, order: a.order } : s); }); };
  const hideSection = (id: string) => { pushHistory(); setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: false } : s)); if (selectedId === id) setSelectedId(null); };
  const toggleVisible = (id: string) => {
    setSections(prev => prev.map(s =>
      s.id === id ? { ...s, visible: s.visible === false ? true : false } : s
    ));
    setIsDirty(true);
  };
  const addSection  = (type: SectionType) => {
    pushHistory();
    const maxOrder = enabledSections.reduce((m, s) => Math.max(m, s.order), 0);
    // Re-enable an existing disabled instance if one exists, otherwise create fresh
    const existing = sections.find(s => s.type === type && !s.enabled);
    if (existing) {
      setSections(prev => prev.map(s => s.id === existing.id ? { ...s, enabled: true, order: maxOrder + 1 } : s));
      setSelectedId(existing.id);
    } else {
      const cfg: Record<string,any> = {};
      SECTION_DEFS[type].fields.forEach(f => { cfg[f.k] = f.d; });
      cfg.layout = SECTION_DEFS[type].layouts?.[0]?.id ?? 'default';
      const newSection: PageSection = { id: `${type}-${generateId()}`, type, enabled: true, order: maxOrder + 1, config: cfg };
      setSections(prev => [...prev, newSection]);
      setSelectedId(newSection.id);
    }
    setShowLibrary(false);
  };
  const duplicateSection = (id: string) => { pushHistory(); const src = sections.find(s => s.id === id); if (!src) return; const maxOrder = enabledSections.reduce((m, s) => Math.max(m, s.order), 0); const newSection: PageSection = { ...src, id: `${src.type}-${generateId()}`, order: maxOrder + 1 }; setSections(prev => [...prev, newSection]); setSelectedId(newSection.id); };

  const updateField = (sectionId: string, key: string, value: any) => {
    if (!fieldEditActiveRef.current) { fieldEditActiveRef.current = true; pushHistory(); }
    if (fieldEditTimerRef.current) clearTimeout(fieldEditTimerRef.current);
    fieldEditTimerRef.current = setTimeout(() => { fieldEditActiveRef.current = false; }, 1500);
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, config: { ...s.config, [key]: value } } : s));
  };
  const updateAnimation = (sectionId: string, animConfig: AnimConfig) => { pushHistory(); setSections(prev => prev.map(s => s.id === sectionId ? { ...s, config: { ...s.config, _animation: animConfig } } : s)); };
  const updateStyle   = (updates: Partial<typeof style>) => { pushHistory(); setStyle(p => ({ ...p, ...updates })); };
  const applyBrandKit = (kit: typeof BRAND_KITS[0]) => { pushHistory(); setStyle(p => ({ ...p, accentColor: kit.accentColor, bgColor: kit.bgColor, headingFont: kit.headingFont, bodyFont: kit.bodyFont, borderRadius: kit.borderRadius, brandKit: kit.id })); toast({ title: `${kit.label} brand kit applied` }); };

  const handleSave = async () => {
    if (!selectedTenant || !firestore) return;
    setIsSaving(true);
    try {
      const sanitize = (v: any): any => {
        if (Array.isArray(v)) return v.map(sanitize);
        if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,sanitize(x)]));
        return v;
      };
      const config: PageBuilderConfig = sanitize({ sections, ...style });
      await updateDoc(doc(firestore, 'tenants', selectedTenant.id), { 'bookingPageSettings.cfPageConfig': config });
      setIsDirty(false);
      toast({ title: 'Page saved', description: 'Your booking page is updated and live.' });
    } catch { toast({ variant: 'destructive', title: 'Save failed', description: 'Please try again.' }); }
    finally { setIsSaving(false); }
  };

  const headingFontDef = FONTS.find(f => f.id === style.headingFont);
  const bodyFontDef    = FONTS.find(f => f.id === style.bodyFont);
  const previewUrl     = selectedTenant ? `/book/${selectedTenant.id}` : null;

  const resolvedPreviewStyle: StyleConfig = {
    accentColor: style.accentColor, bgColor: style.bgColor,
    headingFont: style.headingFont, bodyFont: style.bodyFont,
    borderRadius: style.borderRadius, buttonStyle: style.buttonStyle, density: style.density,
  };

  useEffect(() => { previewInjectFonts(style.headingFont, style.bodyFont); }, [style.headingFont, style.bodyFont]);

  const selectedDef = selectedSection ? SECTION_DEFS[selectedSection.type as SectionType] : null;

  const renderPreview = () => (
    <>
      {enabledSections.map(section => {
        const isHidden = (section as any).visible === false;
        const animKey = `${section.id}-${(section.config as any)._animation?.type || 'fu'}-${(section.config as any)._animation?.speed || 700}`;
        const inner = (
          <SectionWrapper key={animKey} section={section} isPreview={true}
            onEdit={(id) => { setSelectedId(id); setActivePanel('sections'); setHighlightedField(null); setShowLibrary(false); if (typeof window !== 'undefined' && window.innerWidth < 1024) { setMobileFieldView(false); setMobilePanelTab('sections'); if (mobileSheet === 'closed') setMobileSheet('half'); } }}
            onFieldTap={(sId, fKey) => { setSelectedId(sId); setActivePanel('sections'); setHighlightedField(fKey); setTimeout(() => setHighlightedField(null), 4000); if (typeof window !== 'undefined' && window.innerWidth < 1024) { setMobileFieldView(true); setMobileSheet('full'); } }}>
            <SectionRenderer
              section={section.type === 'nav' ? { ...section, config: { ...section.config, _enabledSections: allSectionTypes } } : section}
              style={resolvedPreviewStyle} data={previewData} isPreview={true}
              onFieldTap={(sId, fKey) => { setSelectedId(sId); setActivePanel('sections'); setHighlightedField(fKey); setTimeout(() => setHighlightedField(null), 4000); if (typeof window !== 'undefined' && window.innerWidth < 1024) { setMobileFieldView(true); setMobileSheet('full'); } }}/>
          </SectionWrapper>
        );
        if (!isHidden) return inner;
        return (
          <div key={animKey} style={{ position: 'relative', opacity: 0.4, pointerEvents: 'auto' }}>
            {inner}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.04) 0px, rgba(245,158,11,0.04) 10px, transparent 10px, transparent 20px)',
              zIndex: 10,
            }}/>
            <div style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              background: '#f59e0b', color: 'white',
              padding: '4px 14px', borderRadius: 6,
              fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em',
              whiteSpace: 'nowrap', zIndex: 20,
              boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
            }}>
              Hidden from visitors
            </div>
          </div>
        );
      })}
      <PreviewFooter tenant={previewData.tenant ?? selectedTenant} style={resolvedPreviewStyle}/>
    </>
  );

  const renderStylePanel = () => (
    <div className="space-y-6 p-4">
      <div className="flex gap-1 flex-wrap">
        {(['kits','colors','fonts','spacing'] as const).map(t => (
          <button key={t} onClick={() => setStyleTab(t)} className={cn('px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all', styleTab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{t}</button>
        ))}
      </div>
      {styleTab === 'kits' && <div className="space-y-3"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Brand kits</p><BrandKitPicker style={style} onApply={applyBrandKit}/></div>}
      {styleTab === 'colors' && (
        <div className="space-y-5">
          <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Accent color</p><div className="flex items-center gap-2"><input type="color" value={style.accentColor} onChange={e => updateStyle({ accentColor: e.target.value, brandKit: null })} className="w-10 h-10 rounded-xl border-2 cursor-pointer p-0.5"/><Input value={style.accentColor} onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && updateStyle({ accentColor: e.target.value, brandKit: null })} className="h-10 rounded-xl border-2 font-mono text-xs w-28" maxLength={7}/></div></div>
          <Separator className="border-dashed"/>
          <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Background</p><div className="flex items-center gap-2"><input type="color" value={style.bgColor} onChange={e => updateStyle({ bgColor: e.target.value, brandKit: null })} className="w-10 h-10 rounded-xl border-2 cursor-pointer p-0.5"/><Input value={style.bgColor} onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && updateStyle({ bgColor: e.target.value, brandKit: null })} className="h-10 rounded-xl border-2 font-mono text-xs w-28" maxLength={7}/></div></div>
          <Separator className="border-dashed"/>
          <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Button style</p><div className="grid grid-cols-2 gap-1.5">{(['filled','outline','ghost','pill'] as const).map(bs => <button key={bs} onClick={() => updateStyle({ buttonStyle: bs })} className={cn('py-2 px-3 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all', style.buttonStyle === bs ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/20')}>{bs}</button>)}</div></div>
        </div>
      )}
      {styleTab === 'fonts' && (
        <div className="space-y-5">
          <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Heading font</p><FontPicker value={style.headingFont} onChange={v => updateStyle({ headingFont: v, brandKit: null })}/></div>
          <Separator className="border-dashed"/>
          <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Body font</p><FontPicker value={style.bodyFont} onChange={v => updateStyle({ bodyFont: v, brandKit: null })}/></div>
        </div>
      )}
      {styleTab === 'spacing' && (
        <div className="space-y-5">
          <div className="space-y-3"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Corner roundness</p><div className="space-y-2"><div className="flex items-center justify-between"><span className="text-[9px] text-muted-foreground">Sharp</span><span className="text-[9px] font-bold text-muted-foreground">{style.borderRadius}px</span><span className="text-[9px] text-muted-foreground">Pill</span></div><Slider value={[style.borderRadius]} onValueChange={([v]) => updateStyle({ borderRadius: v })} min={0} max={32} step={2} className="w-full"/><div className="flex gap-2 justify-center mt-1">{[0,6,12,24,32].map(r => <div key={r} className="w-8 h-8 bg-primary/20 border-2 border-primary/30" style={{ borderRadius: r }}/>)}</div></div></div>
          <Separator className="border-dashed"/>
          <div className="space-y-2"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Section spacing</p><div className="grid grid-cols-3 gap-1.5">{(['compact','balanced','airy'] as const).map(d => <button key={d} onClick={() => updateStyle({ density: d })} className={cn('py-2 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all', style.density === d ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/20')}>{d}</button>)}</div></div>
        </div>
      )}
    </div>
  );

  const renderFieldEditor = () => (
    <div className="space-y-5 p-4">
      <AnimationPicker value={(selectedSection!.config as any)._animation} onChange={v => updateAnimation(selectedSection!.id, v)}/>
      <Separator className="border-dashed"/>
      {selectedDef!.layouts && selectedDef!.layouts.length > 1 && (
        <><LayoutPicker layouts={selectedDef!.layouts} value={selectedSection!.config.layout ?? selectedDef!.layouts[0].id} onChange={val => updateField(selectedSection!.id, 'layout', val)}/><Separator className="border-dashed"/></>
      )}
      {SECTION_DEFS[selectedSection!.type as SectionType].fields.map(field => (
        <FieldRenderer key={field.k} field={field} value={selectedSection!.config[field.k] ?? field.d} onChange={val => updateField(selectedSection!.id, field.k, val)} highlightedField={highlightedField}/>
      ))}
    </div>
  );

  const HANDLE_H = 56;
  const sheetTranslate = mobileSheet === 'closed' ? `calc(100% - ${HANDLE_H}px)` : mobileSheet === 'half' ? '42%' : '0%';
  const cycleSheet = () => setMobileSheet(s => s === 'closed' ? 'half' : s === 'half' ? 'full' : 'closed');

  const renderMobileTabBar = ({ compact = false }: { compact?: boolean } = {}) => (
    <div className={cn('flex items-center gap-1.5 w-full')}>
      <div className={cn('flex gap-1 flex-1 bg-slate-100 rounded-xl', compact ? 'p-0.5' : 'p-1')}>
        <button onClick={() => { setMobilePanelTab('sections'); setMobileFieldView(false); if (!isLandscape && mobileSheet === 'closed') setMobileSheet('half'); }}
          className={cn('flex-1 flex items-center justify-center gap-1 rounded-lg font-black uppercase tracking-widest transition-all', compact ? 'py-1.5 text-[9px]' : 'py-2 text-[10px]', mobilePanelTab === 'sections' && !mobileFieldView ? 'bg-white shadow-sm text-primary' : 'text-slate-400')}>
          <Layers className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}/>Sections
        </button>
        <button onClick={() => { setMobilePanelTab('style'); setMobileFieldView(false); if (!isLandscape && mobileSheet === 'closed') setMobileSheet('half'); }}
          className={cn('flex-1 flex items-center justify-center gap-1 rounded-lg font-black uppercase tracking-widest transition-all', compact ? 'py-1.5 text-[9px]' : 'py-2 text-[10px]', mobilePanelTab === 'style' && !mobileFieldView ? 'bg-white shadow-sm text-primary' : 'text-slate-400')}>
          <Palette className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}/>Style
        </button>
        {selectedSection && (
          <button onClick={() => setMobileFieldView(true)}
            className={cn('flex-1 flex items-center justify-center gap-1 rounded-lg font-black uppercase tracking-widest transition-all', compact ? 'py-1.5 text-[9px]' : 'py-2 text-[10px]', mobileFieldView ? 'bg-white shadow-sm text-primary' : 'text-slate-400')}>
            {React.createElement(selectedDef!.icon, { className: compact ? 'w-3 h-3' : 'w-3.5 h-3.5' })}
            <span className="truncate max-w-[44px]">{selectedDef!.label.split(' ')[0]}</span>
          </button>
        )}
      </div>
      <button onClick={handleSave} disabled={isSaving}
        className={cn('shrink-0 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest flex items-center gap-1 active:scale-95 disabled:opacity-60', compact ? 'h-7 px-2.5 text-[9px]' : 'h-8 px-3 text-[10px]')}>
        {isSaving ? <Loader className="animate-spin w-3 h-3"/> : <><Save className="w-3 h-3"/>Save</>}
      </button>
    </div>
  );

  const renderMobilePanelBody = () => (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {mobileFieldView && selectedSection && selectedDef ? (
        <>
          <div className="px-3 pt-2 pb-2.5 border-b flex items-center gap-2 shrink-0">
            <button onClick={() => { setMobileFieldView(false); setMobilePanelTab('sections'); }}
              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary shrink-0">
              <ChevronDown className="w-3.5 h-3.5"/>Back
            </button>
            <span className="text-muted-foreground/30 shrink-0">/</span>
            <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: selectedDef.color + '18' }}>
              {React.createElement(selectedDef.icon, { className: 'w-2.5 h-2.5', style: { color: selectedDef.color } })}
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 truncate">{selectedDef.label}</span>
            {highlightedField && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded-lg shrink-0 ml-auto">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"/>
                <span className="text-[8px] font-black text-indigo-600 uppercase">{highlightedField}</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            {renderFieldEditor()}
            <div className="pb-12"/>
          </div>
        </>
      ) : mobilePanelTab === 'sections' ? (
        <>
          <div className="px-3 pt-2.5 pb-2 flex items-center justify-between shrink-0">
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/40">{showLibrary ? 'Add section' : 'Active sections'}</span>
            <button onClick={() => setShowLibrary(!showLibrary)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest border-primary/20 bg-primary/5 text-primary">
              {showLibrary ? <><X className="w-3 h-3"/>Done</> : <><Plus className="w-3 h-3"/>Add</>}
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="space-y-1.5">
              {showLibrary
                ? availableTypes.length === 0
                  ? <p className="py-8 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground/30">All sections active</p>
                  : availableTypes.map(t => <LibraryItem key={t} type={t} onAdd={() => { addSection(t); setMobileFieldView(true); if (!isLandscape) setMobileSheet('full'); }}/>)
                : enabledSections.length === 0
                  ? <p className="py-8 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground/30">No active sections</p>
                  : enabledSections.map((s, idx) => (
                      <SectionListItem key={s.id} section={s} isSelected={selectedId === s.id}
                        isFirst={idx === 0} isLast={idx === enabledSections.length - 1}
                        onSelect={() => { setSelectedId(s.id); setMobileFieldView(true); setShowLibrary(false); if (!isLandscape) setMobileSheet('full'); }}
                        onMoveUp={() => moveUp(s.id)} onMoveDown={() => moveDown(s.id)}
                        onHide={() => hideSection(s.id)} onDuplicate={() => duplicateSection(s.id)}
                        onToggleVisible={() => toggleVisible(s.id)}/>
                    ))
              }
            </div>
            <div className="pb-12"/>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          {renderStylePanel()}
          <div className="pb-12"/>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-slate-50/50">
      <AppHeader title="Page Builder"/>

      {isDirty && (
        <div className="flex items-center justify-between gap-4 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <div className="flex items-center gap-2 text-amber-700"><AlertCircle className="w-3.5 h-3.5 shrink-0"/><span className="text-[10px] font-black uppercase tracking-widest">Unsaved changes</span></div>
          <div className="flex items-center gap-2">
            <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 disabled:opacity-30 transition-all"><Undo2 className="w-3.5 h-3.5"/></button>
            <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 disabled:opacity-30 transition-all"><Redo2 className="w-3.5 h-3.5"/></button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-7 px-4 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md shadow-primary/20">
              {isSaving ? <Loader className="animate-spin w-3 h-3"/> : <><Save className="w-3 h-3 mr-1.5"/>Save</>}
            </Button>
          </div>
        </div>
      )}

      {/* ═══ MOBILE ══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex-1 min-h-0 relative overflow-hidden">
        {isLandscape && (
          <div className="absolute inset-0 flex">
            {/* ─ preview ─ */}
            <div className="flex-1 min-w-0 relative overflow-hidden" style={{ background: resolvedPreviewStyle.bgColor }}>
              {selectedTenant ? (
                // transform: translateZ(0) scopes position:fixed children to this div
                <div className="w-full h-full overflow-y-auto overflow-x-hidden"
                  style={{ transform: 'translateZ(0)' }}>
                  {renderPreview()}
                </div>
              ) : <div className="w-full h-full flex items-center justify-center"><Eye className="w-10 h-10 text-slate-200"/></div>}
              {!drawerOpen && (
                <button onClick={() => setDrawerOpen(true)} className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 py-4 bg-white border-y border-l border-border rounded-l-xl shadow-lg flex flex-col items-center gap-1.5 text-primary">
                  <Layers className="w-3.5 h-3.5"/>
                  <span style={{ writingMode: 'vertical-lr', fontSize: '8px', fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', transform: 'rotate(180deg)' }}>Edit</span>
                </button>
              )}
              <div className="absolute top-2 right-2 flex gap-1.5 z-10">
                {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-white/90 backdrop-blur shadow flex items-center justify-center text-slate-500"><ExternalLink className="w-3.5 h-3.5"/></a>}
              </div>
            </div>
            {/* ─ editor panel ─ */}
            <div className="h-full bg-white border-l flex flex-col shadow-2xl overflow-hidden transition-all duration-300 shrink-0" style={{ width: drawerOpen ? 'min(300px,58vw)' : '0px' }}>
              {drawerOpen && (
                <>
                  <div className="shrink-0 border-b px-2 py-1.5 flex items-center gap-2">
                    {renderMobileTabBar({ compact: true })}
                    <button onClick={() => setDrawerOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-muted shrink-0"><X className="w-3.5 h-3.5"/></button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{renderMobilePanelBody()}</div>
                </>
              )}
            </div>
          </div>
        )}
        {!isLandscape && (
          <>
            {/* ─ preview ─ */}
            <div className="absolute inset-0 overflow-hidden" style={{ background: resolvedPreviewStyle.bgColor }}>
              {selectedTenant ? (
                // transform: translateZ(0) scopes position:fixed children to this div
                <div className="w-full h-full overflow-y-auto overflow-x-hidden"
                  style={{ transform: 'translateZ(0)' }}>
                  {renderPreview()}
                </div>
              ) : <div className="w-full h-full flex items-center justify-center"><Eye className="w-10 h-10 text-slate-200"/></div>}
            </div>
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
              {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-xl bg-white/90 backdrop-blur shadow-lg flex items-center justify-center text-slate-500"><ExternalLink className="w-4 h-4"/></a>}
            </div>
            {/* ─ bottom sheet ─ */}
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-[0_-8px_40px_rgba(0,0,0,0.14)] flex flex-col z-20"
              style={{ height: '100%', transform: `translateY(${sheetTranslate})`, transition: 'transform 0.32s cubic-bezier(0.16,1,0.3,1)' }}>
              <div className="shrink-0 cursor-pointer select-none pt-2.5" style={{ height: `${HANDLE_H}px` }} onClick={cycleSheet}>
                <div className="flex justify-center mb-2"><div className="w-9 h-1 rounded-full bg-slate-200"/></div>
                <div className="px-3 flex items-center gap-2">
                  {renderMobileTabBar()}
                  <button onClick={e => { e.stopPropagation(); cycleSheet(); }} className="w-8 h-8 rounded-xl border-2 border-border flex items-center justify-center text-slate-400 shrink-0">
                    {mobileSheet === 'full' ? <ChevronDown className="w-4 h-4"/> : <ChevronUp className="w-4 h-4"/>}
                  </button>
                </div>
              </div>
              {mobileSheet !== 'closed' && (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col border-t border-slate-100">{renderMobilePanelBody()}</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ═══ DESKTOP ══════════════════════════════════════════════════════════ */}
      <main className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full w-full">

          {/* Left sidebar */}
          <div className="w-72 h-full flex flex-col border-r bg-white shrink-0">
            <div className="p-3 border-b flex items-center gap-2 shrink-0">
              <div className="flex gap-1 flex-1">
                <button onClick={() => { setShowLibrary(false); setActivePanel('sections'); }} className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all', activePanel === 'sections' && !showLibrary ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Sections</button>
                <button onClick={() => { setShowLibrary(false); setActivePanel('style'); }} className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all', activePanel === 'style' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Style</button>
              </div>
              {activePanel === 'sections' && <button onClick={() => setShowLibrary(!showLibrary)} className="w-7 h-7 rounded-lg border-2 border-primary/20 bg-primary/5 flex items-center justify-center text-primary hover:bg-primary/10 transition-all">{showLibrary ? <X className="w-3.5 h-3.5"/> : <Plus className="w-3.5 h-3.5"/>}</button>}
            </div>
            <ScrollArea className="flex-1 min-h-0 p-3">
              {activePanel === 'sections' && !showLibrary && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Active sections</p>
                  {enabledSections.map((s, idx) => (
                    <div key={s.id} draggable onDragStart={() => setDragId(s.id)}
                      onDragOver={e => { e.preventDefault(); setDragOverId(s.id); }}
                      onDragLeave={() => setDragOverId(null)} onDrop={() => handleDrop(s.id)}
                      className={cn('transition-all duration-150', dragOverId === s.id && dragId !== s.id && 'ring-2 ring-primary/40 rounded-2xl scale-[1.01]')}>
                      <SectionListItem section={s} isSelected={selectedId === s.id} isFirst={idx === 0} isLast={idx === enabledSections.length - 1}
                        onSelect={() => { setSelectedId(s.id); setActivePanel('sections'); setHighlightedField(null); }}
                        onMoveUp={() => moveUp(s.id)} onMoveDown={() => moveDown(s.id)} onHide={() => hideSection(s.id)} onDuplicate={() => duplicateSection(s.id)}
                        onToggleVisible={() => toggleVisible(s.id)}/>
                    </div>
                  ))}
                  {enabledSections.length === 0 && <div className="py-8 text-center text-muted-foreground/40 text-xs font-black uppercase tracking-widest">No active sections</div>}
                </div>
              )}
              {activePanel === 'sections' && showLibrary && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Add sections</p>
                  {availableTypes.length === 0 ? <div className="py-8 text-center text-muted-foreground/40 text-xs font-black uppercase tracking-widest">All sections active</div> : availableTypes.map(t => <LibraryItem key={t} type={t} onAdd={() => addSection(t)}/>)}
                </div>
              )}
              {activePanel === 'style' && renderStylePanel()}
            </ScrollArea>
            <div className="p-3 border-t bg-white space-y-2 shrink-0">
              <div className="flex gap-1.5">
                <button onClick={undo} disabled={!canUndo} className="flex-1 h-8 rounded-xl border-2 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-30 hover:border-primary/20 transition-all"><Undo2 className="w-3 h-3"/>Undo</button>
                <button onClick={redo} disabled={!canRedo} className="flex-1 h-8 rounded-xl border-2 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground disabled:opacity-30 hover:border-primary/20 transition-all">Redo<Redo2 className="w-3 h-3"/></button>
              </div>
              {selectedTenant && <a href={`/book/${selectedTenant.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full h-8 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"><Eye className="w-3.5 h-3.5"/>Open live page<ExternalLink className="w-3 h-3"/></a>}
              <Button onClick={handleSave} disabled={isSaving} className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                {isSaving ? <><Loader className="animate-spin w-3.5 h-3.5 mr-2"/>Saving...</> : <><Save className="w-3.5 h-3.5 mr-2"/>Save page</>}
              </Button>
            </div>
          </div>

          {/* Center: field editor */}
          <div className="w-80 xl:w-[420px] h-full flex flex-col border-r bg-white shrink-0">
            {selectedSection && activePanel === 'sections' ? (
              <>
                <div className="p-4 border-b bg-white flex items-center gap-3 shrink-0">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: selectedDef!.color + '18' }}>
                    {React.createElement(selectedDef!.icon, { className: 'w-4 h-4', style: { color: selectedDef!.color } })}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">{selectedDef!.label}</h2>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Content & configuration</p>
                  </div>
                  {highlightedField && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"/>
                      <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Editing: {highlightedField}</span>
                    </div>
                  )}
                </div>
                <ScrollArea className="flex-1 min-h-0">{renderFieldEditor()}</ScrollArea>
              </>
            ) : activePanel === 'style' ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="w-16 h-16 rounded-[1.5rem] bg-primary/10 flex items-center justify-center"><Palette className="w-8 h-8 text-primary"/></div>
                <div className="flex flex-col items-center gap-4 w-full">
                  <div style={{ fontFamily: headingFontDef?.stack, color: style.accentColor, fontSize: '28px', fontWeight: 300 }}>{headingFontDef?.label}</div>
                  <div style={{ fontFamily: bodyFontDef?.stack, color: '#64748b', fontSize: '14px' }}>Body — {bodyFontDef?.label}</div>
                  <div className="flex gap-2 mt-2">
                    <div className="w-8 h-8 rounded-full" style={{ background: style.accentColor }}/>
                    <div className="w-8 h-8 rounded-full" style={{ background: style.bgColor, border: '2px solid #e2e8f0' }}/>
                  </div>
                  <div className="px-5 py-2 text-sm font-bold" style={{ background: style.buttonStyle === 'filled' ? style.accentColor : 'transparent', color: style.buttonStyle === 'filled' ? '#fff' : style.accentColor, border: style.buttonStyle === 'ghost' ? 'none' : `2px solid ${style.accentColor}`, borderRadius: style.buttonStyle === 'pill' ? 999 : style.borderRadius }}>Book Now</div>
                  <p className="text-[9px] text-muted-foreground/50 text-center">Adjust colors, fonts & spacing in the left panel</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                <div className="w-16 h-16 rounded-[1.5rem] bg-muted flex items-center justify-center"><Settings className="w-8 h-8 text-muted-foreground/40"/></div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900">Select a section</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 max-w-xs">Click any section in the left panel to edit its content</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-xs mt-1">
                  {enabledSections.slice(0, 6).map(s => {
                    const d = SECTION_DEFS[s.type as SectionType];
                    return <button key={s.id} onClick={() => setSelectedId(s.id)} className="px-3 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all hover:shadow-md" style={{ borderColor: d.color + '40', color: d.color, background: d.color + '0a' }}>{d.label}</button>;
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="flex-1 min-w-0 h-full flex flex-col bg-slate-100">
            <div className="h-12 px-4 border-b bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live Preview</span>
                {isDirty && <Badge variant="secondary" className="text-[8px] font-black uppercase tracking-widest">Unsaved</Badge>}
                <span className="text-[9px] text-slate-300 font-bold hidden xl:block">· Hover to select · Click text to edit field</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 p-1 bg-slate-100 rounded-lg">
                  <button onClick={() => setPreviewMode('desktop')} className={cn('p-1.5 rounded-md transition-all', previewMode === 'desktop' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600')} title="Desktop"><Monitor className="w-3.5 h-3.5"/></button>
                  <button onClick={() => setPreviewMode('mobile')}  className={cn('p-1.5 rounded-md transition-all', previewMode === 'mobile'  ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600')} title="Mobile"><Smartphone className="w-3.5 h-3.5"/></button>
                </div>
                {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all" title="Open live page"><ExternalLink className="w-3.5 h-3.5"/></a>}
              </div>
            </div>
            <div className={cn('flex-1 min-h-0 overflow-hidden flex', previewMode === 'mobile' ? 'items-start justify-center p-6 bg-slate-200' : 'bg-slate-100')}>
              {selectedTenant ? (
                // transform: translateZ(0) scopes position:fixed children to this scroll div
                // so the bottom-bar nav appears at the bottom of the preview, not the browser window
                <div
                  className={cn(
                    'overflow-y-auto overflow-x-hidden h-full',
                    previewMode === 'desktop'
                      ? 'w-full rounded-xl shadow-xl bg-white'
                      : 'w-[390px] shrink-0 rounded-[2rem] shadow-2xl ring-8 ring-slate-800 bg-white'
                  )}
                  style={{ background: resolvedPreviewStyle.bgColor, transform: 'translateZ(0)' }}>
                  {renderPreview()}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <Eye className="w-10 h-10 text-slate-200 mx-auto"/>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">No tenant selected</p>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}