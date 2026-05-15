'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import nextDynamic from 'next/dynamic';
const AppHeader = nextDynamic(
  () => import('@/components/shared/AppHeader').then(m => ({ default: m.AppHeader })),
  { ssr: false }
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
  RefreshCw, AlertCircle, Copy, Trash2, GripVertical,
  Instagram, Facebook, Twitter, Youtube, Globe, Music2,
  Linkedin, Github, MessageCircle, Phone, Mail,
  ChevronRight, Layers, Wand2, Undo2, Redo2,
  ShieldCheck, Heart, Zap, Coffee, Leaf, Flame,
  AlertTriangle, Info, Ban, Clock3, CreditCard, BadgeCheck,
  Hash, AtSign, Link2, ArrowLeftRight,
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

interface SectionField {
  k: string;
  t: FieldType;
  l: string;
  d: any;
  opts?: string[];
  min?: number;
  max?: number;
  step?: number;
}

interface SectionLayoutOption {
  id: string;
  label: string;
  preview: string;
}

interface SectionDef {
  label: string;
  icon: React.ElementType;
  color: string;
  fields: SectionField[];
  layouts?: SectionLayoutOption[];
}

interface PolicyItem {
  id: string;
  icon: string;
  title: string;
  body: string;
}

interface SocialLink {
  platform: string;
  url: string;
}

interface GalleryImage {
  id: string;
  url: string;
  caption?: string;
  category?: string;
}

interface BeforeAfterPair {
  id: string;
  beforeUrl: string;
  afterUrl: string;
  caption?: string;
}

// ─── Google Fonts loader ──────────────────────────────────────────────────────
const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&' +
  'family=Playfair+Display:wght@400;700&' +
  'family=Lora:wght@400;600&' +
  'family=Merriweather:wght@300;400;700&' +
  'family=EB+Garamond:wght@400;600&' +
  'family=Libre+Baskerville:wght@400;700&' +
  'family=DM+Serif+Display&' +
  'family=Domine:wght@400;700&' +
  'family=Space+Grotesk:wght@300;400;700&' +
  'family=Josefin+Sans:wght@300;400;700&' +
  'family=Raleway:wght@300;400;700&' +
  'family=Montserrat:wght@300;400;700&' +
  'family=Nunito:wght@300;400;700&' +
  'family=Poppins:wght@300;400;700&' +
  'family=Outfit:wght@300;400;700&' +
  'family=DM+Sans:wght@300;400;700&' +
  'family=Inter:wght@300;400;700&' +
  'family=Figtree:wght@300;400;700&' +
  'family=Bebas+Neue&' +
  'family=Oswald:wght@300;400;700&' +
  'family=Anton&' +
  'family=Righteous&' +
  'family=Abril+Fatface&' +
  'family=Pacifico&' +
  'family=Dancing+Script:wght@400;700&' +
  'family=Great+Vibes&' +
  'family=JetBrains+Mono:wght@400;700&' +
  'family=Space+Mono:wght@400;700&' +
  'display=swap';

function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById('pb-google-fonts')) return;
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pre);
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect';
    pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous';
    document.head.appendChild(pre2);
    const link = document.createElement('link');
    link.id = 'pb-google-fonts';
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
  }, []);
}

// ─── Font library ─────────────────────────────────────────────────────────────
const FONTS = [
  { id: 'cormorant',    label: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif",           desc: 'Luxury serif',     group: 'Serif'   },
  { id: 'playfair',     label: 'Playfair Display',   stack: "'Playfair Display', Georgia, serif",             desc: 'Editorial serif',  group: 'Serif'   },
  { id: 'lora',         label: 'Lora',               stack: "'Lora', Georgia, serif",                         desc: 'Elegant serif',    group: 'Serif'   },
  { id: 'merriweather', label: 'Merriweather',        stack: "'Merriweather', Georgia, serif",                 desc: 'Classic serif',    group: 'Serif'   },
  { id: 'eb-garamond',  label: 'EB Garamond',         stack: "'EB Garamond', Georgia, serif",                  desc: 'Old-style',        group: 'Serif'   },
  { id: 'libre-bask',   label: 'Libre Baskerville',  stack: "'Libre Baskerville', Georgia, serif",             desc: 'Traditional',      group: 'Serif'   },
  { id: 'dm-serif',     label: 'DM Serif Display',   stack: "'DM Serif Display', Georgia, serif",              desc: 'Modern serif',     group: 'Serif'   },
  { id: 'domine',       label: 'Domine',             stack: "'Domine', Georgia, serif",                        desc: 'Humanist serif',   group: 'Serif'   },
  { id: 'space',        label: 'Space Grotesk',      stack: "'Space Grotesk', system-ui, sans-serif",          desc: 'Modern sans',      group: 'Sans'    },
  { id: 'josefin',      label: 'Josefin Sans',       stack: "'Josefin Sans', system-ui, sans-serif",           desc: 'Geometric sans',   group: 'Sans'    },
  { id: 'raleway',      label: 'Raleway',            stack: "'Raleway', system-ui, sans-serif",                desc: 'Elegant sans',     group: 'Sans'    },
  { id: 'montserrat',   label: 'Montserrat',         stack: "'Montserrat', system-ui, sans-serif",              desc: 'Clean sans',       group: 'Sans'    },
  { id: 'nunito',       label: 'Nunito',             stack: "'Nunito', system-ui, sans-serif",                  desc: 'Friendly rounded', group: 'Sans'    },
  { id: 'poppins',      label: 'Poppins',            stack: "'Poppins', system-ui, sans-serif",                 desc: 'Geometric clean',  group: 'Sans'    },
  { id: 'outfit',       label: 'Outfit',             stack: "'Outfit', system-ui, sans-serif",                  desc: 'Minimalist sans',  group: 'Sans'    },
  { id: 'dm-sans',      label: 'DM Sans',            stack: "'DM Sans', system-ui, sans-serif",                 desc: 'Neutral sans',     group: 'Sans'    },
  { id: 'inter',        label: 'Inter',              stack: "'Inter', system-ui, sans-serif",                   desc: 'UI-optimized',     group: 'Sans'    },
  { id: 'figtree',      label: 'Figtree',            stack: "'Figtree', system-ui, sans-serif",                 desc: 'Contemporary',     group: 'Sans'    },
  { id: 'bebas',        label: 'Bebas Neue',         stack: "'Bebas Neue', Impact, sans-serif",                 desc: 'Bold display',     group: 'Display' },
  { id: 'oswald',       label: 'Oswald',             stack: "'Oswald', system-ui, sans-serif",                  desc: 'Condensed bold',   group: 'Display' },
  { id: 'anton',        label: 'Anton',              stack: "'Anton', Impact, sans-serif",                       desc: 'Heavy impact',     group: 'Display' },
  { id: 'righteous',    label: 'Righteous',          stack: "'Righteous', system-ui, sans-serif",                desc: 'Bold retro',       group: 'Display' },
  { id: 'abril',        label: 'Abril Fatface',      stack: "'Abril Fatface', Georgia, serif",                   desc: 'Fat display',      group: 'Display' },
  { id: 'pacifico',     label: 'Pacifico',           stack: "'Pacifico', cursive",                               desc: 'Casual script',    group: 'Display' },
  { id: 'dancing',      label: 'Dancing Script',     stack: "'Dancing Script', cursive",                         desc: 'Elegant script',   group: 'Display' },
  { id: 'great-vibes',  label: 'Great Vibes',        stack: "'Great Vibes', cursive",                            desc: 'Luxury script',    group: 'Display' },
  { id: 'jetbrains',    label: 'JetBrains Mono',     stack: "'JetBrains Mono', 'Courier New', monospace",        desc: 'Developer mono',   group: 'Mono'    },
  { id: 'space-mono',   label: 'Space Mono',         stack: "'Space Mono', 'Courier New', monospace",             desc: 'Techy mono',       group: 'Mono'    },
  { id: 'system',       label: 'System UI',          stack: 'system-ui, sans-serif',                              desc: 'Default clean',    group: 'System'  },
  { id: 'georgia',      label: 'Georgia',            stack: 'Georgia, serif',                                     desc: 'Classic system',   group: 'System'  },
];

const FONT_GROUPS = ['Serif', 'Sans', 'Display', 'Mono', 'System'];

// ─── Brand kits ───────────────────────────────────────────────────────────────
const BRAND_KITS = [
  { id: 'champagne', label: 'Champagne', accentColor: '#8b6914', bgColor: '#f8f4ef', headingFont: 'cormorant',    bodyFont: 'raleway',      borderRadius: 8,  desc: 'Warm luxury'    },
  { id: 'midnight',  label: 'Midnight',  accentColor: '#534AB7', bgColor: '#0b0b0b', headingFont: 'playfair',     bodyFont: 'dm-sans',      borderRadius: 4,  desc: 'Dark editorial' },
  { id: 'blush',     label: 'Blush',     accentColor: '#c4718a', bgColor: '#fff5f7', headingFont: 'dancing',      bodyFont: 'nunito',       borderRadius: 16, desc: 'Soft feminine'  },
  { id: 'sage',      label: 'Sage',      accentColor: '#0F6E56', bgColor: '#f0f8f4', headingFont: 'dm-serif',     bodyFont: 'poppins',      borderRadius: 12, desc: 'Natural calm'   },
  { id: 'slate',     label: 'Slate',     accentColor: '#334155', bgColor: '#ffffff', headingFont: 'josefin',      bodyFont: 'inter',        borderRadius: 6,  desc: 'Clean minimal'  },
  { id: 'coral',     label: 'Coral',     accentColor: '#A32D2D', bgColor: '#fafafa', headingFont: 'abril',        bodyFont: 'montserrat',   borderRadius: 4,  desc: 'Bold & warm'    },
  { id: 'lavender',  label: 'Lavender',  accentColor: '#7c3aed', bgColor: '#faf8ff', headingFont: 'playfair',     bodyFont: 'outfit',       borderRadius: 14, desc: 'Modern luxe'    },
  { id: 'espresso',  label: 'Espresso',  accentColor: '#854F0B', bgColor: '#f5f0eb', headingFont: 'merriweather', bodyFont: 'lora',         borderRadius: 6,  desc: 'Rich warmth'    },
  { id: 'electric',  label: 'Electric',  accentColor: '#185FA5', bgColor: '#ffffff', headingFont: 'bebas',        bodyFont: 'figtree',      borderRadius: 3,  desc: 'Bold modern'    },
  { id: 'forest',    label: 'Forest',    accentColor: '#3B6D11', bgColor: '#f4f7f0', headingFont: 'eb-garamond',  bodyFont: 'dm-sans',      borderRadius: 10, desc: 'Earthy organic' },
  { id: 'noir',      label: 'Noir',      accentColor: '#c9a84c', bgColor: '#111111', headingFont: 'cormorant',    bodyFont: 'space',        borderRadius: 2,  desc: 'Gold on black'  },
  { id: 'bubbly',    label: 'Bubbly',    accentColor: '#c4718a', bgColor: '#fff5f7', headingFont: 'righteous',    bodyFont: 'nunito',       borderRadius: 24, desc: 'Fun & playful'  },
];

// ─── Social platforms ─────────────────────────────────────────────────────────
const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram',  icon: Instagram,     placeholder: 'https://instagram.com/yourstudio',  color: '#E1306C' },
  { id: 'facebook',  label: 'Facebook',   icon: Facebook,      placeholder: 'https://facebook.com/yourstudio',   color: '#1877F2' },
  { id: 'tiktok',    label: 'TikTok',     icon: Music2,        placeholder: 'https://tiktok.com/@yourstudio',    color: '#000000' },
  { id: 'youtube',   label: 'YouTube',    icon: Youtube,       placeholder: 'https://youtube.com/@yourstudio',   color: '#FF0000' },
  { id: 'twitter',   label: 'X / Twitter', icon: Twitter,      placeholder: 'https://x.com/yourstudio',          color: '#000000' },
  { id: 'pinterest', label: 'Pinterest',  icon: Hash,          placeholder: 'https://pinterest.com/yourstudio',  color: '#E60023' },
  { id: 'linkedin',  label: 'LinkedIn',   icon: Linkedin,      placeholder: 'https://linkedin.com/company/yourstudio', color: '#0A66C2' },
  { id: 'threads',   label: 'Threads',    icon: AtSign,        placeholder: 'https://threads.net/@yourstudio',   color: '#000000' },
  { id: 'website',   label: 'Website',    icon: Globe,         placeholder: 'https://yourstudio.com',            color: '#334155' },
];

// ─── Policy icons ─────────────────────────────────────────────────────────────
const POLICY_ICONS = [
  { id: 'shield',       icon: Shield,        label: 'Shield'   },
  { id: 'shield-check', icon: ShieldCheck,   label: 'Check'    },
  { id: 'clock',        icon: Clock,         label: 'Clock'    },
  { id: 'clock3',       icon: Clock3,        label: 'Alarm'    },
  { id: 'alert',        icon: AlertTriangle, label: 'Warning'  },
  { id: 'ban',          icon: Ban,           label: 'No'       },
  { id: 'credit',       icon: CreditCard,    label: 'Payment'  },
  { id: 'heart',        icon: Heart,         label: 'Heart'    },
  { id: 'badge',        icon: BadgeCheck,    label: 'Badge'    },
  { id: 'info',         icon: Info,          label: 'Info'     },
  { id: 'zap',          icon: Zap,           label: 'Zap'      },
  { id: 'leaf',         icon: Leaf,          label: 'Leaf'     },
  { id: 'coffee',       icon: Coffee,        label: 'Care'     },
  { id: 'flame',        icon: Flame,         label: 'Hot'      },
  { id: 'phone',        icon: Phone,         label: 'Phone'    },
  { id: 'mail',         icon: Mail,          label: 'Mail'     },
];

// ─── Section definitions ──────────────────────────────────────────────────────
const SECTION_DEFS: Record<SectionType, SectionDef> = {
  nav: {
    label: 'Navigation', icon: Navigation, color: '#3B6D11',
    fields: [
      { k: 'logoUrl',     t: 'image',        l: 'Logo image',           d: ''          },
      { k: 'logoText',    t: 'text',         l: 'Studio name',          d: 'Opal'      },
      { k: 'ctaText',     t: 'text',         l: 'Button label',         d: 'Book Now'  },
      { k: 'ctaAction',   t: 'select',       l: 'Button action',        d: 'booking',  opts: ['booking', 'scroll-services', 'scroll-contact', 'url'] },
      { k: 'ctaUrl',      t: 'text',         l: 'Custom URL (if url)',  d: ''          },
      { k: 'showLinks',   t: 'toggle',       l: 'Show nav links',       d: true        },
      { k: 'sticky',      t: 'toggle',       l: 'Sticky nav',           d: true        },
      { k: 'transparent', t: 'toggle',       l: 'Transparent on hero',  d: false       },
      { k: 'socialLinks', t: 'social-links', l: 'Social links',         d: []          },
    ],
    layouts: [
      { id: 'centered',  label: 'Centered',      preview: '[ logo | links | cta ]'        },
      { id: 'split',     label: 'Logo left',     preview: '[ logo ] ──── [ links | cta ]' },
      { id: 'minimal',   label: 'Minimal',       preview: '[ logo ] ─────────── [ cta ]'  },
      { id: 'logo-top',  label: 'Logo stacked',  preview: '[ logo ]\n[ links | cta ]'     },
    ],
  },
  hero: {
    label: 'Hero', icon: ImageIcon, color: '#534AB7',
    fields: [
      { k: 'bgImage',          t: 'image',    l: 'Background image',        d: ''                },
      { k: 'heroImage',        t: 'image',    l: 'Feature image (split)',    d: ''                },
      { k: 'overlayOpacity',   t: 'range',    l: 'Overlay opacity',          d: 40, min: 0, max: 90, step: 5 },
      { k: 'headline',         t: 'text',     l: 'Headline',                d: 'Book Your Experience' },
      { k: 'subheadline',      t: 'textarea', l: 'Subheadline',             d: 'A sanctuary of craft, curated for those who appreciate the details.' },
      { k: 'ctaText',          t: 'text',     l: 'Primary button',          d: 'Book a Session'  },
      { k: 'ctaAction',        t: 'select',   l: 'Primary action',          d: 'booking',  opts: ['booking', 'scroll-services', 'url'] },
      { k: 'showWalkIn',       t: 'toggle',   l: 'Show walk-in button',     d: true              },
      { k: 'cta2Text',         t: 'text',     l: 'Walk-in button label',    d: 'Walk In Today'   },
      { k: 'cta2Action',       t: 'select',   l: 'Walk-in action',          d: 'scroll-contact', opts: ['booking', 'scroll-contact', 'scroll-services', 'url'] },
      { k: 'videoUrl',         t: 'text',     l: 'Background video URL',    d: ''                },
      { k: 'showBadge',        t: 'toggle',   l: 'Show trust badge',        d: false             },
      { k: 'badgeText',        t: 'text',     l: 'Badge text',              d: '⭐ 4.9 · 500+ clients' },
    ],
    layouts: [
      { id: 'centered',  label: 'Centered',   preview: '[ bg image ]\n  headline\n  cta'      },
      { id: 'split',     label: 'Split',      preview: '[ text | image ]'                     },
      { id: 'fullbleed', label: 'Full bleed', preview: '[ full bg · text overlay ]'           },
      { id: 'minimal',   label: 'Minimal',    preview: '[ white bg · centered text ]'         },
      { id: 'cinematic', label: 'Cinematic',  preview: '[ video/tall bg · bottom text ]'      },
      { id: 'magazine',  label: 'Magazine',   preview: '[ large text left · image right ]'    },
    ],
  },
  trust: {
    label: 'Trust Strip', icon: Award, color: '#854F0B',
    fields: [
      { k: 'stat1l',      t: 'text',   l: 'Stat 1 label',               d: 'Happy clients' },
      { k: 'stat1v',      t: 'text',   l: 'Stat 1 value',               d: '500+'          },
      { k: 'stat2l',      t: 'text',   l: 'Stat 2 label',               d: 'Avg rating'    },
      { k: 'stat2v',      t: 'text',   l: 'Stat 2 value',               d: '4.9'           },
      { k: 'stat3l',      t: 'text',   l: 'Stat 3 label',               d: 'Years open'    },
      { k: 'stat3v',      t: 'text',   l: 'Stat 3 value',               d: '6'             },
      { k: 'stat4l',      t: 'text',   l: 'Stat 4 label',               d: 'Services'      },
      { k: 'stat4v',      t: 'text',   l: 'Stat 4 value',               d: '20+'           },
      { k: 'animate',     t: 'toggle', l: 'Animate counters on scroll', d: true            },
      { k: 'showDividers', t: 'toggle', l: 'Show dividers',             d: true            },
    ],
    layouts: [
      { id: 'strip',    label: 'Horizontal strip',  preview: '[ stat | stat | stat | stat ]'  },
      { id: 'cards',    label: 'Stat cards',        preview: '┌──┐┌──┐┌──┐┌──┐'              },
      { id: 'centered', label: 'Centered large',    preview: '   stat   stat   stat   '       },
      { id: 'banner',   label: 'Dark banner',       preview: '▓▓▓[ stat | stat | stat ]▓▓▓'  },
      { id: 'ticker',   label: 'Scrolling ticker',  preview: '→ stat · stat · stat · →'      },
    ],
  },
  services: {
    label: 'Services', icon: Scissors, color: '#185FA5',
    fields: [
      { k: 'heading',      t: 'text',   l: 'Section heading',    d: 'Our Services'                           },
      { k: 'subheading',   t: 'text',   l: 'Subheading',         d: 'Handcrafted treatments for every occasion' },
      { k: 'ctaText',      t: 'text',   l: 'Book button text',   d: 'Book this service'                      },
      { k: 'ctaAction',    t: 'select', l: 'Button action',      d: 'booking', opts: ['booking', 'url']      },
      { k: 'columns',      t: 'select', l: 'Columns',            d: '2', opts: ['1', '2', '3']               },
      { k: 'showPrices',   t: 'toggle', l: 'Show prices',        d: true                                     },
      { k: 'showDuration', t: 'toggle', l: 'Show duration',      d: true                                     },
      { k: 'showFilters',  t: 'toggle', l: 'Category filter',    d: false                                    },
      { k: 'showDesc',     t: 'toggle', l: 'Show descriptions',  d: true                                     },
      { k: 'showImages',   t: 'toggle', l: 'Show service images', d: false                                   },
      { k: 'hoverEffect',  t: 'toggle', l: 'Hover lift effect',  d: true                                     },
    ],
    layouts: [
      { id: 'cards',     label: 'Cards',         preview: '┌────┐ ┌────┐\n│svc │ │svc │'    },
      { id: 'list',      label: 'List',          preview: '── Service · duration · price ──' },
      { id: 'magazine',  label: 'Magazine',      preview: '[ large img | text + price ]'     },
      { id: 'grid',      label: 'Compact grid',  preview: '┌──┬──┬──┐\n│  │  │  │'         },
      { id: 'accordion', label: 'Accordion',     preview: '▶ Service category\n  · item'     },
      { id: 'featured',  label: 'Featured',      preview: '[ hero service ]\n[ other · other ]' },
    ],
  },
  team: {
    label: 'Team', icon: Users, color: '#0F6E56',
    fields: [
      { k: 'heading',         t: 'text',   l: 'Section heading',     d: 'The Artists'              },
      { k: 'subheading',      t: 'text',   l: 'Subheading',          d: 'Expert hands for every style' },
      { k: 'showBio',         t: 'toggle', l: 'Show bio',            d: false },
      { k: 'showSpecialties', t: 'toggle', l: 'Show specialties',    d: true  },
      { k: 'showBookButton',  t: 'toggle', l: 'Book per artist',     d: false },
      { k: 'bookCta',         t: 'text',   l: 'Book button text',    d: 'Book with me'  },
      { k: 'bookAction',      t: 'select', l: 'Book action',         d: 'booking', opts: ['booking', 'url'] },
      { k: 'hoverReveal',     t: 'toggle', l: 'Hover reveal bio',    d: true  },
    ],
    layouts: [
      { id: 'circles',   label: 'Circle avatars',  preview: '  ◯   ◯   ◯\n name name name'     },
      { id: 'editorial', label: 'Editorial cards', preview: '┌────┐ ┌────┐\n│img │ │img │'      },
      { id: 'row',       label: 'Horizontal row',  preview: '[ ◯ name ][ ◯ name ][ ◯ name ]'   },
      { id: 'grid',      label: 'Grid',            preview: '┌──┬──┬──┐\n│  │  │  │'           },
      { id: 'featured',  label: 'Featured artist', preview: '[ large lead ]\n◯ ◯ ◯ team'        },
      { id: 'minimal',   label: 'Minimal list',    preview: '— Name · Title\n— Name · Title'    },
    ],
  },
  reviews: {
    label: 'Reviews', icon: Star, color: '#993556',
    fields: [
      { k: 'heading',     t: 'text',   l: 'Section heading',      d: 'What Clients Say'           },
      { k: 'subheading',  t: 'text',   l: 'Subheading',           d: 'Real words from real guests' },
      { k: 'showRating',  t: 'toggle', l: 'Show star ratings',    d: true  },
      { k: 'showPhotos',  t: 'toggle', l: 'Show client photos',   d: true  },
      { k: 'autoScroll',  t: 'toggle', l: 'Auto-scroll carousel', d: false },
      { k: 'scrollSpeed', t: 'range',  l: 'Scroll speed (s)',     d: 4, min: 2, max: 10, step: 1 },
    ],
    layouts: [
      { id: 'grid',     label: 'Grid',         preview: '┌────┐ ┌────┐\n│ ★★★│ │ ★★★│' },
      { id: 'masonry',  label: 'Masonry',      preview: '┌──┐ ┌────┐\n│  │ │    │'     },
      { id: 'carousel', label: 'Carousel',     preview: '← [ review ] →'               },
      { id: 'quotes',   label: 'Large quotes', preview: '" quote text "'               },
      { id: 'ticker',   label: 'Auto-scroll',  preview: '→ review · review · →'        },
      { id: 'featured', label: 'Featured',     preview: '[ big quote ]\n[ ★ ★ ★ small ]' },
    ],
  },
  gallery: {
    label: 'Portfolio Gallery', icon: LayoutDashboard, color: '#534AB7',
    fields: [
      { k: 'heading',      t: 'text',        l: 'Section heading',   d: 'Our Work'            },
      { k: 'subheading',   t: 'text',        l: 'Subheading',        d: 'Every set, a canvas' },
      { k: 'images',       t: 'image-array', l: 'Gallery images',    d: []                    },
      { k: 'showFilters',  t: 'toggle',      l: 'Style filter tabs', d: true                  },
      { k: 'showCaptions', t: 'toggle',      l: 'Show captions',     d: false                 },
      { k: 'lightbox',     t: 'toggle',      l: 'Lightbox on click', d: true                  },
      { k: 'hoverEffect',  t: 'select',      l: 'Hover effect',      d: 'zoom', opts: ['zoom', 'fade', 'slide-up', 'none'] },
      { k: 'columns',      t: 'select',      l: 'Columns',           d: '3', opts: ['2', '3', '4'] },
    ],
    layouts: [
      { id: 'masonry',   label: 'Masonry',            preview: '┌──┐ ┌────┐\n│  │ │    │\n└──┘ └─┐  │' },
      { id: 'grid',      label: 'Uniform grid',       preview: '┌──┬──┬──┐\n│  │  │  │'              },
      { id: 'carousel',  label: 'Carousel',           preview: '← [ img ] →'                          },
      { id: 'editorial', label: 'Editorial',          preview: '[ large ][ sm ]\n[ sm ][ large ]'      },
      { id: 'fullwidth', label: 'Full-width scroll',  preview: '← scroll · img · img · img →'         },
      { id: 'mosaic',    label: 'Mosaic',             preview: '┌────┬──┐\n│    │  │\n├──┬─┴──┤'     },
    ],
  },
  beforeafter: {
    label: 'Before / After', icon: RotateCcw, color: '#0F6E56',
    fields: [
      { k: 'heading',     t: 'text',              l: 'Section heading',        d: 'Transformations'            },
      { k: 'subheading',  t: 'text',              l: 'Subheading',             d: 'See the difference we make' },
      { k: 'pairs',       t: 'beforeafter-pairs', l: 'Before / After pairs',   d: []                          },
      { k: 'sliderColor', t: 'color',             l: 'Slider handle color',    d: '#8b6914'                   },
      { k: 'autoPlay',    t: 'toggle',            l: 'Auto-reveal on scroll',  d: true                        },
      { k: 'showLabels',  t: 'toggle',            l: 'Show Before/After labels', d: true                      },
    ],
    layouts: [
      { id: 'slider',   label: 'Drag slider',    preview: '[ before ←→ after ]'   },
      { id: 'side',     label: 'Side by side',   preview: '[ before ] [ after ]'   },
      { id: 'stack',    label: 'Stacked hover',  preview: '[ hover to reveal ]'    },
      { id: 'carousel', label: 'Carousel pairs', preview: '← [ B/A pair ] →'      },
    ],
  },
  memberships: {
    label: 'Memberships', icon: Crown, color: '#534AB7',
    fields: [
      { k: 'heading',     t: 'text',   l: 'Section heading',   d: 'Join the Club'                   },
      { k: 'subheading',  t: 'text',   l: 'Subheading',        d: 'Exclusive perks for loyal guests' },
      { k: 'ctaText',     t: 'text',   l: 'Button text',       d: 'Get started'                     },
      { k: 'ctaAction',   t: 'select', l: 'Button action',     d: 'booking', opts: ['booking', 'url'] },
      { k: 'showSavings', t: 'toggle', l: 'Highlight savings', d: true                              },
      { k: 'showBadge',   t: 'toggle', l: 'Show popular badge', d: true                             },
    ],
    layouts: [
      { id: 'cards',    label: 'Pricing cards', preview: '┌────┐ ┌────┐ ┌────┐'  },
      { id: 'table',    label: 'Feature table', preview: '| ✓  | ✓  | ✓  |'      },
      { id: 'minimal',  label: 'Minimal list',  preview: '── Tier · price ──'     },
      { id: 'featured', label: 'Featured tier', preview: '[ best ] [sm] [sm]'     },
    ],
  },
  packages: {
    label: 'Packages', icon: Package, color: '#185FA5',
    fields: [
      { k: 'heading',     t: 'text',   l: 'Section heading', d: 'Prepaid Sessions'    },
      { k: 'subheading',  t: 'text',   l: 'Subheading',      d: 'Buy more, save more' },
      { k: 'ctaText',     t: 'text',   l: 'Button text',     d: 'Buy package'         },
      { k: 'ctaAction',   t: 'select', l: 'Button action',   d: 'booking', opts: ['booking', 'url'] },
      { k: 'showExpiry',  t: 'toggle', l: 'Show expiry',     d: true                  },
      { k: 'showSavings', t: 'toggle', l: 'Show savings %',  d: true                  },
    ],
    layouts: [
      { id: 'cards',    label: 'Cards',    preview: '┌────┐ ┌────┐'         },
      { id: 'list',     label: 'List',     preview: '── 5-pack · $xxx ──'   },
      { id: 'featured', label: 'Featured', preview: '[ best deal ] [ sm ]'  },
    ],
  },
  giftcards: {
    label: 'Gift Cards', icon: Gift, color: '#993556',
    fields: [
      { k: 'heading',    t: 'text',   l: 'Section heading',         d: 'Give the Gift of Beauty'             },
      { k: 'subheading', t: 'text',   l: 'Subheading',              d: 'For birthdays, holidays, or just because' },
      { k: 'bgImage',    t: 'image',  l: 'Background / card image', d: ''                                    },
      { k: 'ctaText',    t: 'text',   l: 'Button text',             d: 'Send a Gift Card'                    },
      { k: 'ctaAction',  t: 'select', l: 'Button action',           d: 'booking', opts: ['booking', 'url']   },
      { k: 'amounts',    t: 'text',   l: 'Preset amounts (comma-sep)', d: '25,50,75,100'                     },
    ],
    layouts: [
      { id: 'hero',    label: 'Hero style',   preview: '[ bg image | text + cta ]'  },
      { id: 'card',    label: 'Card preview', preview: '┌─gift card design─┐'       },
      { id: 'minimal', label: 'Minimal',      preview: '[ amounts ] [buy]'          },
    ],
  },
  quote: {
    label: 'Quote Request', icon: FileText, color: '#3B6D11',
    fields: [
      { k: 'heading',    t: 'text',     l: 'Heading',           d: 'Need Something Bigger?'                 },
      { k: 'subheading', t: 'textarea', l: 'Description',       d: 'Planning a wedding, bridal party, or corporate event? We craft bespoke experiences.' },
      { k: 'ctaText',    t: 'text',     l: 'Button text',       d: 'Request a Quote'                        },
      { k: 'ctaAction',  t: 'select',   l: 'Button action',     d: 'booking', opts: ['booking', 'url']      },
      { k: 'bgImage',    t: 'image',    l: 'Background image',  d: ''                                       },
      { k: 'tags',       t: 'tag-list', l: 'Event types',       d: ['Bridal Parties', 'Corporate Events', 'Destination Services'] },
    ],
    layouts: [
      { id: 'split',    label: 'Split',       preview: '[ text | form ]'     },
      { id: 'centered', label: 'Centered',    preview: '  heading\n  tags\n  [cta]' },
      { id: 'banner',   label: 'Dark banner', preview: '▓▓▓[ text · cta ]▓▓▓' },
    ],
  },
  newclient: {
    label: 'New Client Offer', icon: Sparkles, color: '#854F0B',
    fields: [
      { k: 'heading',   t: 'text',   l: 'Heading',          d: 'First Visit Special'            },
      { k: 'offerText', t: 'text',   l: 'Offer description', d: '20% off your first appointment' },
      { k: 'finePrint', t: 'text',   l: 'Fine print',        d: 'Valid for new clients only.'    },
      { k: 'ctaText',   t: 'text',   l: 'Button text',       d: 'Claim Offer'                   },
      { k: 'ctaAction', t: 'select', l: 'Button action',     d: 'booking', opts: ['booking', 'url'] },
      { k: 'bgImage',   t: 'image',  l: 'Background image',  d: ''                              },
      { k: 'expiryText', t: 'text',  l: 'Expiry text',       d: 'Limited time only'             },
      { k: 'showTimer', t: 'toggle', l: 'Show countdown',    d: false                           },
    ],
    layouts: [
      { id: 'banner',    label: 'Banner',     preview: '[ offer · highlight · cta ]'       },
      { id: 'card',      label: 'Offer card', preview: '┌──────────────┐\n│  offer card  │' },
      { id: 'fullbleed', label: 'Full bleed', preview: '[ bg img · overlay · text ]'       },
      { id: 'popup',     label: 'Callout',    preview: '⚡ banner across top'              },
    ],
  },
  faq: {
    label: 'FAQ', icon: HelpCircle, color: '#185FA5',
    fields: [
      { k: 'heading', t: 'text',     l: 'Section heading', d: 'Common Questions' },
      { k: 'q1',      t: 'text',     l: 'Question 1',      d: 'How do I book an appointment?' },
      { k: 'a1',      t: 'textarea', l: 'Answer 1',        d: 'Use the Book Now button above or select any service to get started.' },
      { k: 'q2',      t: 'text',     l: 'Question 2',      d: 'What is your cancellation policy?' },
      { k: 'a2',      t: 'textarea', l: 'Answer 2',        d: 'We require 24 hours notice to avoid a cancellation fee.' },
      { k: 'q3',      t: 'text',     l: 'Question 3',      d: 'Do you accept walk-ins?' },
      { k: 'a3',      t: 'textarea', l: 'Answer 3',        d: 'Yes! Walk-ins welcome based on availability.' },
      { k: 'q4',      t: 'text',     l: 'Question 4',      d: 'Do you offer gift cards?' },
      { k: 'a4',      t: 'textarea', l: 'Answer 4',        d: 'Absolutely — gift cards available in any amount.' },
      { k: 'q5',      t: 'text',     l: 'Question 5 (optional)', d: '' },
      { k: 'a5',      t: 'textarea', l: 'Answer 5',        d: '' },
      { k: 'q6',      t: 'text',     l: 'Question 6 (optional)', d: '' },
      { k: 'a6',      t: 'textarea', l: 'Answer 6',        d: '' },
    ],
    layouts: [
      { id: 'accordion', label: 'Accordion',    preview: '▶ Question 1\n▶ Question 2'  },
      { id: 'two-col',   label: 'Two columns',  preview: '┌──┬──┐\n│Q │Q │'           },
      { id: 'cards',     label: 'Cards',        preview: '┌────┐ ┌────┐'               },
      { id: 'minimal',   label: 'Minimal list', preview: 'Q · A\nQ · A'                },
    ],
  },
  policies: {
    label: 'Policies', icon: Shield, color: '#0F6E56',
    fields: [
      { k: 'heading',    t: 'text',        l: 'Section heading', d: 'Our Policies' },
      { k: 'subheading', t: 'text',        l: 'Subheading',      d: ''             },
      { k: 'policies',   t: 'policy-list', l: 'Policy items',    d: [
          { id: 'p1', icon: 'clock',  title: 'Cancellation', body: 'Please provide 24 hours notice for all cancellations.' },
          { id: 'p2', icon: 'clock3', title: 'Late Arrival',  body: 'Arrivals 15+ minutes late may need to reschedule.' },
          { id: 'p3', icon: 'ban',    title: 'No-Shows',      body: 'No-shows may be required to prepay future bookings.' },
        ],
      },
    ],
    layouts: [
      { id: 'cards',   label: 'Icon cards',    preview: '┌──┐ ┌──┐ ┌──┐\n│🛡│ │🕐│ │⛔│' },
      { id: 'list',    label: 'Icon list',     preview: '🛡 Cancellation\n🕐 Late arrival'  },
      { id: 'table',   label: 'Compact table', preview: '│policy │ details │'               },
      { id: 'minimal', label: 'Minimal',       preview: 'Policy · details'                  },
    ],
  },
  contact: {
    label: 'Location & Contact', icon: MapPin, color: '#993556',
    fields: [
      { k: 'heading',     t: 'text',         l: 'Section heading', d: 'Find Us'                               },
      { k: 'customHours', t: 'textarea',     l: 'Hours text',      d: 'Monday – Saturday: 9am – 7pm\nSunday: 10am – 5pm' },
      { k: 'showMap',     t: 'toggle',       l: 'Show map embed',  d: true  },
      { k: 'showHours',   t: 'toggle',       l: 'Show hours',      d: true  },
      { k: 'showPhone',   t: 'toggle',       l: 'Show phone',      d: true  },
      { k: 'showEmail',   t: 'toggle',       l: 'Show email',      d: true  },
      { k: 'showSocial',  t: 'toggle',       l: 'Show social links', d: true },
      { k: 'ctaText',     t: 'text',         l: 'Book CTA text',   d: 'Book an Appointment' },
      { k: 'ctaAction',   t: 'select',       l: 'CTA action',      d: 'booking', opts: ['booking', 'url'] },
      { k: 'socialLinks', t: 'social-links', l: 'Social links',    d: []    },
    ],
    layouts: [
      { id: 'split-map', label: 'Map + info', preview: '[ map | hours · address ]' },
      { id: 'stacked',   label: 'Stacked',    preview: '[ map ]\n[ details ]'      },
      { id: 'cards',     label: 'Info cards', preview: '┌──┐┌──┐┌──┐'             },
      { id: 'minimal',   label: 'Minimal',    preview: '  address · hours  '       },
    ],
  },
  events: {
    label: 'Events Calendar', icon: Calendar, color: '#854F0B',
    fields: [
      { k: 'heading',    t: 'text',   l: 'Section heading', d: 'Upcoming Events'                    },
      { k: 'subheading', t: 'text',   l: 'Subheading',      d: 'Workshops, pop-ups & studio specials' },
      { k: 'emptyText',  t: 'text',   l: 'When no events',  d: 'Check back soon for upcoming events!' },
      { k: 'ctaText',    t: 'text',   l: 'RSVP button',     d: 'RSVP Now'                           },
      { k: 'ctaAction',  t: 'select', l: 'RSVP action',     d: 'booking', opts: ['booking', 'url']  },
    ],
    layouts: [
      { id: 'cards',    label: 'Event cards', preview: '┌────┐ ┌────┐'          },
      { id: 'list',     label: 'List',        preview: '── date · event ──'     },
      { id: 'calendar', label: 'Calendar',    preview: '┌su│mo│tu│we┐\n│  │  │  │  │' },
    ],
  },
  referral: {
    label: 'Referral Program', icon: Share2, color: '#185FA5',
    fields: [
      { k: 'heading',      t: 'text',   l: 'Section heading', d: 'Refer a Friend'                           },
      { k: 'subheading',   t: 'text',   l: 'Description',     d: 'Share the love — give $15, get $15 toward your next visit' },
      { k: 'rewardYou',    t: 'text',   l: 'Your reward',     d: '$15 credit'             },
      { k: 'rewardFriend', t: 'text',   l: 'Friend reward',   d: '$15 off first visit'    },
      { k: 'ctaText',      t: 'text',   l: 'Button text',     d: 'Get My Referral Link'   },
      { k: 'ctaAction',    t: 'select', l: 'Button action',   d: 'booking', opts: ['booking', 'url'] },
    ],
    layouts: [
      { id: 'split',    label: 'Split reward', preview: '[ you get | friend gets ]'   },
      { id: 'centered', label: 'Centered',     preview: '  offer · [get link]  '     },
      { id: 'banner',   label: 'Banner',       preview: '▓[ refer a friend · cta ]▓' },
    ],
  },
  story: {
    label: 'Studio Story', icon: BookOpen, color: '#3B6D11',
    fields: [
      { k: 'image',      t: 'image',    l: 'Section image',         d: ''                                  },
      { k: 'heading',    t: 'text',     l: 'Section heading',       d: 'Our Story'                         },
      { k: 'body',       t: 'textarea', l: 'Story text',            d: 'Opal was born from a belief that nail care is more than maintenance — it is a ritual of self-expression.' },
      { k: 'ctaText',    t: 'text',     l: 'Button text',           d: 'Meet the team'                     },
      { k: 'ctaAction',  t: 'select',   l: 'Button action',         d: 'scroll-team', opts: ['booking', 'scroll-team', 'url'] },
      { k: 'pullQuote',  t: 'text',     l: 'Pull quote (optional)', d: ''                                  },
    ],
    layouts: [
      { id: 'split',     label: 'Text + image', preview: '[ text | image ]'                 },
      { id: 'centered',  label: 'Centered',     preview: '  heading\n  body\n  [cta]'       },
      { id: 'editorial', label: 'Editorial',    preview: '[ large img ]\n[ quote ] [ text ]' },
      { id: 'timeline',  label: 'Timeline',     preview: '2019 ── 2021 ── 2024'             },
    ],
  },
  instagram: {
    label: 'Instagram Feed', icon: Camera, color: '#993556',
    fields: [
      { k: 'heading',  t: 'text',        l: 'Section heading',             d: 'Follow Along'           },
      { k: 'handle',   t: 'text',        l: 'Instagram handle',            d: '@opalmanicure'          },
      { k: 'ctaText',  t: 'text',        l: 'Button text',                 d: 'Follow us on Instagram' },
      { k: 'images',   t: 'image-array', l: 'Preview images (if no API)',  d: []                       },
      { k: 'columns',  t: 'select',      l: 'Columns',                     d: '4', opts: ['3', '4', '6'] },
    ],
    layouts: [
      { id: 'grid',    label: 'Square grid', preview: '┌──┬──┬──┬──┐'    },
      { id: 'masonry', label: 'Masonry',     preview: '┌──┐ ┌────┐'      },
      { id: 'banner',  label: 'Wide banner', preview: '← scroll row →'   },
    ],
  },
  waitlist: {
    label: 'Waitlist', icon: Clock, color: '#534AB7',
    fields: [
      { k: 'heading',    t: 'text',   l: 'Heading',     d: 'Fully Booked?'                                          },
      { k: 'subheading', t: 'text',   l: 'Subheading',  d: "Join our waitlist and we'll notify you when a slot opens" },
      { k: 'ctaText',    t: 'text',   l: 'Button text', d: 'Join Waitlist'                                          },
      { k: 'ctaAction',  t: 'select', l: 'Action',      d: 'booking', opts: ['booking', 'url']                      },
      { k: 'bgImage',    t: 'image',  l: 'Background image', d: ''                                                  },
    ],
    layouts: [
      { id: 'banner',   label: 'Banner',   preview: '[ heading · form · cta ]'      },
      { id: 'centered', label: 'Centered', preview: '  heading\n  [join]'            },
      { id: 'card',     label: 'Card',     preview: '┌────────────┐\n│ join list  │' },
    ],
  },
};

const DEFAULT_ON: SectionType[] = ['nav', 'hero', 'services', 'team', 'quote'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildDefaultSections(): PageSection[] {
  return (Object.keys(SECTION_DEFS) as SectionType[]).map((key, i) => {
    const cfg: Record<string, any> = {};
    SECTION_DEFS[key].fields.forEach(f => { cfg[f.k] = f.d; });
    cfg.layout = SECTION_DEFS[key].layouts?.[0]?.id ?? 'default';
    const defIdx = DEFAULT_ON.indexOf(key);
    return {
      id:      key,
      type:    key,
      enabled: defIdx >= 0,
      order:   defIdx >= 0 ? defIdx : DEFAULT_ON.length + i,
      config:  cfg,
    };
  }).sort((a, b) => a.order - b.order);
}

function generateId() { return Math.random().toString(36).slice(2, 8); }

/** Build CSS variable string from style config for consumption by booking dialogs / pages */
export function buildThemeCssVars(style: {
  accentColor: string;
  bgColor: string;
  headingFont: string;
  bodyFont: string;
  borderRadius: number;
  buttonStyle: string;
}) {
  const headingStack = FONTS.find(f => f.id === style.headingFont)?.stack ?? style.headingFont;
  const bodyStack    = FONTS.find(f => f.id === style.bodyFont)?.stack    ?? style.bodyFont;
  return {
    '--theme-accent':         style.accentColor,
    '--theme-bg':             style.bgColor,
    '--theme-heading-font':   headingStack,
    '--theme-body-font':      bodyStack,
    '--theme-radius':         `${style.borderRadius}px`,
    '--theme-button-style':   style.buttonStyle,
  } as React.CSSProperties;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const LayoutPicker = ({ layouts, value, onChange }: {
  layouts: SectionLayoutOption[];
  value: string;
  onChange: (v: string) => void;
}) => (
  <div className="space-y-2">
    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Section layout</p>
    <div className="grid grid-cols-2 gap-2">
      {layouts.map(l => (
        <button
          key={l.id}
          onClick={() => onChange(l.id)}
          className={cn(
            'p-3 rounded-xl border-2 text-left transition-all',
            value === l.id ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20',
          )}
        >
          <pre className="text-[8px] text-muted-foreground/60 font-mono leading-tight overflow-hidden whitespace-pre-wrap">{l.preview}</pre>
          <p className={cn('text-[9px] font-black uppercase tracking-widest mt-1.5', value === l.id ? 'text-primary' : 'text-slate-500')}>
            {l.label}
          </p>
        </button>
      ))}
    </div>
  </div>
);

const SocialLinksEditor = ({ value, onChange }: { value: SocialLink[]; onChange: (v: SocialLink[]) => void }) => {
  const links: SocialLink[] = Array.isArray(value) ? value : [];

  const addPlatform = (platformId: string) => {
    if (links.some(l => l.platform === platformId)) return;
    onChange([...links, { platform: platformId, url: '' }]);
  };

  const updateUrl = (platformId: string, url: string) =>
    onChange(links.map(l => l.platform === platformId ? { ...l, url } : l));

  const remove = (platformId: string) =>
    onChange(links.filter(l => l.platform !== platformId));

  const activePlatforms = links.map(l => l.platform);
  const available = SOCIAL_PLATFORMS.filter(p => !activePlatforms.includes(p.id));

  return (
    <div className="space-y-3">
      {links.map(link => {
        const platform = SOCIAL_PLATFORMS.find(p => p.id === link.platform);
        if (!platform) return null;
        const PIcon = platform.icon;
        return (
          <div key={link.platform} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: platform.color + '18' }}>
              <PIcon className="w-3.5 h-3.5" style={{ color: platform.color }} />
            </div>
            <Input
              value={link.url}
              onChange={e => updateUrl(link.platform, e.target.value)}
              placeholder={platform.placeholder}
              className="flex-1 h-8 rounded-lg border-2 text-xs"
            />
            <button onClick={() => remove(link.platform)} className="p-1 text-muted-foreground hover:text-red-500 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {available.map(p => {
            const PIcon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => addPlatform(p.id)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-dashed border-border text-[10px] font-bold text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
              >
                <Plus className="w-2.5 h-2.5" />{p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PolicyListEditor = ({ value, onChange }: { value: PolicyItem[]; onChange: (v: PolicyItem[]) => void }) => {
  const policies: PolicyItem[] = Array.isArray(value) ? value : [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const add = () => {
    const newPolicy: PolicyItem = { id: generateId(), icon: 'shield', title: 'New Policy', body: '' };
    onChange([...policies, newPolicy]);
    setExpandedId(newPolicy.id);
  };

  const update = (id: string, field: keyof PolicyItem, val: string) =>
    onChange(policies.map(p => p.id === id ? { ...p, [field]: val } : p));

  const remove = (id: string) => onChange(policies.filter(p => p.id !== id));

  return (
    <div className="space-y-2">
      {policies.map(policy => {
        const iconDef = POLICY_ICONS.find(i => i.id === policy.icon) ?? POLICY_ICONS[0];
        const PolicyIcon = iconDef.icon;
        const isExpanded = expandedId === policy.id;
        return (
          <div key={policy.id} className="rounded-xl border-2 border-border overflow-hidden">
            <div
              className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : policy.id)}
            >
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <PolicyIcon className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">{policy.title || 'Untitled policy'}</span>
              <button onClick={e => { e.stopPropagation(); remove(policy.id); }} className="p-0.5 text-muted-foreground hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
            </div>
            {isExpanded && (
              <div className="p-3 pt-0 space-y-3 border-t border-border/50">
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Icon</p>
                  <div className="flex flex-wrap gap-1.5">
                    {POLICY_ICONS.map(icon => {
                      const IIcon = icon.icon;
                      return (
                        <button
                          key={icon.id}
                          onClick={() => update(policy.id, 'icon', icon.id)}
                          title={icon.label}
                          className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center border-2 transition-all',
                            policy.icon === icon.id ? 'border-primary/40 bg-primary/10' : 'border-border hover:border-primary/20',
                          )}
                        >
                          <IIcon className="w-3.5 h-3.5 text-slate-600" />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Title</Label>
                  <Input value={policy.title} onChange={e => update(policy.id, 'title', e.target.value)} className="h-8 rounded-lg border-2 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Description</Label>
                  <Textarea value={policy.body} onChange={e => update(policy.id, 'body', e.target.value)} className="rounded-xl border-2 text-xs min-h-[60px] resize-none" />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={add}
        className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
      >
        <Plus className="w-3.5 h-3.5" /> Add policy
      </button>
    </div>
  );
};

/** Before/After pair editor — separate labeled slots for each image */
const BeforeAfterPairsEditor = ({ value, onChange }: {
  value: BeforeAfterPair[];
  onChange: (v: BeforeAfterPair[]) => void;
}) => {
  const pairs: BeforeAfterPair[] = Array.isArray(value) ? value : [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const add = () => {
    const newPair: BeforeAfterPair = { id: generateId(), beforeUrl: '', afterUrl: '', caption: '' };
    onChange([...pairs, newPair]);
    setExpandedId(newPair.id);
  };

  const update = (id: string, field: keyof BeforeAfterPair, val: string) =>
    onChange(pairs.map(p => p.id === id ? { ...p, [field]: val } : p));

  const remove = (id: string) => onChange(pairs.filter(p => p.id !== id));

  return (
    <div className="space-y-3">
      {pairs.map((pair, idx) => {
        const isExpanded = expandedId === pair.id;
        const hasImages  = pair.beforeUrl || pair.afterUrl;
        return (
          <div key={pair.id} className="rounded-xl border-2 border-border overflow-hidden">
            {/* Header row */}
            <div
              className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : pair.id)}
            >
              {/* Mini thumbnails */}
              <div className="flex gap-1 shrink-0">
                <div className="w-7 h-7 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">
                  {pair.beforeUrl
                    ? <img src={pair.beforeUrl} alt="before" className="w-full h-full object-cover" />
                    : <span className="text-[7px] font-black text-muted-foreground/40">B</span>
                  }
                </div>
                <ArrowLeftRight className="w-3 h-3 text-muted-foreground/40 self-center" />
                <div className="w-7 h-7 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">
                  {pair.afterUrl
                    ? <img src={pair.afterUrl} alt="after" className="w-full h-full object-cover" />
                    : <span className="text-[7px] font-black text-muted-foreground/40">A</span>
                  }
                </div>
              </div>
              <span className="flex-1 text-xs font-bold text-slate-700 truncate">
                {pair.caption || `Pair ${idx + 1}`}
              </span>
              <button onClick={e => { e.stopPropagation(); remove(pair.id); }} className="p-0.5 text-muted-foreground hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
            </div>

            {isExpanded && (
              <div className="p-3 pt-2 space-y-4 border-t border-border/50">
                {/* Before */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-slate-400" />
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                      Before image
                    </Label>
                  </div>
                  {pair.beforeUrl && (
                    <div className="relative rounded-xl overflow-hidden border-2 border-border aspect-video mb-2">
                      <img src={pair.beforeUrl} alt="before" className="w-full h-full object-cover" />
                      <button
                        onClick={() => update(pair.id, 'beforeUrl', '')}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[8px] font-black uppercase tracking-widest">Before</div>
                    </div>
                  )}
                  {!pair.beforeUrl && (
                    <ImageUpload initialImage="" onImageUploaded={url => update(pair.id, 'beforeUrl', url)} />
                  )}
                </div>

                {/* After */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                      After image
                    </Label>
                  </div>
                  {pair.afterUrl && (
                    <div className="relative rounded-xl overflow-hidden border-2 border-border aspect-video mb-2">
                      <img src={pair.afterUrl} alt="after" className="w-full h-full object-cover" />
                      <button
                        onClick={() => update(pair.id, 'afterUrl', '')}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-primary/80 text-white text-[8px] font-black uppercase tracking-widest">After</div>
                    </div>
                  )}
                  {!pair.afterUrl && (
                    <ImageUpload initialImage="" onImageUploaded={url => update(pair.id, 'afterUrl', url)} />
                  )}
                </div>

                {/* Caption */}
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Caption (optional)</Label>
                  <Input
                    value={pair.caption || ''}
                    onChange={e => update(pair.id, 'caption', e.target.value)}
                    placeholder="e.g. Gel removal & fresh set"
                    className="h-8 rounded-lg border-2 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={add}
        className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
      >
        <Plus className="w-3.5 h-3.5" /> Add before/after pair
      </button>
    </div>
  );
};

const ImageArrayEditor = ({ value, onChange, maxImages = 50 }: {
  value: GalleryImage[];
  onChange: (v: GalleryImage[]) => void;
  maxImages?: number;
}) => {
  const images: GalleryImage[] = Array.isArray(value) ? value : [];

  const remove = (id: string) => onChange(images.filter(img => img.id !== id));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {images.map(img => (
          <div key={img.id} className="relative group rounded-xl overflow-hidden border-2 border-border aspect-square">
            {img.url
              ? <img src={img.url} alt={img.caption || ''} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-muted flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground/40" /></div>
            }
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button onClick={() => remove(img.id)} className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {images.length < maxImages && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2">Upload new image</p>
          <ImageUpload
            initialImage=""
            onImageUploaded={url => onChange([...images, { id: generateId(), url, caption: '', category: '' }])}
          />
        </div>
      )}
      {images.length > 0 && (
        <p className="text-[9px] text-muted-foreground/50 text-center">{images.length} image{images.length !== 1 ? 's' : ''} uploaded</p>
      )}
    </div>
  );
};

const TagListEditor = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => {
  const tags: string[] = Array.isArray(value) ? value : [];
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) { onChange([...tags, v]); setInput(''); }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map(tag => (
          <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-bold">
            {tag}
            <button onClick={() => onChange(tags.filter(t => t !== tag))}><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add tag…"
          className="h-8 rounded-lg border-2 text-xs flex-1"
        />
        <Button size="sm" onClick={add} variant="outline" className="h-8 px-3 rounded-lg text-xs">Add</Button>
      </div>
    </div>
  );
};

const FieldRenderer = ({ field, value, onChange, sectionId }: {
  field: SectionField; value: any; onChange: (v: any) => void; sectionId: string;
}) => {
  const labelCls = 'text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70';

  if (field.t === 'image') return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{field.l}</Label>
      <ImageUpload initialImage={value || ''} onImageUploaded={onChange} />
    </div>
  );

  if (field.t === 'image-array') return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{field.l}</Label>
      <ImageArrayEditor value={value || []} onChange={onChange} />
    </div>
  );

  if (field.t === 'beforeafter-pairs') return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{field.l}</Label>
      <BeforeAfterPairsEditor value={value || []} onChange={onChange} />
    </div>