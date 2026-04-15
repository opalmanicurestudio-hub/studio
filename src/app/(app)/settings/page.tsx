// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS PAGE — KIOSK TAB ADDITIONS
// Replace the entire <TabsContent value="kiosk"> block in settings/page.tsx
// ═══════════════════════════════════════════════════════════════════════════════

// ── ADD TO IMPORTS (top of settings page) ─────────────────────────────────────
// import { Palette, Eye } from 'lucide-react';
// These are likely already imported, just verify.

// ── ADD THIS CONSTANT near the top of the file (after defaultRecoveryPresets) ──
const KIOSK_COLOR_LIBRARY = [
  // Neutrals
  { hex: '#0f172a', name: 'Midnight' },
  { hex: '#1e293b', name: 'Slate 800' },
  { hex: '#334155', name: 'Slate 700' },
  { hex: '#64748b', name: 'Slate 500' },
  { hex: '#e2e8f0', name: 'Slate 200' },
  // Purples
  { hex: '#7c3aed', name: 'Violet' },
  { hex: '#6d28d9', name: 'Purple' },
  { hex: '#a78bfa', name: 'Lavender' },
  { hex: '#c4b5fd', name: 'Soft Violet' },
  { hex: '#ddd6fe', name: 'Pale Lavender' },
  // Pinks / Rose
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#e11d48', name: 'Deep Rose' },
  { hex: '#fb7185', name: 'Pink' },
  { hex: '#fda4af', name: 'Soft Pink' },
  { hex: '#fce7f3', name: 'Blush' },
  // Greens
  { hex: '#059669', name: 'Emerald' },
  { hex: '#10b981', name: 'Green' },
  { hex: '#34d399', name: 'Mint' },
  { hex: '#6ee7b7', name: 'Sage' },
  { hex: '#d1fae5', name: 'Pale Mint' },
  // Blues
  { hex: '#2563eb', name: 'Blue' },
  { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#38bdf8', name: 'Light Blue' },
  { hex: '#7dd3fc', name: 'Powder' },
  { hex: '#bae6fd', name: 'Pale Blue' },
  // Ambers / Golds
  { hex: '#d97706', name: 'Amber' },
  { hex: '#f59e0b', name: 'Gold' },
  { hex: '#fbbf24', name: 'Yellow' },
  { hex: '#fcd34d', name: 'Butter' },
  { hex: '#fef3c7', name: 'Cream' },
];

// ── REPLACE the entire <TabsContent value="kiosk"> block with this ─────────────

// Inside SettingsPageImpl — add this to the state declarations:
//   const [kioskCustomHex, setKioskCustomHex] = useState(tenantData?.kioskSettings?.primaryColor || '');

// Then replace the kiosk TabsContent:

/*
<TabsContent value="kiosk" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
  <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
    <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
      <SectionHeader icon={Fingerprint} title="Kiosk Orchestration" />
      <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
        Manage the check-in terminal experience.
      </CardDescription>
    </CardHeader>
    <CardContent className="p-6 md:p-8 space-y-10 text-left">

      --- BRANDING SECTION ---
      <div className="space-y-8">
        <div className="flex items-center gap-3 px-1">
          <ImageIcon className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Brand Identity</h3>
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
            Kiosk Logo
          </Label>
          <ImageUpload
            onImageUploaded={(url) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, logoUrl: url } }))}
            initialImage={tenantData.kioskSettings?.logoUrl}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
            Wordmark / Text Logo (optional)
          </Label>
          <ImageUpload
            onImageUploaded={(url) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, wordmarkUrl: url } }))}
            initialImage={tenantData.kioskSettings?.wordmarkUrl}
          />
          <p className="text-[9px] font-bold text-muted-foreground uppercase ml-1">
            Upload a horizontal text logo if you want the full name displayed
          </p>
        </div>

        <SettingRow icon={ImageIcon} title="Show Studio Name" description="Display wordmark or text name on the splash screen">
          <Switch
            checked={tenantData.kioskSettings?.showWordmark !== false}
            onCheckedChange={(val) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, showWordmark: val } }))}
            disabled={!isEditing}
            className="scale-125 data-[state=checked]:bg-primary"
          />
        </SettingRow>
      </div>

      <Separator className="border-dashed" />

      --- THEME & COLOR SECTION ---
      <div className="space-y-8">
        <div className="flex items-center gap-3 px-1">
          <Palette className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Kiosk Theme & Color</h3>
        </div>

        -- Theme preset tiles --
        <div className="space-y-3">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
            Base Theme
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { key: 'light',  label: 'Light',  preview: 'bg-white border-slate-200',              dot: 'bg-slate-900' },
              { key: 'dark',   label: 'Dark',   preview: 'bg-slate-900 border-slate-700',           dot: 'bg-white' },
              { key: 'rose',   label: 'Rose',   preview: 'bg-gradient-to-br from-rose-50 to-white', dot: 'bg-rose-500' },
              { key: 'sage',   label: 'Sage',   preview: 'bg-gradient-to-br from-emerald-50 to-white', dot: 'bg-emerald-600' },
              { key: 'slate',  label: 'Slate',  preview: 'bg-gradient-to-br from-slate-700 to-slate-900', dot: 'bg-white' },
            ].map(theme => (
              <button
                key={theme.key}
                onClick={() => isEditing && setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, theme: theme.key } }))}
                disabled={!isEditing}
                className={cn(
                  'relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-center',
                  theme.preview,
                  tenantData.kioskSettings?.theme === theme.key || (!tenantData.kioskSettings?.theme && theme.key === 'light')
                    ? 'border-primary shadow-lg ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/30',
                  !isEditing && 'opacity-60 cursor-not-allowed'
                )}
              >
                {(tenantData.kioskSettings?.theme === theme.key || (!tenantData.kioskSettings?.theme && theme.key === 'light')) && (
                  <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
                <div className={cn('w-8 h-8 rounded-xl border-2 border-white/30 shadow-sm', theme.dot)} />
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">{theme.label}</p>
              </button>
            ))}
          </div>
        </div>

        -- Accent color library --
        <div className="space-y-3">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
            Accent Color
          </Label>
          <p className="text-[9px] font-bold text-muted-foreground uppercase ml-1 opacity-60">
            Overrides button and highlight colors. Leave unset to use theme default.
          </p>

          -- Color library grid --
          <div className="grid grid-cols-10 gap-2 p-4 rounded-2xl border-2 border-border bg-muted/5">
            {KIOSK_COLOR_LIBRARY.map(color => (
              <button
                key={color.hex}
                title={color.name}
                onClick={() => {
                  if (!isEditing) return;
                  setKioskCustomHex(color.hex);
                  setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: color.hex } }));
                }}
                disabled={!isEditing}
                className={cn(
                  'w-8 h-8 rounded-lg border-2 transition-all hover:scale-110',
                  (tenantData.kioskSettings?.primaryColor === color.hex) ? 'border-slate-900 scale-110 shadow-lg' : 'border-transparent',
                  !isEditing && 'cursor-not-allowed'
                )}
                style={{ backgroundColor: color.hex }}
              />
            ))}
          </div>

          -- Custom hex input --
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl border-2 shadow-inner shrink-0"
              style={{ backgroundColor: tenantData.kioskSettings?.primaryColor || '#0f172a' }}
            />
            <div className="flex-1 space-y-1">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                Custom Color (Hex)
              </Label>
              <div className="flex gap-2">
                <Input
                  value={kioskCustomHex}
                  onChange={e => setKioskCustomHex(e.target.value)}
                  onBlur={() => {
                    if (/^#[0-9a-fA-F]{6}$/.test(kioskCustomHex)) {
                      setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: kioskCustomHex } }));
                    }
                  }}
                  placeholder="#7c3aed"
                  disabled={!isEditing}
                  className="h-10 rounded-xl border-2 font-mono font-black flex-1"
                />
                {tenantData.kioskSettings?.primaryColor && isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setKioskCustomHex('');
                      setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, primaryColor: undefined } }));
                    }}
                    className="h-10 px-3 rounded-xl text-[9px] font-black uppercase text-muted-foreground hover:text-destructive"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        -- Live preview hint --
        <div className="p-4 rounded-2xl border-2 border-dashed bg-primary/5 border-primary/20 flex items-center gap-3">
          <Eye className="w-5 h-5 text-primary shrink-0" />
          <p className="text-[9px] font-bold text-primary uppercase tracking-widest leading-relaxed">
            Changes appear live on your kiosk at{' '}
            <span className="font-black">/walk-in/{selectedTenant?.id}</span>.
            Save settings to lock them in.
          </p>
        </div>
      </div>

      <Separator className="border-dashed" />

      --- HOURS SECTION (keep existing) ---
      <SettingRow icon={Clock} title="Specific Kiosk Hours" description="Close walk-ins earlier than business hours">
        <Switch
          checked={!!tenantData.kioskSettings?.useSpecificHours}
          onCheckedChange={(val) => setTenantData(prev => ({ ...prev, kioskSettings: { ...prev.kioskSettings, useSpecificHours: val } }))}
          disabled={!isEditing}
          className="scale-125 data-[state=checked]:bg-primary"
        />
      </SettingRow>
      <AnimatePresence>
        {tenantData.kioskSettings?.useSpecificHours && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pt-4 border-t border-dashed">
            <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Walk-in Window Schedule</Label>
            <div className="space-y-3">
              {dayOrder.map(day => (
                <DayHoursRow key={`kiosk-${day}`} day={day}
                  data={localKioskSchedule?.[day] || { enabled: false, start: '09:00 AM', end: '05:00 PM' }}
                  onChange={handleKioskScheduleChange} disabled={!isEditing} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </CardContent>
  </Card>
</TabsContent>
*/

// ── ALSO ADD to the useEffect that loads tenant data ──────────────────────────
// After: if (selectedTenant) {
//   ...existing code...
//   setKioskCustomHex(selectedTenant.kioskSettings?.primaryColor || '');
// }

// ── ALSO ADD to handleSave — kioskSettings already saves via tenantData,
// but make sure primaryColor is included in finalTenantData:
// The existing save logic `{ ...tenantData, kioskSettings: {...} }` handles it automatically.

export {}; // makes this a module
