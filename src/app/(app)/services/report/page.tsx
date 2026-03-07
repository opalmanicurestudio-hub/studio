
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

export default function ServiceReportPage() {
    const { services, appointments, isLoading } = useInventory();

    const servicePerformance = useMemo(() => {
        if (!services || !appointments) return [];
        return services.map(service => {
            const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
            const totalBookings = bookings.length;
            const totalRevenue = bookings.reduce((acc, apt) => acc + (apt.revenue || service.price), 0);
            return {
                ...service,
                totalBookings,
                totalRevenue,
            };
        });
    }, [services, appointments]);

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
            <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
                <AppHeader title="Yield Analysis" />
                <main className="flex-1 p-10 flex flex-col items-center justify-center gap-4">
                    <Loader className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Synthesizing Dossier...</p>
                </main>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50 print:bg-white overflow-x-hidden">
            <AppHeader title="Yield Analysis" />
            <main className="flex-1 p-4 md:p-10 space-y-10 w-full max-w-7xl mx-auto min-w-0">
                
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 print:hidden">
                    <div className="space-y-1 text-left">
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Yield Report</h1>
                        <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Treatment velocity & margin audit</p>
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <Button variant="outline" size="sm" asChild className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white/50 backdrop-blur-sm shadow-sm">
                            <Link href="/services"><ArrowLeft className="h-4 w-4 mr-2" />Return</Link>
                        </Button>
                        <Button variant="outline" onClick={handleExport} className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm bg-white/50 backdrop-blur-sm">
                            <Download className="mr-2 h-4 w-4" /> Export
                        </Button>
                        <Button onClick={handlePrint} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
                            <Printer className="mr-2 h-4 w-4" /> Print
                        </Button>
                    </div>
                </div>

                <div id="print-area" className="space-y-10">
                    {/* Header for Print Only */}
                    <div className="hidden print:block space-y-2 border-b-4 border-black pb-6 mb-10">
                        <h1 className="text-4xl font-black uppercase tracking-tighter">Studio Yield Dossier</h1>
                        <p className="text-xs font-black uppercase tracking-widest opacity-60">Generated on {format(new Date(), 'PPPP')}</p>
                    </div>

                    {/* KPI Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
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
                                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-1">Total Gross Revenue</p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                                    <Target className="w-3 h-3" /> Alpha Profit
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-xl md:text-2xl font-black text-slate-900 tracking-tighter uppercase truncate leading-none mb-1">{kpiData.mostProfitableService}</p>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Highest Unit Margin</p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                                    <Star className="w-3 h-3" /> Most Booked
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-xl md:text-2xl font-black text-slate-900 tracking-tighter uppercase truncate leading-none mb-1">{kpiData.mostBookedService}</p>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Selection Dominance</p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
                            <CardHeader className="p-6 pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
                                    <BarChart className="w-3 h-3" /> Average Margin
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 text-left">
                                <p className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter font-mono">{kpiData.avgMargin.toFixed(0)}%</p>
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Across all catalog tiers</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Performance Ledger */}
                    <Card className="border-2 shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
                        <CardHeader className="bg-muted/5 border-b p-6 md:p-8 flex flex-row items-center justify-between">
                            <div className="space-y-1">
                                <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">Performance Ledger</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Departmental yield & efficiency audit</CardDescription>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 p-2 bg-primary/5 rounded-full border border-primary/10">
                                <Sparkles className="w-4 h-4 text-primary" />
                                <span className="text-[10px] font-black uppercase text-primary tracking-widest px-2">Live Insights</span>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-muted/10 border-b-2">
                                    <TableRow>
                                        <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-slate-900">Treatment & Category</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Base Price</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Unit Cost</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Net Profit</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Margin</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Volume</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-primary pr-10">Gross Yield</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {servicePerformance.map(service => (
                                        <TableRow key={service.id} className="group hover:bg-primary/[0.02] transition-colors border-b">
                                            <TableCell className="p-6">
                                                <p className="font-black uppercase tracking-tight text-xs md:text-sm text-slate-900">{service.name}</p>
                                                <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-2 mt-1.5">{service.category || 'Standard'}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold text-slate-600">${service.price.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono font-bold text-destructive/60">${service.cost.toFixed(2)}</TableCell>
                                            <TableCell className={cn("text-right font-mono font-black text-sm", service.profit >= 0 ? "text-primary" : "text-destructive")}>
                                                {service.profit >= 0 ? '+' : ''}${service.profit.toFixed(2)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant={service.margin >= 30 ? 'default' : 'secondary'} className={cn("font-black font-mono text-[10px] border-none h-6 px-2", service.margin >= 30 ? "bg-green-500" : "bg-muted text-muted-foreground")}>
                                                    {service.margin.toFixed(0)}%
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-black font-mono text-slate-900">{service.totalBookings}</TableCell>
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
