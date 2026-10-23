
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { notFound, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, Sparkles, Loader, User, Calendar, DollarSign, AlertTriangle, FileText, FlaskConical, Gift, FileSignature, MessageSquare } from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { generateClientReport } from '@/ai/flows/generate-client-report';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { Client, Appointment, Service } from '@/lib/data';
import { cn, safeNumber } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirebase, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { logHealthOpen } from '@/lib/health-view-client';
import Image from 'next/image';

// What reaches paper, in the app's print look (lib/print-style): Plus Jakarta Sans, a light name, sentence-case grey
// labels, soft panels, thin #ececee lines, soft status pills, tabular figures. Scoped to #print-area and to print only,
// so the screen is untouched; the id selectors outrank the global print rules that keep app screens uppercase and heavy.
const PAPER_CSS = `
@media print {
  @page { margin: 0.55in; }
  #print-area { font-family: 'Plus Jakarta Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #16171a; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #print-area * { color: inherit !important; background-color: transparent !important; border-color: #ececee !important; box-shadow: none !important; text-shadow: none !important; text-transform: none !important; letter-spacing: normal !important; opacity: 1 !important; font-variant-numeric: tabular-nums; }
  #print-area svg, #print-area button { display: none !important; }
  #print-area .capitalize { text-transform: capitalize !important; }
  #print-area .font-mono { font-family: inherit !important; font-weight: 400 !important; }
  #print-area .font-bold, #print-area .font-semibold, #print-area .font-medium { font-weight: 500 !important; }
  #print-area .font-black, #print-area .font-extrabold, #print-area h2[class], #print-area h4[class] { font-weight: 600 !important; }
  #print-area .text-muted-foreground { color: #6d7075 !important; }
  #print-area .text-sm, #print-area .text-base { font-size: 12.5px !important; }
  #print-area .text-xs { font-size: 11px !important; }
  #print-area .text-lg { font-size: 13px !important; }
  #print-area .text-2xl { font-size: 20px !important; font-weight: 300 !important; letter-spacing: -0.01em !important; }
  #print-area .border-2 { border-width: 1px !important; }
  #print-area .rounded-lg { border-radius: 14px !important; }
  #print-area .rounded-md { border-radius: 10px !important; }
  #print-area .bg-border { background-color: #ececee !important; }
  #print-area [class~="bg-muted/50"], #print-area [class~="bg-muted/30"], #print-area [class~="bg-muted"] { background-color: #f5f5f7 !important; border-color: transparent !important; }
  #print-area [class~="bg-card"] { background-color: #fff !important; }
  #print-area h2 { margin: 22px 0 8px !important; font-size: 13px !important; }

  #print-area .rp-head { align-items: flex-start !important; text-align: left !important; gap: 16px !important; margin-bottom: 18px !important; padding-bottom: 14px; border-bottom: 1px solid #ececee; }
  #print-area .rp-head > :first-child { width: 56px !important; height: 56px !important; margin: 0 !important; font-size: 15px !important; }
  #print-area .rp-head h1 { margin: 0; font-size: 26px !important; font-weight: 300 !important; letter-spacing: -0.02em !important; line-height: 1.15; }
  #print-area .rp-head > :last-child { font-size: 11px !important; color: #6d7075 !important; text-align: right !important; }

  #print-area .rp-summary { background-color: #f5f5f7 !important; border: 0 !important; border-radius: 14px !important; padding: 12px 14px !important; break-inside: avoid; }
  #print-area .rp-summary > div { padding: 0 !important; }
  #print-area .rp-summary > div:first-child { padding-bottom: 6px !important; }
  #print-area .rp-summary > div:first-child > * { font-size: 13px !important; font-weight: 600 !important; line-height: 1.3 !important; }
  #print-area .rp-summary p, #print-area .rp-summary li { color: #45474c !important; }

  #print-area .rp-three { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 10px !important; margin: 18px 0 !important; }
  #print-area .rp-three > div { border-radius: 14px !important; padding: 12px 14px !important; break-inside: avoid; }
  #print-area .rp-three > div > div { padding: 0 !important; }
  #print-area .rp-three > div > div:first-child { padding-bottom: 6px !important; }
  #print-area .rp-three > div > div:first-child > * { font-size: 13px !important; font-weight: 600 !important; }

  #print-area .rp-list > div { padding: 8px 12px !important; break-inside: avoid; }
  #print-area .rp-two { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 16px !important; padding: 14px !important; }
  #print-area .rp-two .rounded-lg { padding: 10px 12px !important; }
  #print-area .rp-two .rounded-md { padding: 6px 10px !important; }
  #print-area .rp-key { font-size: 11px !important; font-weight: 500 !important; }
  #print-area .rp-key::first-letter { text-transform: uppercase; }

  #print-area [class~="rounded-full"][class~="px-2.5"] { display: inline-flex; padding: 2px 8px !important; border: 0 !important; border-radius: 999px !important; background-color: #f5f5f7 !important; color: #45474c !important; font-size: 10.5px !important; font-weight: 500 !important; line-height: 1.5 !important; }
  #print-area [class~="px-2.5"][class~="bg-destructive"], #print-area [class~="px-2.5"][class~="bg-yellow-100"] { background-color: #fdf3e7 !important; color: #b45309 !important; }
  #print-area [class~="px-2.5"][class~="bg-green-100"] { background-color: #eaf6ef !important; color: #1f7a4d !important; }
}
`;

const ClientReportPage = () => {
    const params = useParams<{ id: string }>();
    const { id: clientId } = params;
    const { firestore, isUserLoading } = useFirebase();
    const { selectedTenant, role, isLoading: isTenantLoading, can } = useTenant();
    const tenantId = selectedTenant?.id;
    
    const isOwnerOrAdmin = can('money.view');

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
    // Health information mode: this report shows every signed form's answers, so opening it is recorded (who, when).
    useEffect(() => { if (signedConsents && signedConsents.length > 0) logHealthOpen(selectedTenant, { clientId: String(clientId), what: 'Client report (form answers)' }); }, [signedConsents, selectedTenant, clientId]);

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
        <div className="flex min-h-screen w-full flex-col bg-background">
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
        <div className="flex min-h-screen w-full flex-col bg-background print:bg-card">
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
                    <div className="rp-head flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6 mb-8">
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
                    
                    <Card className={cn('rp-summary bg-primary/5 border-primary/20', !aiSummary && 'print:hidden')}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Sparkles className="h-5 w-5" /> Summary
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
                                    <p className="text-sm text-muted-foreground mb-4">Get a summary and talking points for this client.</p>
                                    <Button onClick={handleGenerateReport}>
                                        <Sparkles className="w-4 h-4 mr-2" />
                                        Generate Report
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="rp-three grid md:grid-cols-3 gap-6 my-8">
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
                            <div className="rp-list border rounded-lg">
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
                                                            statusConfig[apt.status as keyof typeof statusConfig] || 'bg-muted text-foreground'
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
                                                                <p className="rp-key text-[10px] uppercase font-bold text-muted-foreground">{key.replace(/-/g, ' ')}</p>
                                                                <p className="text-sm">{Array.isArray(value) ? value.join(', ') : String(value)}</p>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                                {Object.values(consent.formData || {}).map((value: any, idx) => {
                                                    if (typeof value === 'string' && value.startsWith('data:image')) {
                                                        return (
                                                            <div key={idx} className="mt-6 pt-4 border-t border-dashed">
                                                                <p className="rp-key text-[10px] uppercase font-bold text-muted-foreground mb-2">Digital Signature</p>
                                                                <div className="relative w-40 h-20 bg-card border rounded p-1">
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
                            <h2 className="text-xl font-semibold mb-4">Technical Formulas</h2>
                            <div className="space-y-4">
                                {(client.customFormulas || []).map((formula, index) => (
                                    <Card key={index} className="bg-muted/30">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="w-4 h-4 text-primary"/>{formula.name}</CardTitle>
                                            <p className="text-xs text-muted-foreground">Established {format(parseISO(formula.date), 'PPP')}</p>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {formula.items.map((item, itemIndex) => (
                                                <div key={itemIndex} className="text-sm p-3 bg-card border rounded-lg shadow-sm space-y-1.5">
                                                    <div className="flex justify-between items-center">
                                                        <p className="font-bold uppercase text-[11px]">{item.name}</p>
                                                        <p className="font-mono text-xs font-black">{item.quantity}{item.unit}</p>
                                                    </div>
                                                    {item.note && (
                                                        <div className="flex items-start gap-2 pt-1 border-t border-border">
                                                            <MessageSquare className="w-2.5 h-2.5 text-primary opacity-40 mt-0.5" />
                                                            <p className="text-[10px] font-medium text-muted-foreground italic leading-tight">"{item.note}"</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {formula.notes && <p className="text-xs text-muted-foreground italic pt-2 border-t border-dashed">"{formula.notes}"</p>}
                                        </CardContent>
                                    </Card>
                                ))}
                                {(!client.customFormulas || client.customFormulas.length === 0) && <p className="text-center text-muted-foreground py-4">No custom formulas archived.</p>}
                            </div>
                        </div>

                        <div>
                            <h2 className="text-xl font-semibold mb-4">Referrals &amp; Loyalty</h2>
                            <Card>
                                <CardContent className="rp-two p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
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
