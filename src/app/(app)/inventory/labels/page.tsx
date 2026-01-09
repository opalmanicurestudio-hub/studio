
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Printer, Download, Search } from 'lucide-react';
import Link from 'next/link';
import { inventory as allProducts, type InventoryItem } from '@/lib/data';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface LabelContentOptions {
  showProductName: boolean;
  showPrice: boolean;
  showQRCode: boolean;
  showSKU: boolean;
}

const CustomizationSidebar = ({
  selectedProducts,
  onProductSelect,
  labelContent,
  onLabelContentChange,
}: {
  selectedProducts: Set<string>;
  onProductSelect: (productId: string) => void;
  labelContent: LabelContentOptions;
  onLabelContentChange: (options: LabelContentOptions) => void;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredProducts = useMemo(() => 
    allProducts.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [searchTerm]
  );

  return (
    <Card className="lg:sticky top-24">
      <CardHeader>
        <CardTitle>Customize Labels</CardTitle>
        <CardDescription>Select products and label content.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Products</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search products..." 
              className="pl-8" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <ScrollArea className="h-48 border rounded-md p-2">
             {filteredProducts.map(product => (
                <div key={product.id} className="flex items-center space-x-2 p-1.5 rounded-md hover:bg-muted">
                  <Checkbox 
                    id={`product-${product.id}`} 
                    checked={selectedProducts.has(product.id)}
                    onCheckedChange={() => onProductSelect(product.id)}
                  />
                  <Label htmlFor={`product-${product.id}`} className="text-sm font-normal flex-1 cursor-pointer">
                    {product.name}
                  </Label>
                </div>
              ))}
          </ScrollArea>
        </div>
        <div className="space-y-4">
          <Label>Label Content</Label>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="show-product-name" 
                checked={labelContent.showProductName}
                onCheckedChange={(checked) => onLabelContentChange({...labelContent, showProductName: !!checked})}
              />
              <Label htmlFor="show-product-name">Show Product Name</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="show-price" 
                checked={labelContent.showPrice}
                onCheckedChange={(checked) => onLabelContentChange({...labelContent, showPrice: !!checked})}
              />
              <Label htmlFor="show-price">Show Price</Label>
            </div>
             <div className="flex items-center space-x-2">
              <Checkbox 
                id="show-sku" 
                checked={labelContent.showSKU}
                onCheckedChange={(checked) => onLabelContentChange({...labelContent, showSKU: !!checked})}
              />
              <Label htmlFor="show-sku">Show SKU / Barcode</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="show-qr-code" 
                checked={labelContent.showQRCode}
                onCheckedChange={(checked) => onLabelContentChange({...labelContent, showQRCode: !!checked})}
              />
              <Label htmlFor="show-qr-code">Show QR Code</Label>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const GeneratedLabel = ({ product, options }: { product: InventoryItem, options: LabelContentOptions }) => {
    const price = useMemo(() => {
        const retailBatch = product.batches.find(b => b.costPerUnit > 0);
        return retailBatch ? retailBatch.costPerUnit * 1.5 : undefined; // Mocked-up MSRP for demo
    }, [product]);

    return (
        <div className="p-2 border border-dashed border-gray-400 text-center flex flex-col items-center justify-center break-words text-[8px] leading-tight">
            {options.showProductName && <p className="font-bold text-[9px] mb-1">{product.name}</p>}
            {options.showPrice && price && <p className="mb-1 font-mono">${price.toFixed(2)}</p>}
            {options.showSKU && <p className="font-mono text-[7px] mb-1">SKU: {product.id.slice(-6)}</p>}
            {options.showQRCode && (
                 <Image
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`clarityflow://product/${product.id}`)}`}
                    alt={`QR code for ${product.name}`}
                    width={50}
                    height={50}
                    className="object-contain"
                />
            )}
        </div>
    )
}

const PrintPreview = ({
  selectedProductIds,
  labelContent,
}: {
  selectedProductIds: Set<string>;
  labelContent: LabelContentOptions;
}) => {
  const selectedProducts = useMemo(() => 
    allProducts.filter(p => selectedProductIds.has(p.id)),
    [selectedProductIds]
  );
  
  const labelsToRender = useMemo(() => {
    // Standard US Letter Avery 5160 labels (30 per sheet)
    const labels = Array(30).fill(null);
    let currentProductIndex = 0;
    for (let i = 0; i < 30; i++) {
        if (selectedProducts.length > 0) {
            labels[i] = selectedProducts[currentProductIndex];
            currentProductIndex = (currentProductIndex + 1) % selectedProducts.length;
        }
    }
    return labels;
  }, [selectedProducts]);
  

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sheet Preview</CardTitle>
        <CardDescription>Real-time preview of a standard label sheet.</CardDescription>
      </CardHeader>
      <CardContent className="bg-muted/50 rounded-md p-4">
        {selectedProducts.length > 0 ? (
            <div id="label-sheet" className="grid grid-cols-3 gap-x-2 gap-y-0 p-4 bg-white shadow-lg aspect-[8.5/11]">
                 {labelsToRender.map((product, index) => (
                    product ? <GeneratedLabel key={`${product.id}-${index}`} product={product} options={labelContent} /> : <div key={index} className="border border-dashed border-gray-400"></div>
                 ))}
            </div>
        ) : (
             <div className="h-[600px] flex items-center justify-center">
                <p className="text-muted-foreground">Select products to see a preview.</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
};

export default function LabelPage() {
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [labelContent, setLabelContent] = useState<LabelContentOptions>({
    showProductName: true,
    showPrice: true,
    showQRCode: true,
    showSKU: false,
  });
  const { toast } = useToast();

  const handleProductSelect = (productId: string) => {
    const newSelection = new Set(selectedProducts);
    if (newSelection.has(productId)) {
        newSelection.delete(productId);
    } else {
        newSelection.add(productId);
    }
    setSelectedProducts(newSelection);
  }
  
  const handlePrint = () => {
    if (selectedProducts.size === 0) {
        toast({
            variant: 'destructive',
            title: "No Products Selected",
            description: "Please select at least one product to print labels for."
        });
        return;
    }
    window.print();
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Print Labels" />
      <main className="flex-1 p-4 md:p-8" id="main-content">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              <Button variant="outline" asChild className="print:hidden">
                <Link href="/inventory">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Inventory
                </Link>
              </Button>
              <h1 className="text-3xl font-bold">Print Labels</h1>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
              <Button onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" /> Print Labels
              </Button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-1 print:hidden">
              <CustomizationSidebar
                selectedProducts={selectedProducts}
                onProductSelect={handleProductSelect}
                labelContent={labelContent}
                onLabelContentChange={setLabelContent}
              />
            </div>
            <div className="lg:col-span-2">
              <PrintPreview selectedProductIds={selectedProducts} labelContent={labelContent} />
            </div>
          </div>
        </div>
      </main>
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #label-sheet, #label-sheet * {
            visibility: visible;
          }
          #label-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            transform: scale(1);
          }
          @page {
            size: letter;
            margin: 0.5in;
          }
        }
      `}</style>
    </div>
  );
}
