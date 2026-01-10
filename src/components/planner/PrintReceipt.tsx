
'use client';

import React from 'react';
import { format } from 'date-fns';
import { Separator } from '@/components/ui/separator';

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
  }[];
  subtotal: number;
  tax: number;
  total: number;
  payment: {
    method: string;
    amountTendered: number;
    changeDue: number;
  };
}

interface PrintReceiptProps {
  data: ReceiptData;
}

export const PrintReceipt: React.FC<PrintReceiptProps> = ({ data }) => {
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
        <p>{format(data.date, 'MMM d, yyyy h:mm a')}</p>
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

      <Separator className="my-2 border-dashed border-black" />

      <div className="space-y-1">
        <div className="flex justify-between">
          <p>Subtotal</p>
          <p>${data.subtotal.toFixed(2)}</p>
        </div>
        <div className="flex justify-between">
          <p>Tax</p>
          <p>${data.tax.toFixed(2)}</p>
        </div>
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
        <div className="flex justify-between">
          <p>Amount Tendered</p>
          <p>${data.payment.amountTendered.toFixed(2)}</p>
        </div>
        <div className="flex justify-between">
          <p>Change Due</p>
          <p>${data.payment.changeDue.toFixed(2)}</p>
        </div>
      </div>

      <div className="text-center mt-8">
        <p>Thank you for your business!</p>
      </div>
    </div>
  );
};
