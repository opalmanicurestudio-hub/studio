
'use client';

import React, { useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Users, UserPlus, Repeat, DollarSign, Crown, UserCheck, UserX, Gift, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { subMonths, isAfter, startOfMonth, endOfMonth, isWithinInterval, format } from 'date-fns';
import { Client } from '@/lib/data';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';


const ClientList = ({ clients }: { clients: Client[] }) => (
    <div className="space-y-3">
        {clients.map(client => (
            <div key={client.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={client.avatarUrl} alt={client.name} />
                        <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <Link href={`/clients/${client.id}`} className="font-semibold text-sm hover:underline">{client.name}</Link>
                        <p className="text-xs text-muted-foreground">{client.email}</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="font-mono text-sm">${client.lifetimeValue.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">LTV</p>
                </div>
            </div>
        ))}
    </div>
);


const ClientLogReportPage = () => {
    const { clients, appointments } = useInventory();

    const reportData = useMemo(() => {
        const activeClients = clients.filter(c => c.status !== 'archived');
        const now = new Date();
        const threeMonthsAgo = subMonths(now, 3);
        const currentMonthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

        const clientAppointmentCounts = activeClients.reduce((acc, client) => {
            acc[client.id] = appointments.filter(apt => apt.clientId === client.id).length;
            return acc;
        }, {} as Record<string, number>);

        const newClientsThisMonth = activeClients.filter(client => {
            const firstAppointment = appointments
                .filter(apt => apt.clientId === client.id)
                .sort((a,b) => a.startTime.getTime() - b.startTime.getTime())[0];
            return firstAppointment && isWithinInterval(firstAppointment.startTime, currentMonthInterval);
        }).length;
        
        const returningClientsCount = activeClients.filter(c => (clientAppointmentCounts[c.id] || 0) > 1).length;
        const retentionRate = activeClients.length > 0 ? (returningClientsCount / activeClients.length) * 100 : 0;
        
        const averageLTV = activeClients.length > 0 ? activeClients.reduce((acc, c) => acc + c.lifetimeValue, 0) / activeClients.length : 0;
        
        const sortedByLtv = [...activeClients].sort((a, b) => b.lifetimeValue - a.lifetimeValue);
        const vipClientCount = Math.ceil(sortedByLtv.length * 0.1);
        const vipClients = sortedByLtv.slice(0, vipClientCount);

        const newClients = activeClients.filter(c => (clientAppointmentCounts[c.id] || 0) <= 1);
        const atRiskClients = activeClients.filter(c => isAfter(threeMonthsAgo, new Date(c.lastAppointment)));
        
        const top10Ltv = sortedByLtv.slice(0, 10);
        
        const referralCounts = activeClients.reduce((acc, client) => {
            if (client.referredBy) {
                acc[client.referredBy] = (acc[client.referredBy] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
        
        const topReferrers = Object.entries(referralCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        const clientLifecycle = {
            newClients: newClients.filter(c => !atRiskClients.some(ar => ar.id === c.id)).length,
            returningClients: activeClients.filter(c => 
                !newClients.some(nc => nc.id === c.id) && 
                !atRiskClients.some(ar => ar.id === c.id)
            ).length,
            atRiskClients: atRiskClients.length,
        };


        return {
            totalActiveClients: activeClients.length,
            newClientsThisMonth,
            retentionRate,
            averageLTV,
            vipClients,
            newClients,
            atRiskClients,
            top10Ltv,
            topReferrers,
            clientLifecycle
        };
    }, [clients, appointments]);

    const handleExport = (clientList: Client[], filename: string) => {
        const headers = ['Name', 'Email', 'Phone', 'Lifetime Value', 'Last Seen'];
        const clientData = clientList.map(client => [
          client.name,
          client.email,
          client.phone,
          client.lifetimeValue.toString(),
          format(new Date(client.lastAppointment), 'yyyy-MM-dd')
        ]);

        const csvContent = [
          headers.join(','),
          ...clientData.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const lifecycleChartData = [
        { name: 'New', value: reportData.clientLifecycle.newClients, fill: 'var(--color-newClients)' },
        { name: 'Returning', value: reportData.clientLifecycle.returningClients, fill: 'var(--color-returningClients)' },
        { name: 'At Risk', value: reportData.clientLifecycle.atRiskClients, fill: 'var(--color-atRiskClients)' },
    ];
    
    const lifecycleChartConfig = {
        newClients: { label: 'New', color: 'hsl(var(--chart-3))' },
        returningClients: { label: 'Returning', color: 'hsl(var(--chart-1))' },
        atRiskClients: { label: 'At Risk', color: 'hsl(var(--chart-5))' },
    };

    const handlePrint = () => {
        window.print();
    }

    return (
        <div className="flex min-h-screen w-full flex-col print:bg-white">
            <AppHeader title="Client Log Report" />
            <main className="flex-1 p-4 md:p-8 space-y-6">
                <div className="flex items-center justify-between print:hidden">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/clients">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Client Log
                        </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print Report
                    </Button>
                </div>

                <div id="print-area" className="max-w-4xl mx-auto bg-card p-8 rounded-lg shadow-sm print:shadow-none print:p-0">
                    <div className="flex justify-between items-center mb-8">
                        <h1 className="text-3xl font-bold">Client Log Report</h1>
                        <div className="text-sm text-muted-foreground text-right">
                             <p>Report Generated:</p>
                             <p>{format(new Date(), 'MMM d, yyyy')}</p>
                         </div>
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 mb-8">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Active Clients</CardTitle>
                                <Users className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{reportData.totalActiveClients}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">New Clients (This Month)</CardTitle>
                                <UserPlus className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">+{reportData.newClientsThisMonth}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Client Retention Rate</CardTitle>
                                <Repeat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{reportData.retentionRate.toFixed(0)}%</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Average LTV</CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">${reportData.averageLTV.toFixed(2)}</div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
                         <Card id="lifecycle-chart-card">
                            <CardHeader>
                                <CardTitle>Client Lifecycle Breakdown</CardTitle>
                                <CardDescription>A snapshot of your client base by engagement.</CardDescription>
                            </CardHeader>
                            <CardContent className="print:flex print:flex-col print:items-center">
                                 <ChartContainer 
                                    config={lifecycleChartConfig} 
                                    className="mx-auto aspect-square h-[250px] print:h-[200px] print:w-[200px]"
                                >
                                    <PieChart>
                                        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                                        <Pie data={lifecycleChartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5}>
                                            {lifecycleChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ChartContainer>
                                <div className="flex items-center justify-center gap-4 text-sm mt-4">
                                    {Object.entries(lifecycleChartConfig).map(([key, config]) => (
                                        <div key={key} className="flex items-center gap-1.5">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{ backgroundColor: config.color }}
                                            />
                                            <span>{config.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="lg:col-span-2 print:col-span-2">
                            <CardHeader>
                                <CardTitle>Client Segments</CardTitle>
                                <CardDescription>Grouped lists of your most important client segments.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Tabs defaultValue="vip">
                                    <TabsList className="grid w-full grid-cols-3 print:hidden">
                                        <TabsTrigger value="vip"><Crown className="w-4 h-4 mr-2" />VIPs</TabsTrigger>
                                        <TabsTrigger value="new"><UserCheck className="w-4 h-4 mr-2" />New</TabsTrigger>
                                        <TabsTrigger value="at-risk"><UserX className="w-4 h-4 mr-2" />At Risk</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="vip" className="mt-4">
                                        <div className="flex justify-between items-center mb-4 print:hidden">
                                            <p className="text-sm text-muted-foreground">Your top 10% of clients by lifetime value.</p>
                                            <Button variant="outline" size="sm" onClick={() => handleExport(reportData.vipClients, 'vip-clients')}><Download className="w-4 h-4 mr-2"/>Export</Button>
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2 hidden print:block">VIP Clients</h3>
                                        <ClientList clients={reportData.vipClients} />
                                    </TabsContent>
                                    <TabsContent value="new" className="mt-4">
                                        <div className="flex justify-between items-center mb-4 print:hidden">
                                            <p className="text-sm text-muted-foreground">Clients who have only had one appointment.</p>
                                            <Button variant="outline" size="sm" onClick={() => handleExport(reportData.newClients, 'new-clients')}><Download className="w-4 h-4 mr-2"/>Export</Button>
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2 hidden print:block">New Clients</h3>
                                         <ClientList clients={reportData.newClients} />
                                    </TabsContent>
                                    <TabsContent value="at-risk" className="mt-4">
                                        <div className="flex justify-between items-center mb-4 print:hidden">
                                            <p className="text-sm text-muted-foreground">Clients not seen in the last 3 months.</p>
                                            <Button variant="outline" size="sm" onClick={() => handleExport(reportData.atRiskClients, 'at-risk-clients')}><Download className="w-4 h-4 mr-2"/>Export</Button>
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2 hidden print:block">At-Risk Clients</h3>
                                         <ClientList clients={reportData.atRiskClients} />
                                    </TabsContent>
                                </Tabs>
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-3 print:col-span-3">
                             <CardHeader>
                                <CardTitle>Leaderboards</CardTitle>
                            </CardHeader>
                            <CardContent className="grid gap-6 md:grid-cols-2">
                                <div>
                                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Crown className="w-4 h-4 text-amber-500" />Top 10 by Lifetime Value</h4>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Client</TableHead>
                                                <TableHead className="text-right">LTV</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reportData.top10Ltv.map(client => (
                                                <TableRow key={client.id}>
                                                    <TableCell className="font-medium">{client.name}</TableCell>
                                                    <TableCell className="text-right font-mono">${client.lifetimeValue.toFixed(2)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                                <div>
                                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Gift className="w-4 h-4 text-primary" />Top 5 Referrers</h4>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Referrer</TableHead>
                                                <TableHead className="text-right">Referrals</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reportData.topReferrers.map(referrer => (
                                                <TableRow key={referrer.name}>
                                                    <TableCell className="font-medium">{referrer.name}</TableCell>
                                                    <TableCell className="text-right">{referrer.count}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

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
                      #lifecycle-chart-card {
                        break-inside: avoid;
                      }
                    }
                `}</style>
            </main>
        </div>
    );
};

export default ClientLogReportPage;
