'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  RefreshCw, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type SectionType, type PageSection, type PageBuilderConfig } from '@/lib/data';

// ─── Field type ───────────────────────────────────────────────────────────────
type FieldType = 'text' | 'textarea' | 'toggle' | 'select' | 'image';
interface SectionField { k: string; t: FieldType; l: string; d: any; opts?: string[]; }
interface SectionDef { label: string; icon: React.ElementType; color: string; fields: SectionField[]; }

// ─── Section definitions ──────────────────────────────────────────────────────
const SECTION_DEFS: Record<SectionType, SectionDef> = {
  nav: {
    label: 'Navigation', icon: Navigation, color: '#3B6D11',
    fields: [
      { k: 'logoUrl',   t: 'image',  l: 'Logo image (optional)',  d: ''         },
      { k: 'logoText',  t: 'text',   l: 'Logo / studio name',     d: 'Opal'     },
      { k: 'ctaText',   t: 'text',   l: 'Button label',           d: 'Book Now' },
      { k: 'showLinks', t: 'toggle', l: 'Show nav links',         d: true       },
    ],
  },
  hero: {
    label: 'Hero', icon: ImageIcon, color: '#534AB7',
    fields: [
      { k: 'bgImage',     t: 'image',    l: 'Background image',     d: ''                                                                    },
      { k: 'heroImage',   t: 'image',    l: 'Feature image (split)', d: ''                                                                   },
      { k: 'headline',    t: 'text',     l: 'Headline',             d: 'Book Your Experience'                                                },
      { k: 'subheadline', t: 'textarea', l: 'Subheadline',          d: 'A sanctuary of craft, curated for those who appreciate the details.' },
      { k: 'ctaText',     t: 'text',     l: 'Primary button',       d: 'Book a Session'                                                      },
      { k: 'cta2Text',    t: 'text',     l: 'Secondary button',     d: 'Walk In'                                                             },
      { k: 'layout',      t: 'select',   l: 'Layout',               d: 'centered', opts: ['centered', 'split', 'fullbleed', 'minimal']       },
    ],
  },
  trust: {
    label: 'Trust Strip', icon: Award, color: '#854F0B',
    fields: [
      { k: 'stat1l', t: 'text', l: 'Stat 1 label', d: 'Happy clients' },
      { k: 'stat1v', t: 'text', l: 'Stat 1 value', d: '500+'          },
      { k: 'stat2l', t: 'text', l: 'Stat 2 label', d: 'Avg rating'    },
      { k: 'stat2v', t: 'text', l: 'Stat 2 value', d: '4.9 ★'        },
      { k: 'stat3l', t: 'text', l: 'Stat 3 label', d: 'Years open'    },
      { k: 'stat3v', t: 'text', l: 'Stat 3 value', d: '6'             },
      { k: 'stat4l', t: 'text', l: 'Stat 4 label', d: 'Services'      },
      { k: 'stat4v', t: 'text', l: 'Stat 4 value', d: '20+'           },
    ],
  },
  services: {
    label: 'Services', icon: Scissors, color: '#185FA5',
    fields: [
      { k: 'heading',      t: 'text',   l: 'Section heading',      d: 'Our Services'                                           },
      { k: 'subheading',   t: 'text',   l: 'Subheading',           d: 'Handcrafted treatments for every occasion'              },
      { k: 'layout',       t: 'select', l: 'Layout',               d: 'cards', opts: ['cards', 'list', 'magazine', 'grid']     },
      { k: 'columns',      t: 'select', l: 'Columns',              d: '2',     opts: ['1', '2', '3']                           },
      { k: 'showPrices',   t: 'toggle', l: 'Show prices',          d: true                                                     },
      { k: 'showDuration', t: 'toggle', l: 'Show duration',        d: true                                                     },
      { k: 'showFilters',  t: 'toggle', l: 'Category filter tabs', d: false                                                    },
      { k: 'showDesc',     t: 'toggle', l: 'Show descriptions',    d: true                                                     },
    ],
  },
  team: {
    label: 'Team', icon: Users, color: '#0F6E56',
    fields: [
      { k: 'heading',         t: 'text',   l: 'Section heading',       d: 'The Artists'                                            },
      { k: 'subheading',      t: 'text',   l: 'Subheading',            d: 'Expert hands for every style'                           },
      { k: 'layout',          t: 'select', l: 'Avatar style',          d: 'circles', opts: ['circles', 'editorial', 'row', 'grid'] },
      { k: 'showBio',         t: 'toggle', l: 'Show bio',              d: false                                                     },
      { k: 'showSpecialties', t: 'toggle', l: 'Show specialties',      d: true                                                      },
      { k: 'showBookButton',  t: 'toggle', l: 'Book per artist button', d: false                                                    },
    ],
  },
  reviews: {
    label: 'Reviews', icon: Star, color: '#993556',
    fields: [
      { k: 'heading',    t: 'text',   l: 'Section heading',   d: 'What Clients Say'            },
      { k: 'subheading', t: 'text',   l: 'Subheading',        d: 'Real words from real guests'  },
      { k: 'layout',     t: 'select', l: 'Layout',            d: 'grid', opts: ['grid', 'masonry', 'carousel', 'quotes'] },
      { k: 'showRating', t: 'toggle', l: 'Show star ratings', d: true                           },
      { k: 'showPhotos', t: 'toggle', l: 'Show client photos', d: true                          },
    ],
  },
  gallery: {
    label: 'Portfolio Gallery', icon: LayoutDashboard, color: '#534AB7',
    fields: [
      { k: 'heading',      t: 'text',   l: 'Section heading',   d: 'Our Work'                                                    },
      { k: 'subheading',   t: 'text',   l: 'Subheading',        d: 'Every set, a canvas'                                         },
      { k: 'layout',       t: 'select', l: 'Layout',            d: 'masonry', opts: ['masonry', 'grid', 'carousel', 'editorial'] },
      { k: 'showFilters',  t: 'toggle', l: 'Style filter tabs', d: true                                                           },
      { k: 'showCaptions', t: 'toggle', l: 'Show captions',     d: false                                                          },
    ],
  },
  beforeafter: {
    label: 'Before / After', icon: RotateCcw, color: '#0F6E56',
    fields: [
      { k: 'heading',    t: 'text', l: 'Section heading', d: 'Transformations'            },
      { k: 'subheading', t: 'text', l: 'Subheading',      d: 'See the difference we make' },
    ],
  },
  memberships: {
    label: 'Memberships', icon: Crown, color: '#534AB7',
    fields: [
      { k: 'heading',     t: 'text',   l: 'Section heading',   d: 'Join the Club'                   },
      { k: 'subheading',  t: 'text',   l: 'Subheading',        d: 'Exclusive perks for loyal guests' },
      { k: 'showSavings', t: 'toggle', l: 'Highlight savings', d: true                               },
    ],
  },
  packages: {
    label: 'Packages', icon: Package, color: '#185FA5',
    fields: [
      { k: 'heading',    t: 'text',   l: 'Section heading', d: 'Prepaid Sessions'    },
      { k: 'subheading', t: 'text',   l: 'Subheading',      d: 'Buy more, save more' },
      { k: 'showExpiry', t: 'toggle', l: 'Show expiry info', d: true                 },
    ],
  },
  giftcards: {
    label: 'Gift Cards', icon: Gift, color: '#993556',
    fields: [
      { k: 'heading',    t: 'text', l: 'Section heading',            d: 'Give the Gift of Beauty'             },
      { k: 'subheading', t: 'text', l: 'Subheading',                 d: 'For birthdays, holidays, or just because' },
      { k: 'ctaText',    t: 'text', l: 'Button text',                d: 'Send a Gift Card'                    },
      { k: 'amounts',    t: 'text', l: 'Preset amounts (comma-sep)', d: '25,50,75,100'                        },
    ],
  },
  quote: {
    label: 'Quote Request', icon: FileText, color: '#3B6D11',
    fields: [
      { k: 'heading',    t: 'text',     l: 'Heading',                d: 'Need Something Bigger?'                                         },
      { k: 'subheading', t: 'textarea', l: 'Description',            d: 'Planning a wedding, bridal party, or corporate event? We craft bespoke experiences.' },
      { k: 'ctaText',    t: 'text',     l: 'Button text',            d: 'Request a Quote'                                                },
      { k: 'tags',       t: 'text',     l: 'Tags (comma-separated)', d: 'Bridal Parties,Corporate Events,Destination Services'           },
    ],
  },
  newclient: {
    label: 'New Client Offer', icon: Sparkles, color: '#854F0B',
    fields: [
      { k: 'heading',   t: 'text', l: 'Heading',           d: 'First Visit Special'             },
      { k: 'offerText', t: 'text', l: 'Offer description', d: '20% off your first appointment'  },
      { k: 'finePrint', t: 'text', l: 'Fine print',        d: 'Valid for new clients only.'      },
      { k: 'ctaText',   t: 'text', l: 'Button text',       d: 'Claim Offer'                     },
    ],
  },
  faq: {
    label: 'FAQ', icon: HelpCircle, color: '#185FA5',
    fields: [
      { k: 'heading', t: 'text',     l: 'Section heading', d: 'Common Questions'                                               },
      { k: 'q1',      t: 'text',     l: 'Question 1',      d: 'How do I book an appointment?'                                 },
      { k: 'a1',      t: 'textarea', l: 'Answer 1',        d: 'Use the Book Now button above or select any service to get started.' },
      { k: 'q2',      t: 'text',     l: 'Question 2',      d: 'What is your cancellation policy?'                             },
      { k: 'a2',      t: 'textarea', l: 'Answer 2',        d: 'We require 24 hours notice to avoid a cancellation fee.'       },
      { k: 'q3',      t: 'text',     l: 'Question 3',      d: 'Do you accept walk-ins?'                                       },
      { k: 'a3',      t: 'textarea', l: 'Answer 3',        d: 'Yes! Walk-ins welcome based on availability.'                  },
      { k: 'q4',      t: 'text',     l: 'Question 4',      d: 'Do you offer gift cards?'                                      },
      { k: 'a4',      t: 'textarea', l: 'Answer 4',        d: 'Absolutely — gift cards available in any amount.'              },
    ],
  },
  policies: {
    label: 'Policies', icon: Shield, color: '#0F6E56',
    fields: [
      { k: 'heading',    t: 'text',     l: 'Section heading',     d: 'Our Policies'                                           },
      { k: 'cancelText', t: 'textarea', l: 'Cancellation policy', d: 'Please provide 24 hours notice for all cancellations.'  },
      { k: 'lateText',   t: 'textarea', l: 'Late arrival policy', d: 'Arrivals 15+ minutes late may need to reschedule.'      },
      { k: 'noshowText', t: 'textarea', l: 'No-show policy',      d: 'No-shows may be required to prepay future bookings.'    },
    ],
  },
  contact: {
    label: 'Location & Contact', icon: MapPin, color: '#993556',
    fields: [
      { k: 'heading',     t: 'text',     l: 'Section heading', d: 'Find Us'                                          },
      { k: 'customHours', t: 'textarea', l: 'Hours text',      d: 'Monday – Saturday: 9am – 7pm\nSunday: 10am – 5pm' },
      { k: 'showMap',     t: 'toggle',   l: 'Show map embed',  d: true                                                },
      { k: 'showHours',   t: 'toggle',   l: 'Show hours',      d: true                                                },
      { k: 'showPhone',   t: 'toggle',   l: 'Show phone',      d: true                                                },
      { k: 'showSocial',  t: 'toggle',   l: 'Show social links', d: true                                              },
    ],
  },
  events: {
    label: 'Events Calendar', icon: Calendar, color: '#854F0B',
    fields: [
      { k: 'heading',    t: 'text', l: 'Section heading', d: 'Upcoming Events'                      },
      { k: 'subheading', t: 'text', l: 'Subheading',      d: 'Workshops, pop-ups & studio specials'  },
      { k: 'emptyText',  t: 'text', l: 'When no events',  d: 'Check back soon for upcoming events!'  },
    ],
  },
  referral: {
    label: 'Referral Program', icon: Share2, color: '#185FA5',
    fields: [
      { k: 'heading',      t: 'text', l: 'Section heading', d: 'Refer a Friend'                                },
      { k: 'subheading',   t: 'text', l: 'Description',     d: 'Share the love — give $15, get $15 toward your next visit' },
      { k: 'rewardYou',    t: 'text', l: 'Your reward',     d: '$15 credit'                                    },
      { k: 'rewardFriend', t: 'text', l: 'Friend reward',   d: '$15 off first visit'                           },
      { k: 'ctaText',      t: 'text', l: 'Button text',     d: 'Get My Referral Link'                          },
    ],
  },
  story: {
    label: 'Studio Story', icon: BookOpen, color: '#3B6D11',
    fields: [
      { k: 'image',   t: 'image',    l: 'Section image (optional)', d: ''                                                                          },
      { k: 'heading', t: 'text',     l: 'Section heading',          d: 'Our Story'                                                                 },
      { k: 'body',    t: 'textarea', l: 'Story text',               d: 'Opal was born from a belief that nail care is more than maintenance — it is a ritual of self-expression.' },
      { k: 'ctaText', t: 'text',     l: 'Button text',              d: 'Meet the team'                                                             },
    ],
  },
  instagram: {
    label: 'Instagram Feed', icon: Camera, color: '#993556',
    fields: [
      { k: 'heading', t: 'text', l: 'Section heading',  d: 'Follow Along'            },
      { k: 'handle',  t: 'text', l: 'Instagram handle', d: '@opalmanicure'           },
      { k: 'ctaText', t: 'text', l: 'Button text',      d: 'Follow us on Instagram'  },
    ],
  },
  waitlist: {
    label: 'Waitlist', icon: Clock, color: '#534AB7',
    fields: [
      { k: 'heading',    t: 'text', l: 'Heading',    d: 'Fully Booked?'                                       },
      { k: 'subheading', t: 'text', l: 'Subheading', d: "Join our waitlist and we'll notify you when a slot opens" },
      { k: 'ctaText',    t: 'text', l: 'Button text', d: 'Join Waitlist'                                      },
    ],
  },
};

const DEFAULT_ON: SectionType[] = ['nav', 'hero', 'services', 'team', 'quote'];

const ACCENT_COLORS = [
  '#8b6914', '#c9a84c', '#7a9e7e', '#c4718a',
  '#7c3aed', '#185FA5', '#0F6E56', '#993556',
  '#111111', '#334155', '#854F0B', '#A32D2D',
];

const BG_COLORS = [
  { hex: '#f8f4ef', label: 'Champagne parchment' },
  { hex: '#f0ede4', label: 'Warm linen'           },
  { hex: '#ffffff', label: 'Pure white'            },
  { hex: '#fafafa', label: 'Off-white'             },
  { hex: '#0b0b0b', label: 'Near black'            },
  { hex: '#fff5f7', label: 'Soft blush'            },
  { hex: '#f0f8f4', label: 'Soft sage'             },
  { hex: '#f5f5f0', label: 'Warm gray'             },
];

const FONTS = [
  { id: 'cormorant',  label: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif",   desc: 'Luxury serif'    },
  { id: 'playfair',   label: 'Playfair Display',   stack: "'Playfair Display', Georgia, serif",     desc: 'Editorial serif' },
  { id: 'lora',       label: 'Lora',               stack: "'Lora', Georgia, serif",                 desc: 'Elegant serif'   },
  { id: 'space',      label: 'Space Grotesk',      stack: "'Space Grotesk', system-ui, sans-serif", desc: 'Modern sans'     },
  { id: 'josefin',    label: 'Josefin Sans',       stack: "'Josefin Sans', system-ui, sans-serif",  desc: 'Geometric sans'  },
  { id: 'raleway',    label: 'Raleway',            stack: "'Raleway', system-ui, sans-serif",        desc: 'Elegant sans'    },
  { id: 'bebas',      label: 'Bebas Neue',         stack: "'Bebas Neue', Impact, sans-serif",        desc: 'Bold display'    },
  { id: 'montserrat', label: 'Montserrat',         stack: "'Montserrat', system-ui, sans-serif",     desc: 'Clean sans'      },
  { id: 'oswald',     label: 'Oswald',             stack: "'Oswald', system-ui, sans-serif",         desc: 'Condensed sans'  },
  { id: 'georgia',    label: 'Georgia',            stack: 'Georgia, serif',                          desc: 'Classic serif'   },
  { id: 'system',     label: 'System UI',          stack: 'system-ui, sans-serif',                   desc: 'Default clean'   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildDefaultSections(): PageSection[] {
  return (Object.keys(SECTION_DEFS) as SectionType[]).map((key, i) => {
    const cfg: Record<string, any> = {};
    SECTION_DEFS[key].fields.forEach(f => { cfg[f.k] = f.d; });
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

// ─── Section list item ────────────────────────────────────────────────────────
const SectionListItem = ({
  section, isSelected, isFirst, isLast,
  onSelect, onMoveUp, onMoveDown, onHide,
}: {
  section: PageSection; isSelected: boolean; isFirst: boolean; isLast: boolean;
  onSelect: () => void; onMoveUp: () => void; onMoveDown: () => void; onHide: () => void;
}) => {
  const def  = SECTION_DEFS[section.type];
  const Icon = def.icon;
  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 p-3 rounded-2xl border-2 cursor-pointer transition-all',
        isSelected
          ? 'border-primary/30 bg-primary/5 shadow-md'
          : 'border-border bg-background hover:border-primary/20',
      )}
    >
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: def.color + '18' }}>
        <Icon className="w-4 h-4" style={{ color: def.color }} />
      </div>
      <span className={cn('flex-1 text-xs font-black uppercase tracking-tight truncate', isSelected ? 'text-primary' : 'text-slate-700')}>
        {def.label}
      </span>
      <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
        <button onClick={onMoveUp}   disabled={isFirst} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"><ChevronUp   className="w-3.5 h-3.5" /></button>
        <button onClick={onMoveDown} disabled={isLast}  className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"><ChevronDown className="w-3.5 h-3.5" /></button>
        <button onClick={onHide}                        className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"><X           className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};

// ─── Library item ─────────────────────────────────────────────────────────────
const LibraryItem = ({ section, onAdd }: { section: PageSection; onAdd: () => void }) => {
  const def  = SECTION_DEFS[section.type];
  const Icon = def.icon;
  return (
    <button
      onClick={onAdd}
      className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-border bg-background hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: def.color + '18' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
      </div>
      <span className="flex-1 text-xs font-black uppercase tracking-tight text-slate-700 truncate">{def.label}</span>
      <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </button>
  );
};

// ─── Field renderer ───────────────────────────────────────────────────────────
interface SectionFieldDef { k: string; t: FieldType; l: string; d: any; opts?: string[]; }

const FieldRenderer = ({ field, value, onChange }: {
  field: SectionFieldDef; value: any; onChange: (v: any) => void;
}) => {
  const labelCls = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground';

  if (field.t === 'image') return (
    <div className="space-y-2">
      <Label className={labelCls}>{field.l}</Label>
      <ImageUpload
        initialImage={value || ''}
        onImageUploaded={(url) => onChange(url)}
      />
    </div>
  );

  if (field.t === 'toggle') return (
    <div className="flex items-center justify-between py-2.5 border-b border-dashed last:border-0">
      <span className={labelCls}>{field.l}</span>
      <Switch checked={!!value} onCheckedChange={onChange} />
    </div>
  );

  if (field.t === 'textarea') return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{field.l}</Label>
      <Textarea value={value || ''} onChange={e => onChange(e.target.value)} className="rounded-xl border-2 text-sm min-h-[80px] resize-none" />
    </div>
  );

  if (field.t === 'select') return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{field.l}</Label>
      <Select value={value || field.d} onValueChange={onChange}>
        <SelectTrigger className="h-10 rounded-xl border-2 text-xs font-black uppercase"><SelectValue /></SelectTrigger>
        <SelectContent className="rounded-xl border-2">
          {field.opts!.map(o => (
            <SelectItem key={o} value={o} className="text-xs font-black uppercase">
              {o.charAt(0).toUpperCase() + o.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-1.5">
      <Label className={labelCls}>{field.l}</Label>
      <Input value={value || ''} onChange={e => onChange(e.target.value)} className="h-10 rounded-xl border-2 text-sm" />
    </div>
  );
};

// ─── Font picker row ──────────────────────────────────────────────────────────
const FontRow = ({ font, isSelected, onClick }: {
  font: typeof FONTS[0]; isSelected: boolean; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-3 p-2.5 rounded-xl border-2 text-left transition-all',
      isSelected ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:border-border',
    )}
  >
    <span className="text-base flex-1 truncate" style={{ fontFamily: font.stack }}>{font.label}</span>
    <span className="text-[9px] text-muted-foreground uppercase tracking-widest shrink-0">{font.desc}</span>
    {isSelected && <Check className="w-3 h-3 text-primary shrink-0" />}
  </button>
);

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PageBuilderPage() {
  const { firestore }      = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast }          = useToast();

  const previewRef = useRef<HTMLIFrameElement>(null);
  const isFirstLoad = useRef(true);

  const [sections,     setSections]     = useState<PageSection[]>(buildDefaultSections());
  const [selectedId,   setSelectedId]   = useState<string | null>('hero');
  const [showLibrary,  setShowLibrary]  = useState(false);
  const [activePanel,  setActivePanel]  = useState<'sections' | 'style'>('sections');
  const [isSaving,     setIsSaving]     = useState(false);
  const [isDirty,      setIsDirty]      = useState(false);
  const [previewMode,  setPreviewMode]  = useState<'desktop' | 'mobile'>('desktop');
  const [previewKey,   setPreviewKey]   = useState(0); // bump to force iframe reload

  const [style, setStyle] = useState({
    accentColor: '#8b6914',
    bgColor:     '#f8f4ef',
    headingFont: 'cormorant',
    bodyFont:    'space',
  });

  // Load existing config
  useEffect(() => {
    const existing = (selectedTenant?.bookingPageSettings as any)?.pageConfig as PageBuilderConfig | undefined;
    if (existing?.sections?.length) setSections(existing.sections);
    if (existing?.accentColor) setStyle(p => ({ ...p, accentColor: existing.accentColor }));
    if (existing?.bgColor)     setStyle(p => ({ ...p, bgColor:     existing.bgColor     }));
    if (existing?.headingFont) setStyle(p => ({ ...p, headingFont: existing.headingFont }));
    if (existing?.bodyFont)    setStyle(p => ({ ...p, bodyFont:    existing.bodyFont    }));
  }, [selectedTenant]);

  // Track dirty state — skip first render cycle
  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setIsDirty(true);
  }, [sections, style]);

  // Sync live preview via postMessage (debounced 400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      previewRef.current?.contentWindow?.postMessage(
        { type: 'CLARITY_PREVIEW', sections, style },
        window.location.origin,
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [sections, style]);

  const enabledSections  = useMemo(() => sections.filter(s => s.enabled).sort((a, b) => a.order - b.order), [sections]);
  const disabledSections = useMemo(() => sections.filter(s => !s.enabled), [sections]);
  const selectedSection  = useMemo(() => sections.find(s => s.id === selectedId), [sections, selectedId]);

  const moveUp = (id: string) => setSections(prev => {
    const en  = prev.filter(s => s.enabled).sort((a, b) => a.order - b.order);
    const idx = en.findIndex(s => s.id === id);
    if (idx <= 0) return prev;
    const [a, b] = [en[idx - 1], en[idx]];
    return prev.map(s => s.id === a.id ? { ...s, order: b.order } : s.id === b.id ? { ...s, order: a.order } : s);
  });

  const moveDown = (id: string) => setSections(prev => {
    const en  = prev.filter(s => s.enabled).sort((a, b) => a.order - b.order);
    const idx = en.findIndex(s => s.id === id);
    if (idx >= en.length - 1) return prev;
    const [a, b] = [en[idx], en[idx + 1]];
    return prev.map(s => s.id === a.id ? { ...s, order: b.order } : s.id === b.id ? { ...s, order: a.order } : s);
  });

  const hideSection = (id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: false } : s));
    if (selectedId === id) setSelectedId(null);
  };

  const addSection = (id: string) => {
    const maxOrder = enabledSections.reduce((m, s) => Math.max(m, s.order), 0);
    setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: true, order: maxOrder + 1 } : s));
    setSelectedId(id);
    setShowLibrary(false);
  };

  const updateField = (sectionId: string, key: string, value: any) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, config: { ...s.config, [key]: value } } : s,
    ));
  };

  const handleSave = async () => {
    if (!selectedTenant || !firestore) return;
    setIsSaving(true);
    try {
      const config: PageBuilderConfig = { sections, ...style };
      await updateDoc(doc(firestore, 'tenants', selectedTenant.id), {
        'bookingPageSettings.pageConfig': config,
      });
      setIsDirty(false);
      toast({ title: 'Page saved', description: 'Your booking page is updated and live.' });
    } catch {
      toast({ variant: 'destructive', title: 'Save failed' });
    } finally {
      setIsSaving(false);
    }
  };

  const headingFontDef = FONTS.find(f => f.id === style.headingFont);
  const bodyFontDef    = FONTS.find(f => f.id === style.bodyFont);
  const previewUrl     = selectedTenant ? `/book/${selectedTenant.id}` : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50/50">
      <AppHeader title="Page Builder" />

      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="flex items-center justify-between gap-4 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-widest">Unsaved changes</span>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="h-7 px-4 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md shadow-primary/20"
          >
            {isSaving ? <Loader className="animate-spin w-3 h-3" /> : <><Save className="w-3 h-3 mr-1.5" />Save now</>}
          </Button>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">

          {/* ── Left sidebar: section list + style ── */}
          <div className="w-72 h-full flex flex-col border-r bg-white shrink-0">

            {/* Tab bar */}
            <div className="p-4 border-b flex items-center gap-2">
              <div className="flex gap-1.5 flex-1">
                <button
                  onClick={() => { setShowLibrary(false); setActivePanel('sections'); }}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                    activePanel === 'sections' && !showLibrary ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >Sections</button>
                <button
                  onClick={() => { setShowLibrary(false); setActivePanel('style'); }}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                    activePanel === 'style' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >Style</button>
              </div>
              {activePanel === 'sections' && (
                <button
                  onClick={() => setShowLibrary(!showLibrary)}
                  className="w-7 h-7 rounded-lg border-2 border-primary/20 bg-primary/5 flex items-center justify-center text-primary hover:bg-primary/10 transition-all"
                >
                  {showLibrary ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>

            <ScrollArea className="flex-1 p-4">

              {/* Sections list */}
              {activePanel === 'sections' && !showLibrary && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50 mb-3">Active sections</p>
                  {enabledSections.map((s, idx) => (
                    <SectionListItem
                      key={s.id}
                      section={s}
                      isSelected={selectedId === s.id}
                      isFirst={idx === 0}
                      isLast={idx === enabledSections.length - 1}
                      onSelect={() => { setSelectedId(s.id); setActivePanel('sections'); }}
                      onMoveUp={() => moveUp(s.id)}
                      onMoveDown={() => moveDown(s.id)}
                      onHide={() => hideSection(s.id)}
                    />
                  ))}
                  {enabledSections.length === 0 && (
                    <div className="py-8 text-center text-muted-foreground/40 text-xs font-black uppercase tracking-widest">No active sections</div>
                  )}
                </div>
              )}

              {/* Section library */}
              {activePanel === 'sections' && showLibrary && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50 mb-3">Add sections</p>
                  {disabledSections.length === 0
                    ? <div className="py-8 text-center text-muted-foreground/40 text-xs font-black uppercase tracking-widest">All sections active</div>
                    : disabledSections.map(s => <LibraryItem key={s.id} section={s} onAdd={() => addSection(s.id)} />)
                  }
                </div>
              )}

              {/* Style panel */}
              {activePanel === 'style' && (
                <div className="space-y-8">
                  {/* Accent color */}
                  <div className="space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Accent color</p>
                    <div className="flex flex-wrap gap-2">
                      {ACCENT_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setStyle(p => ({ ...p, accentColor: c }))}
                          className={cn('w-7 h-7 rounded-full border-4 transition-transform hover:scale-110', style.accentColor === c ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent')}
                          style={{ background: c }}
                          title={c}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl shrink-0" style={{ background: style.accentColor }} />
                      <Input
                        value={style.accentColor}
                        onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setStyle(p => ({ ...p, accentColor: e.target.value }))}
                        className="h-8 rounded-lg border-2 font-mono text-xs w-28"
                        maxLength={7}
                      />
                    </div>
                  </div>

                  <Separator className="border-dashed" />

                  {/* Background */}
                  <div className="space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Page background</p>
                    <div className="grid grid-cols-4 gap-2">
                      {BG_COLORS.map(c => (
                        <button
                          key={c.hex}
                          onClick={() => setStyle(p => ({ ...p, bgColor: c.hex }))}
                          title={c.label}
                          className={cn('aspect-square rounded-xl border-2 transition-all hover:scale-105', style.bgColor === c.hex ? 'border-primary shadow-md scale-105' : 'border-border')}
                          style={{ background: c.hex }}
                        />
                      ))}
                    </div>
                  </div>

                  <Separator className="border-dashed" />

                  {/* Heading font */}
                  <div className="space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Heading font</p>
                    {FONTS.map(f => (
                      <FontRow key={f.id} font={f} isSelected={style.headingFont === f.id} onClick={() => setStyle(p => ({ ...p, headingFont: f.id }))} />
                    ))}
                  </div>

                  <Separator className="border-dashed" />

                  {/* Body font */}
                  <div className="space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Body font</p>
                    {FONTS.map(f => (
                      <FontRow key={f.id} font={f} isSelected={style.bodyFont === f.id} onClick={() => setStyle(p => ({ ...p, bodyFont: f.id }))} />
                    ))}
                  </div>
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            <div className="p-4 border-t bg-white space-y-2">
              {selectedTenant && (
                <a
                  href={`/book/${selectedTenant.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full h-9 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Open live page
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20"
              >
                {isSaving
                  ? <><Loader className="animate-spin w-3.5 h-3.5 mr-2" />Saving...</>
                  : <><Save className="w-3.5 h-3.5 mr-2" />Save page</>
                }
              </Button>
            </div>
          </div>

          {/* ── Center: field editor ── */}
          <div className="w-80 xl:w-96 h-full flex flex-col border-r bg-white shrink-0">
            {selectedSection && activePanel === 'sections' ? (
              <>
                <div className="p-5 border-b bg-white flex items-center gap-3 shrink-0">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: SECTION_DEFS[selectedSection.type].color + '18' }}
                  >
                    {React.createElement(SECTION_DEFS[selectedSection.type].icon, {
                      className: 'w-4 h-4',
                      style: { color: SECTION_DEFS[selectedSection.type].color },
                    })}
                  </div>
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">
                      {SECTION_DEFS[selectedSection.type].label}
                    </h2>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                      Content & configuration
                    </p>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-5">
                  <div className="space-y-5">
                    {SECTION_DEFS[selectedSection.type].fields.map(field => (
                      <FieldRenderer
                        key={field.k}
                        field={field}
                        value={selectedSection.config[field.k] ?? field.d}
                        onChange={val => updateField(selectedSection.id, field.k, val)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : activePanel === 'style' ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 text-muted-foreground p-8">
                <div className="w-16 h-16 rounded-[1.5rem] bg-primary/10 flex items-center justify-center">
                  <Palette className="w-8 h-8 text-primary" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900">Style your page</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 max-w-xs">
                    Set colors and fonts in the left panel. The preview updates in real time.
                  </p>
                </div>
                <div className="flex flex-col items-center gap-4 mt-2 w-full">
                  <div style={{ fontFamily: headingFontDef?.stack, color: style.accentColor, fontSize: '28px', fontWeight: 300 }}>
                    Heading font preview
                  </div>
                  <div style={{ fontFamily: bodyFontDef?.stack, color: '#64748b', fontSize: '14px' }}>
                    Body text — {bodyFontDef?.label}
                  </div>
                  <div className="flex gap-2 mt-1">
                    {ACCENT_COLORS.slice(0, 6).map(c => (
                      <div key={c} className="w-7 h-7 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground p-8">
                <div className="w-16 h-16 rounded-[1.5rem] bg-muted flex items-center justify-center">
                  <Settings className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900">Select a section</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 max-w-xs">
                    Click any section in the left panel to edit its content
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-xs mt-1">
                  {enabledSections.slice(0, 5).map(s => {
                    const d = SECTION_DEFS[s.type];
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        className="px-3 py-1.5 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all hover:shadow-md"
                        style={{ borderColor: d.color + '40', color: d.color, background: d.color + '0a' }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: live preview ── */}
          <div className="flex-1 h-full flex-col bg-slate-100 hidden lg:flex">

            {/* Preview toolbar */}
            <div className="h-12 px-4 border-b bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live Preview</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Desktop / Mobile toggle */}
                <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    onClick={() => setPreviewMode('desktop')}
                    className={cn('p-1.5 rounded-md transition-all', previewMode === 'desktop' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600')}
                    title="Desktop preview"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPreviewMode('mobile')}
                    className={cn('p-1.5 rounded-md transition-all', previewMode === 'mobile' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600')}
                    title="Mobile preview"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Refresh */}
                <button
                  onClick={() => setPreviewKey(k => k + 1)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                  title="Reload preview"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                {/* Open in new tab */}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                    title="Open in new tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* iframe container */}
            <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
              {previewUrl ? (
                <div
                  className={cn(
                    'h-full transition-all duration-300',
                    previewMode === 'mobile' ? 'w-[390px]' : 'w-full',
                  )}
                >
                  <iframe
                    key={previewKey}
                    ref={previewRef}
                    src={previewUrl}
                    className={cn(
                      'w-full h-full border-0 bg-white',
                      previewMode === 'mobile'
                        ? 'rounded-[2.5rem] shadow-2xl ring-8 ring-slate-800'
                        : 'rounded-2xl shadow-xl',
                    )}
                    title="Booking page preview"
                  />
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <Eye className="w-10 h-10 text-slate-200 mx-auto" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">No tenant selected</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}