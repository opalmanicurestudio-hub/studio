// ─────────────────────────────────────────────────────────────────────────────
// Replace the entire {/* ── BUILDER ── */} TabsContent block in settings/page.tsx
// with this. Everything else in the file stays the same.
// Also remove these imports that are no longer needed in the builder tab:
//   ImageUpload (keep if used elsewhere in the file — it IS used in Kiosk tab, so keep it)
//   Textarea    (keep — used in Policies tab)
//   Separator   (keep — used everywhere)
// ─────────────────────────────────────────────────────────────────────────────

            {/* ── BUILDER ── */}
            <TabsContent value="builder" className="mt-0 animate-in fade-in duration-500 text-left">
              <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                  <SectionHeader icon={Globe} title="Booking Architecture" />
                  <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
                    Design and publish your guest-facing booking page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 md:p-8 space-y-6">

                  {/* Primary CTA — open page builder */}
                  <div className="flex flex-col sm:flex-row items-center gap-6 p-8 rounded-[2rem] border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/[0.02] shadow-inner">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0">
                      <Sparkles className="w-7 h-7 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1.5 text-center sm:text-left">
                      <p className="text-base font-black uppercase tracking-tight text-slate-900">Page Builder</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-70 leading-relaxed">
                        Drag sections, choose fonts and colors, upload images, and configure every block of your
                        public booking page — all in one visual editor.
                      </p>
                    </div>
                    <a
                      href="/studio/page-builder"
                      className="shrink-0 flex items-center gap-2 h-12 px-8 rounded-2xl bg-primary text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 whitespace-nowrap"
                    >
                      Open Builder
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>

                  {/* What the builder controls — quick reference */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { icon: Palette,   label: 'Brand kit & colors'    },
                      { icon: FileText,  label: 'Fonts & typography'    },
                      { icon: LayoutGrid, label: 'Section order & layout'},
                      { icon: ImageIcon, label: 'Hero & gallery images' },
                      { icon: Star,      label: 'Reviews & team'        },
                      { icon: Globe,     label: 'Social & contact'      },
                    ].map(item => (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 p-3.5 rounded-2xl border-2 border-border bg-muted/5"
                      >
                        <item.icon className="w-4 h-4 text-primary opacity-60 shrink-0" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 leading-tight">
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Live page URL */}
                  {selectedTenant && (
                    <div className="flex items-center justify-between gap-4 p-5 rounded-[2rem] border-2 border-dashed border-border bg-muted/5">
                      <div className="space-y-1 min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                          Your live booking page
                        </p>
                        <p className="text-xs font-black text-slate-700 truncate font-mono">
                          /book/{selectedTenant.id}
                        </p>
                      </div>
                      <a
                        href={`/book/${selectedTenant.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 flex items-center gap-1.5 h-9 px-4 rounded-xl border-2 border-border bg-white font-black uppercase text-[9px] tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Live
                      </a>
                    </div>
                  )}

                </CardContent>
              </Card>
            </TabsContent>
