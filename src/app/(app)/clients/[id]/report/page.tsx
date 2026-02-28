'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { notFound, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, Sparkles, Loader, User, Calendar, DollarSign, AlertTriangle, FileText, FlaskConical, Gift, FileSignature } from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { generateClientReport } from '@/ai/flows/generate-client-report';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { Client, Appointment, Service } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirebase, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import Image from 'next/image';

const ClientReportPage = () => {
    const params = useParams<{ id: string }>();
    const { id: clientId } = params;
    const { firestore, isUserLoading } = useFirebase();
    const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
    const tenantId = selectedTenant?.id;
    
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';

    const [aiSummary, setAiSummary] = useState<{ summary: string; talkingPoints: string[] } | null>(null);
    const [isLoadingAi, setIsLoadingAi] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [generationDate, setGenerationDate] = useState<Date | null>(null);

    const clientsQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId) return null;
        return collection(firestore, `tenants/${tenantId}/clients`);
    }, [firestore, tenantId]);
    const { data: allClients, isLoading: clientLoading } = useCollection<Client>(clientsQuery);

    const client = useMemo(() => allClients?.find(c => c.id === clientId), [allClients, clientId]);
    
    const appointmentsQuery = useMemoFirebase(() => {
        if (!firestore || !clientId || !tenantId) return null;
        return query(collection(firestore, `tenants/${tenantId}/appointments`), where('clientId', '==', clientId));
    }, [firestore, tenantId, clientId]);
    const { data: appointments, isLoading: appointmentsLoading } = useCollection<Appointment>(appointmentsQuery);

    const servicesQuery = useMemoFirebase(() => {
        if (!firestore || !tenantId) return null;
        return collection(firestore, `tenants/${tenantId}/services`);
    }, [firestore, tenantId]);
    const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);

    const signedConsentsQuery = useMemoFirebase(() => {
        if (!firestore || !clientId || !tenantId) return null;
        return collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`);
    }, [firestore, tenantId, clientId]);
    const { data: signedConsents, isLoading: signedConsentsLoading } = useCollection<any>(signedConsentsQuery);

    const clientAppointments = useMemo(() => {
        if (!appointments) return [];
        return [...appointments].sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }, [appointments]);

    useEffect(() => {
        if (client) {
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
            const firstAppointment = clientAppointments.length > 0 ? new Date(clientAppointments[clientAppointments.length - 1].startTime) : new Date();

            const report = await generateClientReport({
                clientName: client.name,
                totalAppointments: clientAppointments.filter(a => a.status === 'completed').length,
                lifetimeValue: safeLTV,
                lastSeen: client.lastAppointment ? formatDistanceToNow(new Date(client.lastAppointment), { addSuffix: true }) : 'N/A',
                memberSince: format(new Date(firstAppointment), 'MMMM yyyy'),
                hasIncidents: !!client.intel?.hasIncidents,
                hasAllergies: !!client.allergyNotes,
                hasMedicalNotes: !!client.medicalNotes,
                clientNotes: JSON.stringify(client.notes)
            });
            setAiSummary(report);
        } catch (error: any) {
            console.error("Failed to generate AI report:", error);
            setAiError("Failed to generate summary. You may have exceeded your API quota. Please try again later.");
        } finally {
            setIsLoadingAi(false);
        }
    };
    
    const isPageLoading = isUserLoading || isTenantLoading || clientLoading || appointmentsLoading || servicesLoading || signedConsentsLoading;

    if (isPageLoading && !client) {
      return (
        <div className="flex min-h-screen w-full flex-col bg-muted/40">
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
            <main className="flex-1 p-4 md:p-8 space-y-6">
                <div className="flex items-center justify-between print:hidden">
                    <Button variant="outline" size="sm" asChild>
                        <Link href={`/clients/${client.id}`}>
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Profile
                        </Link>
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handlePrint}>
                            <Printer className="h-4 w-4 mr-2" />
                            Print Report
                        </Button>
                    </div>
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
                                <div className="flex justify-between"><span>Avg. Spend/Apt:</span> <span className="font-semibold">${(clientAppointments.length > 0 ? safeLTV / clientAppointments.length : 0).toFixed(2)}</span></div>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><Calendar/>Activity</CardTitle></CardHeader>
                            <CardContent className="space-y-1 text-sm">
                                <div className="flex justify-between"><span>Total Appointments:</span> <span className="font-semibold">{clientAppointments.length}</span></div>
                                <div className="flex justify-between"><span>Last Seen:</span> <span className="font-semibold">{client.lastAppointment ? formatDistanceToNow(new Date(client.lastAppointment), { addSuffix: true }) : 'N/A'}</span></div>
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
                                {clientAppointments.slice(0, 10).map((apt, index) => {
                                    const service = services?.find(s => s.id === apt.serviceId);
                                    const total = (apt.revenue || service?.price || 0) + (apt.tipAmount || 0);
                                    return (
                                        <div key={apt.id} className={`p-4 ${index < 9 ? 'border-b' : ''}`}>
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="font-semibold">{service?.name || 'Unknown Service'}</p>
                                                    <p className="text-sm text-muted-foreground">{format(new Date(apt.startTime), 'MMMM d, yyyy')}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-lg">${total.toFixed(2)}</p>
                                                    <Badge
                                                        variant="secondary"
                                                        className={cn(
                                                            'capitalize text-[10px]',
                                                            statusConfig[apt.status as keyof typeof statusConfig] || 'bg-gray-100 text-gray-800'
                                                        )}
                                                        >
                                                        {apt.status.replace('_', ' ')}
                                                    </Badge>
                                                </div>
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
                                    <Card key={index}>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="w-4 h-4 text-primary"/>{formula.name}</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {formula.items.map((item, itemIndex) => (
                                                <div key={itemIndex} className="text-sm p-2 bg-muted/50 rounded-md">
                                                    <p>{item.quantityUsed}{item.unit} {item.productName}</p>
                                                    {item.note && <p className="text-xs text-muted-foreground pl-4">&ndash; {item.note}</p>}
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                ))}
                                {(!client.customFormulas || client.customFormulas.length === 0) && <p className="text-center text-muted-foreground">No custom formulas saved.</p>}
                            </div>
                        </div>

                        <div>
                            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><FileSignature className="w-5 h-5"/> Signed Forms</h2>
                            <div className="space-y-4">
                                {signedConsents && signedConsents.length > 0 ? (
                                    signedConsents.map((consent: any) => (
                                        <Card key={consent.id} className="bg-muted/30">
                                            <CardHeader className="pb-2">
                                                <div className="flex justify-between items-center">
                                                    <CardTitle className="text-base">{consent.formTitle}</CardTitle>
                                                    <p className="text-xs text-muted-foreground">Signed {format(parseISO(consent.signedAt), 'PPP p')}</p>
                                                </div>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 pt-2">
                                                    {Object.entries(consent.formData || {}).map(([key, value]: [string, any]) => {
                                                        if (typeof value === 'string' && value.startsWith('data:image')) return null; // Signature handled separately
                                                        return (
                                                            <div key={key} className="space-y-1">
                                                                <p className="text-[10px] uppercase font-bold text-muted-foreground">{key.replace(/-/g, ' ')}</p>
                                                                <p className="text-sm">{Array.isArray(value) ? value.join(', ') : String(value)}</p>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                                {/* Find signature if it exists */}
                                                {Object.values(consent.formData || {}).map((value: any, idx) => {
                                                    if (typeof value === 'string' && value.startsWith('data:image')) {
                                                        return (
                                                            <div key={idx} className="mt-6 pt-4 border-t border-dashed">
                                                                <p className="text-[10px] uppercase font-bold text-muted-foreground mb-2">Digital Signature</p>
                                                                <div className="relative w-40 h-20 bg-white border rounded p-1">
                                                                    <Image src={value} alt="Signature" fill className="object-contain" />
                                                                </div>
                                                            </div>
                                                        )
                                                    }
                                                    return null;
                                                })}
                                            </CardContent>
                                        </Card>
                                    ))
                                ) : <p className="text-center text-muted-foreground py-4">No signed forms on record.</p>}
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
