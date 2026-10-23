
'use client';

import React, { useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowLeft, Printer, BarChart, DollarSign, TrendingUp, Star, Download, Target, Activity, Loader, Sparkles } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useHistoryStats } from '@/hooks/use-history-stats';

// What reaches paper, in the app's print look (lib/print-style): Plus Jakarta Sans, a light title, sentence-case grey
// labels, soft stat panels, thin #ececee lines, tabular figures. Scoped to #print-area and to print only, so the screen
// is untouched; the id selectors outrank the global print rules that keep app screens uppercase and heavy on paper.
const PAPER_CSS = `
@media print {
  @page { margin: 0.55in; }
  #print-area { font-family: 'Plus Jakarta Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #16171a; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #print-area > * + * { margin-top: 18px !important; }
  #print-area * { color: inherit !important; background-color: transparent !important; border-color: #ececee !important; box-shadow: none !important; text-shadow: none !important; text-transform: none !important; letter-spacing: normal !important; opacity: 1 !important; font-variant-numeric: tabular-nums; }
  #print-area svg, #print-area button, #print-area .rp-hide { display: none !important; }
  #print-area .font-mono { font-family: inherit !important; font-weight: 400 !important; }
  #print-area .font-bold, #print-area .font-semibold { font-weight: 500 !important; }
  #print-area .font-black, #print-area .font-extrabold { font-weight: 600 !important; }
  #print-area .border-2, #print-area .border-4 { border-width: 1px !important; }
  #print-area .border-b-2, #print-area .border-b-4 { border-bottom-width: 1px !important; }
  #print-area .text-destructive { color: #b42318 !important; }

  #print-area .rp-head { justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid #ececee; }
  #print-area .rp-title { margin: 0; font-size: 26px; font-weight: 300 !important; letter-spacing: -0.02em !important; line-height: 1.15; }
  #print-area .rp-title b { font-weight: 600 !important; }
  #print-area .rp-sub { margin-top: 4px; color: #6d7075 !important; }
  #print-area .rp-meta { font-size: 11px; color: #6d7075 !important; text-align: right; white-space: nowrap; }

  #print-area .rp-kpis { display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 10px !important; }
  #print-area .rp-kpis > div { background-color: #f5f5f7 !important; border: 0 !important; border-radius: 14px !important; padding: 12px 14px !important; break-inside: avoid; }
  #print-area .rp-kpis > div > div { padding: 0 !important; }
  #print-area .rp-kpis > div > div:nth-last-child(2) * { font-size: 11px !important; font-weight: 500 !important; color: #6d7075 !important; }
  #print-area .rp-kpis > div > div:last-child > p:first-child { margin: 3px 0 0 !important; font-size: 20px !important; font-weight: 300 !important; letter-spacing: -0.01em !important; line-height: 1.25 !important; white-space: normal !important; }
  #print-area .rp-kpis > div > div:last-child > p + p { margin: 2px 0 0 !important; font-size: 11px !important; font-weight: 400 !important; color: #6d7075 !important; }

  #print-area .rp-ledger { border: 0 !important; border-radius: 0 !important; overflow: visible !important; }
  #print-area .rp-ledger > div:first-child { padding: 0 0 8px !important; border: 0 !important; }
  #print-area .rp-ledger > div:first-child > div:first-child > :first-child { font-size: 13px !important; font-weight: 600 !important; }
  #print-area .rp-ledger > div:first-child > div:first-child > :last-child { font-size: 11px !important; font-weight: 400 !important; color: #6d7075 !important; }
  #print-area .rp-ledger > div:last-child { padding: 0 !important; overflow: visible !important; }
  #print-area table { width: 100%; border-collapse: collapse; }
  #print-area thead { display: table-header-group; }
  #print-area tr { border-bottom: 1px solid #ececee !important; break-inside: avoid; }
  #print-area th { height: auto !important; padding: 6px 8px !important; font-size: 11px !important; font-weight: 500 !important; color: #6d7075 !important; }
  #print-area td { padding: 7px 8px !important; vertical-align: top; font-size: 12px !important; }
  #print-area td * { font-size: inherit !important; line-height: 1.4 !important; }
  #print-area td [class~="rounded-full"] { display: inline-flex; height: auto !important; margin-top: 3px !important; padding: 2px 8px !important; border: 0 !important; border-radius: 999px !important; background-color: #f5f5f7 !important; color: #45474c !important; font-size: 10.5px !important; font-weight: 500 !important; }
  #print-area td [class~="bg-green-500"] { background-color: #eaf6ef !important; color: #1f7a4d !important; }
}
`;

export default function ServiceReportPage() {
    const { services, isLoading: ctxLoading } = useInventory();
    const { stats: history, isLoading: histLoading } = useHistoryStats();   // all-time numbers, worked out on the server
    const isLoading = ctxLoading || histLoading;

    const servicePerformance = useMemo(() => {
        if (!services) return [];
        return services.map(service => {
            const h = history?.services?.[service.id];
            const totalBookings = h?.b || 0;
            const totalRevenue = h?.rv || 0;
            return {
                ...service,
                totalBookings,
                totalRevenue,
            };
        });
    }, [services, history]);

    const kpiData = useMemo(() => {
        if (!servicePerformance || servicePerformance.length === 0) {
            return {
                totalRevenue: 0,
                mostProfitableService: 'N/A',
                mostBookedService: 'N/A',
                avgMargin: 0
            };
        }

        const totalRevenue = servicePerformance.reduce((acc, s) => acc + s.totalRevenue, 0);
        const totalMargin = servicePerformance.reduce((acc, s) => acc + s.margin, 0);
        const mostProfitableService = servicePerformance.reduce((max, service) => service.profit > max.profit ? service : max, servicePerformance[0]);
        const mostBookedService = servicePerformance.reduce((max, service) => service.totalBookings > max.totalBookings ? service : max, servicePerformance[0]);

        return {
            totalRevenue,
            mostProfitableService: mostProfitableService.name,
            mostBookedService: mostBookedService.name,
            avgMargin: totalMargin / servicePerformance.length
        }
    }, [servicePerformance]);

    const handlePrint = () => {
        window.print();
    };

    const handleExport = () => {
        const headers = ['Service Name', 'Category', 'Price', 'Cost', 'Profit', 'Margin (%)', 'Total Bookings', 'Total Revenue'];
        
        const data = servicePerformance.map(service => [
            `"${service.name.replace(/"/g, '""')}"`,
            service.category,
            service.price.toFixed(2),
            service.cost.toFixed(2),
            service.profit.toFixed(2),
            service.margin.toFixed(1),
            service.totalBookings.toString(),
            service.totalRevenue.toFixed(2)
        ]);

        const csvContent = [
            headers.join(','),
            ...data.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `services-performance_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (isLoading) {
        return (
            <div className="flex min-h-screen w-full flex-col bg-background">
                <AppHeader title="Yield Analysis" />
                <main className="flex-1 p-10 flex flex-col items-center justify-center gap-4">
                    <Loader className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Synthesizing Dossier...</p>
                </main>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen w-full flex-col bg-background print:bg-card overflow-x-hidden">
            <AppHeader title="Yield Analysis" />
            <main className="flex-1 p-4 md:p-10 space-y-10 w-full max-w-7xl mx-auto min-w-0">
                
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 print:hidden">
                    <div className="space-y-1 text-left">
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-foreground leading-none">Yield Report</h1>
                        <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Treatment velocity & margin audit</p>
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <Button variant="outline" size="sm" asChild className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-card/50 backdrop-blur-sm shadow-sm">
                            <Link href="/services"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link>
                        </Button>
                        <Button variant="outline" onClick={handleExport} className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm bg-card/50 backdrop-blur-sm">
                            <Download className="mr-2 h-4 w-4" /> Export
                        </Button>
                        <Button onClick={handlePrint} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
                            <Printer className="mr-2 h-4 w-4" /> Print
                        </Button>
                    </div>
                </div>

                <div id="print-area" className="space-y-10">
                    <div className="rp-head hidden print:flex">
                        <div>
                            <h1 className="rp-title">Yield <b>report</b></h1>
                            <p className="rp-sub">Price, cost and margin for every service, with all-time bookings and revenue</p>
                        </div>
                        <p className="rp-meta">Printed {format(new Date(), 'MMM d, yyyy, h:mm a')}</p>
                    </div>

                    <div className="rp-kpis grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
                            <div className="absolute top-0 right-0 p-4 opacity-5 transition-opacity group-hover:opacity-10">
                                <TrendingUp className="w-16 h-16 text-primary" />
                            </div>
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-primary flex items-center gap-2">
                                    <Activity className="w-3 h-3" /> Yield Velocity
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-3xl md:text-4xl font-black text-primary tracking-tighter font-mono">${kpiData.totalRevenue.toFixed(0)}</p>
                                <p className="text-[9px] font-bold text-foreground/80 uppercase tracking-widest mt-1">Total Gross Revenue</p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 shadow-sm rounded-[2.5rem] bg-card overflow-hidden">
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                                    <Target className="w-3 h-3" /> Alpha Profit
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-xl md:text-2xl font-black text-foreground tracking-tighter uppercase truncate leading-none mb-1">{kpiData.mostProfitableService}</p>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Highest Unit Margin</p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 shadow-sm rounded-[2.5rem] bg-card overflow-hidden">
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                                    <Star className="w-3 h-3" /> Most Booked
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-xl md:text-2xl font-black text-foreground tracking-tighter uppercase truncate leading-none mb-1">{kpiData.mostBookedService}</p>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Selection Dominance</p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 shadow-sm rounded-[2.5rem] bg-card overflow-hidden">
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                                    <BarChart className="w-3 h-3" /> Average Margin
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-3xl md:text-4xl font-black text-foreground tracking-tighter font-mono">{kpiData.avgMargin.toFixed(0)}%</p>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Across all catalog tiers</p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="rp-ledger border-2 shadow-2xl rounded-[2.5rem] overflow-hidden bg-card">
                        <CardHeader className="bg-muted/5 border-b p-6 md:p-8 flex flex-row items-center justify-between">
                            <div className="space-y-1">
                                <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">Performance Ledger</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Departmental yield & efficiency audit</CardDescription>
                            </div>
                            <div className="rp-hide hidden sm:flex items-center gap-2 p-2 bg-primary/5 rounded-full border border-primary/10">
                                <Sparkles className="w-4 h-4 text-primary" />
                                <span className="text-[10px] font-black uppercase text-primary tracking-widest px-2">Live Insights</span>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-muted/10 border-b-2">
                                    <TableRow>
                                        <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-foreground">Treatment & Category</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-foreground">Base Price</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-foreground">Unit Cost</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-foreground">Net Profit</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-foreground">Margin</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-foreground">Volume</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-primary pr-10">Gross Yield</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {servicePerformance.map(service => (
                                        <TableRow key={service.id} className="group hover:bg-primary/[0.02] transition-colors border-b">
                                            <TableCell className="p-6">
                                                <p className="font-black uppercase tracking-tight text-xs md:text-sm text-foreground">{service.name}</p>
                                                <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-2 mt-1.5">{service.category || 'Standard'}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold text-foreground/80">${service.price.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono font-bold text-destructive/60">${service.cost.toFixed(2)}</TableCell>
                                            <TableCell className={cn("text-right font-mono font-black text-sm", service.profit >= 0 ? "text-primary" : "text-destructive")}>
                                                {service.profit >= 0 ? '+' : ''}${service.profit.toFixed(2)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant={service.margin >= 30 ? 'default' : 'secondary'} className={cn("font-black font-mono text-[10px] border-none h-6 px-2", service.margin >= 30 ? "bg-green-500" : "bg-muted text-muted-foreground")}>
                                                    {service.margin.toFixed(0)}%
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-black font-mono text-foreground">{service.totalBookings}</TableCell>
                                            <TableCell className="text-right pr-10">
                                                <span className="font-black font-mono text-base md:text-xl tracking-tighter text-primary">${service.totalRevenue.toFixed(2)}</span>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </main>
             <style>{PAPER_CSS}</style>
             <style jsx global>{`
                @media print {
                  body * {
                    visibility: hidden;
                  }
                  #print-area, #print-area * {
                    visibility: visible;
                  }
                  #print-area {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100%;
                  }
                  .print-header {
                      display: flex !important;
                  }
                }
            `}</style>
        </div>
    );
}
