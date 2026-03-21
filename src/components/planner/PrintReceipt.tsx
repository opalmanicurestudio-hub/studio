
'use client';

import React from 'react';
import { format } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { safeNumber } from '@/lib/utils';

export interface ReceiptData {
  business: {
    name: string;
    phone: string;
  };
  clientName: string;
  date: Date;
  items: {
    name: string;
    quantity: number;
    price: number;
    isDiscount?: boolean;
  }[];
  adjustments?: {
    description: string;
    cost: number;
  }[];
  subtotal: number;
  discount?: number;
  tax: number;
  tip: number;
  total: number;
  payment: {
    method: string;
    amountTendered: number;
    changeDue: number;
  };
  redeemedOffer?: {
    itemName: string;
    sessionsRemaining?: number;
    offeringName?: string;
  };
}

interface PrintReceiptProps {
  data: ReceiptData;
}

export const PrintReceipt: React.FC<PrintReceiptProps> = ({ data }) => {
  // Ensure data.date is a valid Date object before formatting
  const validDate = data.date instanceof Date ? data.date : new Date(data.date);

  return (
    <div className="p-4 bg-white text-black font-mono text-sm max-w-sm mx-auto">
      <style>{`
        @media print {
          body {
            background-color: #fff;
          }
          .print-content {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            border-radius: 0 !important;
          }
          .print-content > *:not(#receipt-area) {
            display: none !important;
          }
          #receipt-area {
            display: block !important;
          }
        }
      `}</style>
      <div className="text-center space-y-1 mb-6">
        <h1 className="text-xl font-bold">{data.business.name}</h1>
        <p>{data.business.phone}</p>
        <p>{format(validDate, 'MMM d, yyyy h:mm a')}</p>
      </div>

      <div className="mb-4">
        <p>
          <span className="font-semibold">Client:</span> {data.clientName}
        </p>
      </div>

      <Separator className="my-2 border-dashed border-black" />

      <div className="space-y-2">
        {data.items.map((item, index) => (
          <div key={index} className="flex justify-between">
            <div>
              <p>{item.name}</p>
              {item.quantity > 1 && <p className="pl-4 text-xs">({item.quantity} @ ${item.price.toFixed(2)})</p>}
            </div>
            <p>${(item.quantity * item.price).toFixed(2)}</p>
          </div>
        ))}
      </div>

      {data.adjustments && data.adjustments.length > 0 && (
          <>
            <Separator className="my-2 border-dashed border-black" />
            <div className="space-y-1">
                <p className="font-semibold">Adjustments:</p>
                {data.adjustments.map((adj, index) => (
                    <div key={index} className="flex justify-between pl-2 text-xs">
                        <p className="text-gray-600 uppercase font-black">{adj.description}</p>
                        <p className="font-mono text-gray-600">+${safeNumber(adj.cost).toFixed(2)}</p>
                    </div>
                ))}
            </div>
          </>
      )}

      <Separator className="my-2 border-dashed border-black" />

      {data.redeemedOffer && (
        <div className="my-4 text-xs space-y-1 p-2 bg-gray-100 rounded-md">
            <p className="font-semibold">{data.redeemedOffer.itemName} (Redeemed)</p>
            {data.redeemedOffer.offeringName && (
                <p className="text-gray-600">From: {data.redeemedOffer.offeringName}</p>
            )}
            {typeof data.redeemedOffer.sessionsRemaining === 'number' && (
                 <p className="text-gray-600 font-bold">{data.redeemedOffer.sessionsRemaining} sessions remaining</p>
            )}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex justify-between">
          <p>Subtotal</p>
          <p>${data.subtotal.toFixed(2)}</p>
        </div>
        {data.discount && data.discount > 0 && (
            <div className="flex justify-between">
                <p>Discount</p>
                <p>-${data.discount.toFixed(2)}</p>
            </div>
        )}
        <div className="flex justify-between">
          <p>Tax</p>
          <p>${data.tax.toFixed(2)}</p>
        </div>
        {data.tip > 0 && (
            <div className="flex justify-between">
                <p>Tip</p>
                <p>${data.tip.toFixed(2)}</p>
            </div>
        )}
        <div className="flex justify-between font-bold text-base">
          <p>Total</p>
          <p>${data.total.toFixed(2)}</p>
        </div>
      </div>

      <Separator className="my-2 border-dashed border-black" />

      <div className="space-y-1">
        <div className="flex justify-between">
          <p>Payment Method</p>
          <p>{data.payment.method}</p>
        </div>
        {data.payment.method === 'Cash' && (
            <>
                <div className="flex justify-between">
                <p>Amount Tendered</p>
                <p>${data.payment.amountTendered.toFixed(2)}</p>
                </div>
                <div className="flex justify-between">
                <p>Change Due</p>
                <p>${data.payment.changeDue.toFixed(2)}</p>
                </div>
            </>
        )}
      </div>

      <div className="text-center mt-8">
        <p>Thank you for your business!</p>
      </div>
    </div>
  );
};
