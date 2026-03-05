'use client';

import React, { useState, useEffect } from 'react';
import { type Transaction } from '@/lib/financial-data';
import { type Staff } from '@/lib/data';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Paperclip } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface PrintableReportProps {
  transactions: Transaction[];
  staff: Staff[];
  financialSummary: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    operatingExpenses: number;
    net: number;
  };
  dateRange: DateRange | undefined;
}

export const PrintableReport = React.forwardRef<HTMLDivElement, PrintableReportProps>(({ transactions, staff, financialSummary, dateRange }, ref) => {
    const [generationDate, setGenerationDate] = useState<Date | null>(null);

    useEffect(() => {
        setGenerationDate(new Date());
    }, []);

    const transactionsWithReceipts = transactions
      .filter(t => t.hasReceipt && t.receiptUrl)
      .map((t, index) => ({ ...t, receiptIndex: index + 1 }));

    const receiptMap = new Map(transactionsWithReceipts.map(t => [t.id, t.receiptIndex]));

    return (
        <div ref={ref} className="p-8 bg-white text-black font-sans text-sm max-w-4xl mx-auto">
            <style jsx global>{`
                @media print {
                    @page {
                        size: A4;
                        margin: 1in;
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .break-before-page {
                        page-break-before: always;
                    }
                }
            `}</style>

            <header className="mb-8">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold">Transaction Report</h1>
                        <p className="text-gray-600">
                            {dateRange?.from ? format(dateRange.from, 'LLL d, yyyy') : 'Start'} - {dateRange?.to ? format(dateRange.to, 'LLL d, yyyy') : 'End'}
                        </p>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                        <p>Generated On:</p>
                        {generationDate && <p>{format(generationDate, 'LLL d, yyyy h:mm a')}</p>}
                    </div>
                </div>
            </header>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold border-b pb-2 mb-4">Financial Summary</h2>
                <table className="w-full text-left">
                    <tbody>
                        <tr className="border-b">
                            <td className="py-2 pr-4">Total Revenue</td>
                            <td className="py-2 text-right font-medium">${financialSummary.revenue.toFixed(2)}</td>
                        </tr>
                        <tr className="border-b">
                            <td className="py-2 pr-4">Cost of Goods Sold (COGS)</td>
                            <td className="py-2 text-right font-medium">(${financialSummary.cogs.toFixed(2)})</td>
                        </tr>
                        <tr className="border-b font-bold">
                            <td className="py-2 pr-4">Gross Profit</td>
                            <td className="py-2 text-right">${financialSummary.grossProfit.toFixed(2)}</td>
                        </tr>
                        <tr className="border-b">
                            <td className="py-2 pr-4">Operating Expenses</td>
                            <td className="py-2 text-right font-medium">(${financialSummary.operatingExpenses.toFixed(2)})</td>
                        </tr>
                        <tr className="bg-gray-100 font-bold text-lg">
                            <td className="py-3 px-4">Net Income</td>
                            <td className={cn("py-3 px-4 text-right", financialSummary.net >= 0 ? 'text-green-600' : 'text-red-600')}>
                                ${financialSummary.net.toFixed(2)}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section>
                <h2 className="text-2xl font-semibold border-b pb-2 mb-4">Transaction Details</h2>
                <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="py-2 px-3 text-left font-semibold">Date</th>
                            <th className="py-2 px-3 text-left font-semibold">Description</th>
                            <th className="py-2 px-3 text-left font-semibold">Staff</th>
                            <th className="py-2 px-3 text-left font-semibold">Category</th>
                            <th className="py-2 px-3 text-left font-semibold">Context</th>
                            <th className="py-2 px-3 text-right font-semibold">Amount</th>
                            <th className="py-2 px-3 text-center font-semibold">Receipt #</th>
                        </tr>
                    </thead>
                    <tbody>
                        {transactions.map(t => {
                            const staffMember = staff.find(s => s.id === t.staffId);
                            return (
                                <tr key={t.id} className={cn("border-b", t.type === 'expense' && 'bg-red-50')}>
                                    <td className="py-2 px-3">{format(new Date(t.date), 'MM/dd/yy')}</td>
                                    <td className="py-2 px-3">
                                        <div>{t.description}</div>
                                        <div className="text-xs text-gray-500">{t.clientOrVendor}</div>
                                    </td>
                                    <td className="py-2 px-3">
                                        <div className="flex items-center gap-2">
                                            {staffMember && (
                                                <Avatar className="h-6 w-6 border shadow-sm">
                                                    <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name || 'Staff'} />
                                                    <AvatarFallback className="text-[8px] font-black">{(staffMember.name || 'S').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                            )}
                                            <span>{staffMember?.name || 'System'}</span>
                                        </div>
                                    </td>
                                    <td className="py-2 px-3">{t.category}</td>
                                    <td className="py-2 px-3">{t.context}</td>
                                    <td className={cn('py-2 px-3 text-right font-mono', {
                                        'text-green-600': t.type === 'income',
                                        'text-red-600': t.type === 'expense',
                                    })}>
                                        {t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
                                    </td>
                                    <td className="py-2 px-3 text-center text-gray-500">
                                        {receiptMap.get(t.id) ? `#${receiptMap.get(t.id)}` : '—'}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </section>

             {transactionsWithReceipts.length > 0 && (
                <section className="break-before-page">
                    <h2 className="text-2xl font-semibold border-b pb-2 mb-4">Receipt Appendix</h2>
                    <div className="grid grid-cols-2 gap-8">
                        {transactionsWithReceipts.map(t => (
                            <figure key={t.id} className="border p-2">
                                {t.receiptUrl && (
                                     <div className="bg-gray-100 mb-2 relative aspect-[3/4]">
                                        <Image
                                            src={t.receiptUrl}
                                            alt={`Receipt for ${t.description}`}
                                            fill
                                            className="object-contain w-full"
                                        />
                                    </div>
                                )}
                                <figcaption className="text-xs space-y-1">
                                    <p className="font-bold">Receipt #{t.receiptIndex}</p>
                                    <p><strong>Description:</strong> {t.description}</p>
                                    <p><strong>Date:</strong> {format(new Date(t.date), 'MMM d, yyyy')}</p>
                                    <p><strong>Amount:</strong> ${t.amount.toFixed(2)}</p>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
});

PrintableReport.displayName = 'PrintableReport';
