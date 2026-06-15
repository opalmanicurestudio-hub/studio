'use client';

import React, { useState } from 'react';
import { useTerminal, type TerminalReader } from './StripeTerminalProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  Wifi, WifiOff, Loader, RefreshCw, Monitor, CheckCircle2,
  XCircle, Unplug, Zap, AlertTriangle, Radio,
} from 'lucide-react';

export function TerminalSettings() {
  const {
    isLoaded,
    readerStatus,
    connectedReader,
    discoveredReaders,
    discoverReaders,
    connectReader,
    disconnectReader,
  } = useTerminal();

  const [isDiscovering, setIsDiscovering] = useState(false);
  const [connectingId,  setConnectingId]  = useState<string | null>(null);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    await discoverReaders();
    setIsDiscovering(false);
  };

  const handleConnect = async (reader: TerminalReader) => {
    setConnectingId(reader.id);
    await connectReader(reader);
    setConnectingId(null);
  };

  const statusConfig = {
    not_connected: { color: 'text-slate-400',    bg: 'bg-slate-100',    label: 'No Reader',    icon: WifiOff    },
    connecting:    { color: 'text-amber-600',    bg: 'bg-amber-50',     label: 'Connecting',   icon: Loader     },
    connected:     { color: 'text-green-600',    bg: 'bg-green-50',     label: 'Connected',    icon: Wifi       },
    busy:          { color: 'text-blue-600',     bg: 'bg-blue-50',      label: 'Processing',   icon: Zap        },
    error:         { color: 'text-destructive',  bg: 'bg-destructive/5',label: 'Error',        icon: AlertTriangle },
  };

  const cfg = statusConfig[readerStatus];
  const Icon = cfg.icon;

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className={cn('flex items-center gap-4 p-5 rounded-2xl border-2', cfg.bg,
        readerStatus === 'connected' ? 'border-green-200' :
        readerStatus === 'error'     ? 'border-destructive/20' : 'border-slate-200')}>
        <div className={cn('p-3 rounded-xl', cfg.bg, 'border-2',
          readerStatus === 'connected' ? 'border-green-200' : 'border-slate-200')}>
          <Icon className={cn('w-5 h-5', cfg.color, readerStatus === 'connecting' && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-[10px] font-black uppercase tracking-widest', cfg.color)}>{cfg.label}</p>
          {connectedReader ? (
            <p className="text-xs font-bold text-slate-600 mt-0.5 truncate">{connectedReader.label} · {connectedReader.deviceType}</p>
          ) : (
            <p className="text-[9px] font-bold text-slate-400 mt-0.5">No reader paired to this terminal</p>
          )}
        </div>
        {readerStatus === 'connected' && (
          <Button variant="outline" size="sm" onClick={disconnectReader}
            className="h-8 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-destructive border-destructive/20 hover:bg-destructive/5">
            <Unplug className="w-3 h-3 mr-1.5" /> Unpair
          </Button>
        )}
      </div>

      {/* Connected reader details */}
      {connectedReader && (
        <Card className="border-2 rounded-2xl bg-white shadow-sm">
          <CardHeader className="p-5 pb-3 border-b bg-muted/5">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Monitor className="w-3.5 h-3.5" /> Paired Reader
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-0.5">
                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Device Type</p>
                <p className="text-xs font-black text-slate-900 uppercase">{connectedReader.deviceType}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Serial</p>
                <p className="text-xs font-black text-slate-900 font-mono">{connectedReader.serialNumber}</p>
              </div>
              {connectedReader.ipAddress && (
                <div className="space-y-0.5">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">IP Address</p>
                  <p className="text-xs font-black text-slate-900 font-mono">{connectedReader.ipAddress}</p>
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Status</p>
                <Badge className="bg-green-500 text-white border-none font-black text-[8px] uppercase h-5 px-2">
                  <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Online
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discover readers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Available Readers
          </p>
          <Button variant="outline" size="sm" onClick={handleDiscover} disabled={isDiscovering || !isLoaded}
            className="h-8 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
            {isDiscovering
              ? <><Loader className="w-3 h-3 mr-1.5 animate-spin" /> Scanning...</>
              : <><RefreshCw className="w-3 h-3 mr-1.5" /> Scan for Readers</>}
          </Button>
        </div>

        {!isLoaded && (
          <div className="py-8 text-center border-2 border-dashed rounded-2xl opacity-40">
            <Loader className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-[10px] font-black uppercase tracking-widest">Loading Terminal SDK...</p>
          </div>
        )}

        {isLoaded && discoveredReaders.length === 0 && !isDiscovering && (
          <div className="py-10 text-center border-2 border-dashed rounded-2xl opacity-30 flex flex-col items-center gap-3">
            <Radio className="w-8 h-8" />
            <p className="text-[10px] font-black uppercase tracking-widest">No readers found</p>
            <p className="text-[9px] font-bold text-muted-foreground px-6 leading-relaxed">
              Make sure your reader is powered on and connected to the same network as this device, then tap Scan.
            </p>
          </div>
        )}

        {discoveredReaders.length > 0 && (
          <div className="space-y-2">
            {discoveredReaders.map(reader => {
              const isConnected = connectedReader?.id === reader.id;
              const isConnecting = connectingId === reader.id;
              return (
                <div key={reader.id}
                  className={cn('flex items-center justify-between p-4 rounded-2xl border-2 transition-all',
                    isConnected ? 'border-green-200 bg-green-50' : 'border-border bg-white hover:border-primary/20')}>
                  <div className="flex items-center gap-3">
                    <div className={cn('p-2 rounded-xl', isConnected ? 'bg-green-100' : 'bg-muted/20')}>
                      <Monitor className={cn('w-4 h-4', isConnected ? 'text-green-600' : 'text-slate-400')} />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">{reader.label}</p>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                        {reader.deviceType} · {reader.serialNumber}
                      </p>
                    </div>
                  </div>
                  {isConnected ? (
                    <Badge className="bg-green-500 text-white border-none font-black text-[8px] uppercase h-6 px-2">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Paired
                    </Badge>
                  ) : (
                    <Button size="sm" onClick={() => handleConnect(reader)} disabled={isConnecting || readerStatus === 'connecting'}
                      className="h-8 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-sm">
                      {isConnecting ? <Loader className="w-3 h-3 animate-spin" /> : 'Pair'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Setup guidance */}
      <div className="p-4 rounded-2xl bg-muted/10 border-2 border-dashed space-y-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Setup Requirements</p>
        <div className="space-y-2">
          {[
            'Reader must be on the same Wi-Fi network as this device',
            'Supported readers: Stripe Reader S700, BBPOS WisePOS E',
            'Register your reader in the Stripe Dashboard → Terminal → Readers',
            'Each studio location manages its own reader — pairings are saved per device',
          ].map((note, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[8px] font-black text-muted-foreground opacity-40 mt-0.5 shrink-0">{i + 1}.</span>
              <p className="text-[9px] font-bold text-muted-foreground leading-relaxed">{i < 2 ? note : <span className="opacity-60">{note}</span>}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}