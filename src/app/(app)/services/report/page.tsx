
'use client';

import React, { useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ArrowLeft, Printer, BarChart, DollarSign, TrendingUp, Star, Download } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { format, isPast, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { type Service } from '@/lib/data';

// Component for the report page
const ServiceReportPage = () => {
    const { services, appointments } = useInventory();

    const servicePerformance = useMemo(() => {
        return services.map(service => {
            const bookings = appointments.filter(apt => apt.serviceId === service.id && apt.status === 'completed');
            const totalBookings = bookings.length;
            const totalRevenue = totalBookings * service.price;
            return {
                ...service,
                totalBookings,
                totalRevenue,
            };
        });
    }, [services, appointments]);

    const kpiData = useMemo(() => {
        if (servicePerformance.length === 0) {
            return {
                totalRevenue: 0,
                mostProfitableService: 'N/A',
                mostBookedService: 'N/A',
            };
        }

        const totalRevenue = servicePerformance.reduce((acc, s) => acc + s.totalRevenue, 0);

        const mostProfitableService = servicePerformance.reduce((max, service) => service.profit > max.profit ? service : max, servicePerformance[0]);

        const mostBookedService = servicePerformance.reduce((max, service) => service.totalBookings > max.totalBookings ? service : max, servicePerformance[0]);

        return {
            totalRevenue,
            mostProfitableService: mostProfitableService.name,
            mostBookedService: mostBookedService.name,
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
        const link = document.createElement('a');
        if (link.href) {
            URL.revokeObjectURL(link.href);
        }
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', `services-performance-report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="flex min-h-screen w-full flex-col bg-muted/40 print:bg-white">
            <AppHeader title="Services Performance Report" />
            <main className="flex-1 p-4 md:p-8 space-y-6 print:p-4">
                <div className="flex items-center justify-between print:hidden">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/services">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Services
                        </Link>
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleExport}>
                            <Download className="h-4 w-4 mr-2" />
                            Export CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={handlePrint}>
                            <Printer className="h-4 w-4 mr-2" />
                            Print Report
                        </Button>
                    </div>
                </div>

                <div id="print-area" className="max-w-5xl mx-auto space-y-8">
                    <header className="space-y-2">
                        <h1 className="text-3xl font-bold">Services Performance Report</h1>
                        <p className="text-muted-foreground">Generated on {format(new Date(), 'MMMM d, yyyy')}</p>
                    </header>

                    {/* KPIs */}
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Card className="print:shadow-none print:border-gray-300">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">${kpiData.totalRevenue.toFixed(2)}</div>
                                <p className="text-xs text-muted-foreground">From all completed services</p>
                            </CardContent>
                        </Card>
                         <Card className="print:shadow-none print:border-gray-300">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Most Profitable</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold truncate">{kpiData.mostProfitableService}</div>
                                <p className="text-xs text-muted-foreground">Highest profit per service</p>
                            </CardContent>
                        </Card>
                         <Card className="print:shadow-none print:border-gray-300">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Most Booked</CardTitle>
                                <Star className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold truncate">{kpiData.mostBookedService}</div>
                                <p className="text-xs text-muted-foreground">Most popular service by bookings</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Service Details Table */}
                    <Card className="print:shadow-none print:border-gray-300">
                        <CardHeader><CardTitle>Service Breakdown</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Service</TableHead>
                                        <TableHead className="text-right">Price</TableHead>
                                        <TableHead className="text-right">Cost</TableHead>
                                        <TableHead className="text-right">Profit</TableHead>
                                        <TableHead className="text-right">Margin</TableHead>
                                        <TableHead className="text-right">Bookings</TableHead>
                                        <TableHead className="text-right">Total Revenue</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {servicePerformance.map(service => (
                                        <TableRow key={service.id}>
                                            <TableCell className="font-medium">{service.name}</TableCell>
                                            <TableCell className="text-right font-mono">${service.price.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono text-red-500">${service.cost.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono text-green-500">${service.profit.toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-mono">{service.margin.toFixed(1)}%</TableCell>
                                            <TableCell className="text-right font-mono">{service.totalBookings}</TableCell>
                                            <TableCell className="text-right font-mono font-bold">${service.totalRevenue.toFixed(2)}</TableCell>
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
                }
            `}</style>
        </div>
    );
}

export default ServiceReportPage;
