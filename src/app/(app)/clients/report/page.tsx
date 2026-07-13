'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { notFound, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, Sparkles, Loader, User, Calendar, DollarSign, AlertTriangle, FileText, FlaskConical, Gift } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { format, formatDistanceToNow } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { generateClientReport } from '@/ai/flows/generate-client-report';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { Client, Appointment, Service } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ClientOnly } from '@/components/shared/ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { canSeeFinancials } from '@/lib/privacy';

const ClientReportPage = () => {
    const params = useParams<{ id: string }>();
    const { clients, appointments, services } = useInventory();
    const { role, selectedTenant } = useTenant();
    const showFinancials = canSeeFinancials(selectedTenant, role);
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';

    const [aiSummary, setAiSummary] = useState<{ summary: string; talkingPoints: string[] } | null>(null);
    const [isPageLoading, setIsPageLoading] = useState(true);
    const [isLoadingAi, setIsLoadingAi] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [generationDate, setGenerationDate] = useState<Date | null>(null);

    const client = useMemo(() => clients.find((c) => c.id === params.id), [clients, params.id]);
    
    const clientAppointments = useMemo(() => {
        if (!client) return [];
        return appointments
            .filter(apt => apt.clientId === client.id)
            .sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }, [client, appointments]);

    useEffect(() => {
        if (client) {
            setIsPageLoading(false);
            setGenerationDate(new Date());
        }
    }, [client]);

    const safeLTV = useMemo(() => {
        const val = Number(client?.lifetimeValue);
        return isNaN(val) ? 0 : val;
    }, [client?.lifetimeValue]);

    const handleGenerateReport = async () => {
        if (!client) return;

        setIsLoadingAi(true);
        setAiError(null);
        setAiSummary(null);

        try {
            const firstAppointment = clientAppointments.length > 0 ? clientAppointments[clientAppointments.length - 1].startTime : new Date();

            const report = await generateClientReport({
                clientName: client.name,
                totalAppointments: clientAppointments.filter(a => a.status === 'completed').length,
                lifetimeValue: safeLTV,
                lastSeen: formatDistanceToNow(new Date(client.lastAppointment), { addSuffix: true }),
                memberSince: format(new Date(firstAppointment), 'MMMM yyyy'),
                hasIncidents: !!client.intel?.hasIncidents,
                hasAllergies: !!client.allergyNotes,
                hasMedicalNotes: !!client.medicalNotes,
                clientNotes: JSON.stringify(client.notes),
            });
            setAiSummary(report);
        } catch (error: any) {
            console.error("Failed to generate AI report:", error);
            setAiError("Failed to generate summary. You may have exceeded your API quota. Please try again later.");
        } finally {
            setIsLoadingAi(false);
        }
    };

    if (isPageLoading) {
      return (
        <div className="flex h-screen w-full flex-col bg-muted/40">
          <AppHeader title="Client Report" />
          <main className="flex-1 p-4 md:p-8 flex justify-center items-center">
            <Loader className="h-8 w-8 animate-spin" />
          </main>
        </div>
      );
    }

    if (!client) {
        return notFound();
    }

    // v43 — this entire page is a per-client financial report; it gates
    // as a whole through the single source of truth.
    if (!showFinancials) {
        return (
            <div className="flex h-screen w-full flex-col bg-muted/40">
                <AppHeader title="Client Report" />
                <main className="flex-1 p-4 md:p-8 flex justify-center items-center">
                    <div className="text-center space-y-2">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Financial reports are visible to admins only</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Ask the owner to change this in Settings → Staff Data Visibility</p>
                    </div>
                </main>
            </div>
        );
    }
    
    const handlePrint = () => {
        window.print();
    };

    const statusConfig = {
        completed: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
        confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
        cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
        deposit_pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
    };

    return (
        <div className="flex min-h-screen w-full flex-col bg-muted/40 print:bg-white">
            <AppHeader title="Client Report" />
            <main className="flex-1 p-4 md:p-8 space-y-6 print:p-4">
                <div className="flex items-center justify-between print:hidden">
                    <Button variant="outline" size="sm" asChild>
                        <Link href={`/clients/${client.id}`}>
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Profile
                        </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print Report
                    </Button>
                </div>

                <div id="print-area" className="max-w-4xl mx-auto bg-card p-8 rounded-lg shadow-sm print:shadow-none print:p-0">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6 mb-8">
                        <Avatar className="w-24 h-24 text-xl border mx-auto sm:mx-0">
                            <AvatarImage src={client.avatarUrl} alt={client.name} />
                            <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        <div className="space-y-1 flex-1">
                            <h1 className="text-3xl font-bold">{client.name}</h1>
                            {isOwnerOrAdmin ? (
                                <>
                                    <p className="text-muted-foreground">{client.email}</p>
                                    <p className="text-muted-foreground">{client.phone}</p>
                                </>
                            ) : (
                                <p className="text-sm text-muted-foreground italic">Contact info restricted.</p>
                            )}
                        </div>
                         <div className="text-sm text-muted-foreground text-center sm:text-right">
                             <p>Report Generated:</p>
                             {generationDate ? <p>{format(generationDate, 'MMM d, yyyy')}</p> : <Skeleton className="h-4 w-24"/>}
                         </div>
                    </div>
                    
                    <Card className="bg-primary/5 border-primary/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Sparkles className="h-5 w-5" /> AI-Powered Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isLoadingAi ? (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-5/6" />
                                    </div>
                                    <Separator />
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-1/2" />
                                        <Skeleton className="h-4 w-2/3" />
                                    </div>
                                </div>
                            ) : aiError ? (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Error Generating Report</AlertTitle>
                                    <AlertDescription>
                                        {aiError}
                                        <Button variant="link" onClick={handleGenerateReport} className="p-0 h-auto mt-2">Try Again</Button>
                                    </AlertDescription>
                                </Alert>
                            ) : aiSummary ? (
                                <>
                                    <p className="text-sm">{aiSummary.summary}</p>
                                    <Separator />
                                    <h4 className="font-semibold">Talking Points</h4>
                                    <ul className="list-disc list-inside space-y-1 text-sm">
                                        {aiSummary.talkingPoints.map((point, index) => (
                                            <li key={index}>{point}</li>
                                        ))}
                                    </ul>
                                    <Button variant="ghost" size="sm" onClick={handleGenerateReport} className="w-full mt-2">
                                        <Sparkles className="w-4 h-4 mr-2" /> Regenerate
                                    </Button>
                                </>
                            ) : (
                                <div className="text-center p-4">
                                    <p className="text-sm text-muted-foreground mb-4">Generate an AI summary and talking points for this client.</p>
                                    <Button onClick={handleGenerateReport}>
                                        <Sparkles className="w-4 h-4 mr-2" />
                                        Generate Report
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid md:grid-cols-3 gap-6 my-8">
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><DollarSign/>Financials</CardTitle></CardHeader>
                            <CardContent className="space-y-1 text-sm">
                                <div className="flex justify-between"><span>Lifetime Value:</span> <span className="font-semibold">${safeLTV.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span>Avg. Spend/Apt:</span> <span className="font-semibold">${(safeLTV / (clientAppointments.length || 1)).toFixed(2)}</span></div>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><Calendar/>Activity</CardTitle></CardHeader>
                            <CardContent className="space-y-1 text-sm">
                                <div className="flex justify-between"><span>Total Appointments:</span> <span className="font-semibold">{clientAppointments.length}</span></div>
                                <div className="flex justify-between"><span>Last Seen:</span> <span className="font-semibold">{formatDistanceToNow(new Date(client.lastAppointment), { addSuffix: true })}</span></div>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><AlertTriangle/>Alerts</CardTitle></CardHeader>
                            <CardContent className="space-y-1 text-sm">
                                <div className="flex justify-between"><span>Medical Notes:</span> <Badge variant={client.medicalNotes ? 'destructive' : 'secondary'}>{client.medicalNotes ? 'Yes' : 'No'}</Badge></div>
                                <div className="flex justify-between"><span>Allergies:</span> <Badge variant={client.allergyNotes ? 'destructive' : 'secondary'}>{client.allergyNotes ? 'Yes' : 'No'}</Badge></div>
                                <div className="flex justify-between"><span>Incidents:</span> <Badge variant={client.intel?.hasIncidents ? 'destructive' : 'secondary'}>{client.intel?.hasIncidents ? 'Yes' : 'No'}</Badge></div>
                            </CardContent>
                        </Card>
                    </div>
                    
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-xl font-semibold mb-4">Appointment History</h2>
                            <div className="border rounded-lg">
                                {clientAppointments.slice(0, 5).map((apt, index) => {
                                    const service = services.find(s => s.id === apt.serviceId);
                                    return (
                                        <div key={apt.id} className={`p-4 ${index < 4 ? 'border-b' : ''}`}>
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="font-semibold">{service?.name || 'Unknown Service'}</p>
                                                    <p className="text-sm text-muted-foreground">{format(new Date(apt.startTime), 'MMMM d, yyyy')}</p>
                                                </div>
                                                <Badge
                                                    variant="secondary"
                                                    className={cn(
                                                        'capitalize',
                                                        statusConfig[apt.status as keyof typeof statusConfig] || 'bg-gray-100 text-gray-800'
                                                    )}
                                                    >
                                                    {apt.status.replace('_', ' ')}
                                                </Badge>
                                            </div>
                                        </div>
                                    )
                                })}
                                {clientAppointments.length === 0 && <p className="p-4 text-center text-muted-foreground">No appointment history.</p>}
                            </div>
                        </div>

                        <div>
                            <h2 className="text-xl font-semibold mb-4">Saved Formulas</h2>
                            <div className="space-y-4">
                                {(client.customFormulas || []).map((formula, index) => (
                                    <Card key={index} className="bg-muted/30">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="w-4 h-4 text-primary"/>{formula.name}</CardTitle>
                                            <p className="text-xs text-muted-foreground">Established {format(parseISO(formula.date), 'PPP')}</p>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {formula.items.map((item, itemIndex) => (
                                                <div key={itemIndex} className="text-sm p-2 bg-white border rounded-md shadow-sm flex justify-between">
                                                    <p className="font-bold">{item.name}</p>
                                                    <p className="font-mono">{item.quantity}{item.unit}</p>
                                                </div>
                                            ))}
                                            {formula.notes && <p className="text-xs text-muted-foreground italic pt-2">"{formula.notes}"</p>}
                                        </CardContent>
                                    </Card>
                                ))}
                                {(!client.customFormulas || client.customFormulas.length === 0) && <p className="text-center text-muted-foreground py-4">No custom formulas archived.</p>}
                            </div>
                        </div>

                        <div>
                            <h2 className="text-xl font-semibold mb-4">Referrals &amp; Loyalty</h2>
                            <Card>
                                <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <div className="p-4 rounded-lg bg-muted/50">
                                            <div className="text-sm text-muted-foreground flex items-center gap-2"><Gift className="h-4 w-4"/>Wallet Balance</div>
                                            <div className="text-2xl font-bold text-primary">${(client.walletCredit || 0).toFixed(2)}</div>
                                        </div>
                                        <div className="p-4 rounded-lg bg-muted/50">
                                            <div className="text-sm text-muted-foreground">Referred By</div>
                                            <div className="text-lg font-semibold">{client.referredBy || 'N/A'}</div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <h4 className="font-medium">Successful Referrals ({client.successfulReferrals?.length || 0})</h4>
                                        {client.successfulReferrals && client.successfulReferrals.length > 0 ? (
                                            <div className="space-y-2 text-sm">
                                                {client.successfulReferrals.map((name, index) => (
                                                    <p key={index} className="p-2 bg-muted/50 rounded-md">{name}</p>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">No successful referrals yet.</p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
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
                      #lifecycle-chart-card > div {
                          display: flex !important;
                          justify-content: center !important;
                          flex-direction: column !important;
                          align-items: center !important;
                      }
                      #lifecycle-chart-card .recharts-responsive-container {
                          width: 200px !important;
                          height: 200px !important;
                      }
                    }
                `}</style>
            </main>
        </div>
    );
}

export default ClientReportPage;
