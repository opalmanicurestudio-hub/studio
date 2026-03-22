
'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { ArrowLeft, Printer, Download, Search, Sheet, ChevronsUpDown, ImageIcon, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useInventory } from '@/context/InventoryContext';
import { type InventoryItem } from '@/lib/data';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';


interface LabelContentOptions {
  showProductName: boolean;
  showPrice: boolean;
  showQRCode: boolean;
  showSKU: boolean;
  useCustomImage: boolean;
}

const CustomizationSidebar = ({
  products,
  selectedProducts,
  onProductSelect,
  labelContent,
  onLabelContentChange,
  printMode,
  onPrintModeChange,
}: {
  products: InventoryItem[];
  selectedProducts: Set<string>;
  onProductSelect: (productId: string) => void;
  labelContent: LabelContentOptions;
  onLabelContentChange: (options: LabelContentOptions) => void;
  printMode: 'sheet' | 'single';
  onPrintModeChange: (mode: 'sheet' | 'single') => void;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredProducts = useMemo(() => 
    products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [searchTerm, products]
  );

  return (
    <Card className="lg:sticky top-24 border-2 rounded-[2rem] overflow-hidden shadow-sm bg-white">
      <CardHeader className="bg-muted/5 border-b p-6">
        <CardTitle className="text-sm font-black uppercase tracking-widest">Customize Labels</CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Select products, content, and print format.</CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-8">
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Print Format</Label>
                 <div className="flex items-center space-x-3">
                    <Sheet className="h-4 w-4 text-muted-foreground opacity-40" />
                    <Switch
                        checked={printMode === 'single'}
                        onCheckedChange={(checked) => onPrintModeChange(checked ? 'single' : 'sheet')}
                    />
                    <ChevronsUpDown className="h-4 w-4 text-primary" />
                 </div>
            </div>
            <div className="p-3 rounded-xl bg-muted/20 border-2 border-dashed text-[10px] font-bold uppercase text-slate-600 leading-relaxed">
                Mode: {printMode === 'sheet' ? 'Full Sheet (Avery 5160)' : 'Single Label (Thermal)'}.
            </div>
        </div>


        <div className="space-y-4">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Asset Registry</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
            <Input 
              placeholder="SEARCH ASSETS..." 
              className="pl-9 h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-muted/5 shadow-inner" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <ScrollArea className="h-48 border-2 rounded-2xl p-2 bg-background">
             <div className="space-y-1.5">
                {filteredProducts.map(product => (
                    <div key={product.id} className="flex items-center space-x-3 p-2 rounded-xl hover:bg-primary/5 transition-all">
                    <Checkbox 
                        id={`product-${product.id}`} 
                        checked={selectedProducts.has(product.id)}
                        onCheckedChange={() => onProductSelect(product.id)}
                        disabled={printMode === 'single' && selectedProducts.size > 0 && !selectedProducts.has(product.id)}
                        className="h-5 w-5 rounded-md border-2"
                    />
                    <Label htmlFor={`product-${product.id}`} className="text-[11px] font-black uppercase tracking-tight flex-1 cursor-pointer truncate">
                        {product.name}
                    </Label>
                    </div>
                ))}
             </div>
          </ScrollArea>
        </div>

        <div className="space-y-6">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Label Architecture</SectionHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-2xl border-2 bg-primary/5 border-primary/10 shadow-inner">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded-lg shadow-sm"><ImageIcon className="w-4 h-4 text-primary" /></div>
                    <Label htmlFor="use-custom-img" className="text-[11px] font-black uppercase tracking-tight cursor-pointer">Use Master Label Image</Label>
                </div>
                <Switch 
                    id="use-custom-img" 
                    checked={labelContent.useCustomImage}
                    onCheckedChange={(checked) => onLabelContentChange({...labelContent, useCustomImage: checked})}
                />
            </div>

            <AnimatePresence>
                {!labelContent.useCustomImage && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                        {[
                            { id: 'show-product-name', label: 'Display Name', field: 'showProductName' },
                            { id: 'show-price', label: 'Display Price', field: 'showPrice' },
                            { id: 'show-sku', label: 'Display SKU', field: 'showSKU' },
                            { id: 'show-qr-code', label: 'Display QR', field: 'showQRCode' },
                        ].map((opt) => (
                            <div key={opt.id} className="flex items-center justify-between p-3 rounded-xl border-2 bg-background">
                                <Label htmlFor={opt.id} className="text-[10px] font-black uppercase tracking-widest text-slate-600">{opt.label}</Label>
                                <Checkbox 
                                    id={opt.id} 
                                    checked={(labelContent as any)[opt.field]}
                                    onCheckedChange={(checked) => onLabelContentChange({...labelContent, [opt.field]: !!checked})}
                                    className="h-5 w-5 rounded-md border-2"
                                />
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const GeneratedLabel = ({ product, options }: { product: InventoryItem, options: LabelContentOptions }) => {
    const price = useMemo(() => {
        return product.msrp || product.price || (product.costPerUnit ? product.costPerUnit * 1.5 : 0);
    }, [product]);

    if (options.useCustomImage && product.labelImageUrl) {
        return (
            <div className="relative w-full h-full p-1 border border-dashed border-gray-400 bg-white">
                <Image src={product.labelImageUrl} alt="Custom Label" fill className="object-contain" unoptimized />
            </div>
        )
    }

    return (
        <div className="p-1 border border-dashed border-gray-400 text-center flex flex-col items-center justify-around break-words h-full bg-white">
            <div className="leading-tight space-y-0.5">
                {options.showProductName && <p className="font-bold text-[8px] uppercase">{product.name}</p>}
                {options.showPrice && price > 0 && <p className="font-mono text-[7px] font-black">${price.toFixed(2)}</p>}
                {options.showSKU && <p className="font-mono text-[6px]">SKU: {product.sku || product.id.slice(-6).toUpperCase()}</p>}
            </div>
            {options.showQRCode && (
                 <div className="flex-shrink-0">
                    <Image
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`clarityflow://product/${product.id}`)}`}
                        alt={`QR code for ${product.name}`}
                        width={40}
                        height={40}
                        className="object-contain"
                    />
                </div>
            )}
        </div>
    )
}

const SingleLabel = ({ product, options }: { product: InventoryItem, options: LabelContentOptions }) => {
    const price = useMemo(() => {
        return product.msrp || product.price || (product.costPerUnit ? product.costPerUnit * 1.5 : 0);
    }, [product]);

    if (options.useCustomImage && product.labelImageUrl) {
        return (
            <div className="relative w-full h-full p-2 bg-white">
                <Image src={product.labelImageUrl} alt="Custom Label" fill className="object-contain" unoptimized />
            </div>
        )
    }

    return (
        <div className="text-center flex flex-col items-center justify-around h-full w-full break-words text-black bg-white">
            <div className="leading-tight space-y-1">
                {options.showProductName && <p className="font-black uppercase text-[10px] tracking-tight">{product.name}</p>}
                {options.showPrice && price > 0 && <p className="font-mono text-[10px] font-black">${price.toFixed(2)}</p>}
                {options.showSKU && <p className="font-mono text-[8px]">SKU: {product.sku || product.id.slice(-6).toUpperCase()}</p>}
            </div>
            {options.showQRCode && (
                <div className="flex-shrink-0">
                     <Image
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`clarityflow://product/${product.id}`)}`}
                        alt={`QR code for ${product.name}`}
                        width={60}
                        height={60}
                        className="object-contain"
                    />
                </div>
            )}
        </div>
    )
}

const PrintPreview = ({
  products,
  selectedProductIds,
  labelContent,
  printMode,
}: {
  products: InventoryItem[],
  selectedProductIds: Set<string>;
  labelContent: LabelContentOptions;
  printMode: 'sheet' | 'single';
}) => {
  const selectedProducts = useMemo(() => 
    products.filter(p => selectedProductIds.has(p.id)),
    [selectedProductIds, products]
  );
  
  const labelsToRender = useMemo(() => {
    if (printMode === 'single') {
        return selectedProducts.length > 0 ? [selectedProducts[0]] : [];
    }
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
  }, [selectedProducts, printMode]);
  

  return (
    <Card className="border-4 rounded-[3rem] overflow-hidden shadow-2xl bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 text-left">
        <CardTitle className="text-base font-black uppercase tracking-widest">Protocol Preview</CardTitle>
        <CardDescription className="text-[10px] font-bold uppercase opacity-60">Real-time rendering of technical collateral.</CardDescription>
      </CardHeader>
      <CardContent className="bg-muted/30 p-4 sm:p-10 flex flex-col items-center">
        {selectedProducts.length > 0 ? (
            printMode === 'sheet' ? (
                <div id="label-sheet" className="grid grid-cols-3 grid-rows-10 gap-x-2 gap-y-0 p-4 bg-white shadow-2xl aspect-[8.5/11] border border-border w-full max-w-[600px]">
                    {labelsToRender.map((product, index) => (
                        product ? <GeneratedLabel key={`${product.id}-${index}`} product={product} options={labelContent} /> : <div key={index} className="border border-dashed border-gray-400"></div>
                    ))}
                </div>
            ) : (
                <div id="single-label-preview" className="bg-white shadow-2xl mx-auto border-2 rounded-xl flex items-center justify-center" style={{ width: '2.25in', height: '1.25in', padding: '0.1in' }}>
                   {labelsToRender[0] && <SingleLabel product={labelsToRender[0]} options={labelContent} />}
                </div>
            )
        ) : (
             <div className="h-[600px] w-full flex flex-col items-center justify-center border-4 border-dashed rounded-[3rem] opacity-30 gap-4">
                <Sparkles className="w-16 h-16 text-muted-foreground" />
                <p className="font-black uppercase tracking-widest text-sm">Select Assets to Render</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
};


function LabelPageContent() {
  const { inventory: allProducts } = useInventory();
  const searchParams = useSearchParams();
  const initialProductId = searchParams.get('product');

  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    initialProductId ? new Set([initialProductId]) : new Set()
  );

  const [labelContent, setLabelContent] = useState<LabelContentOptions>({
    showProductName: true,
    showPrice: true,
    showQRCode: true,
    showSKU: false,
    useCustomImage: !!initialProductId, // Default to custom image if coming from product detail
  });
  
  const [printMode, setPrintMode] = useState<'sheet' | 'single'>(initialProductId ? 'single' : 'sheet');

  const { toast } = useToast();
  
  const handlePrintModeChange = (mode: 'sheet' | 'single') => {
    setPrintMode(mode);
    if (mode === 'single' && selectedProducts.size > 1) {
      const firstProduct = selectedProducts.values().next().value;
      setSelectedProducts(new Set([firstProduct]));
    }
  }

  const handleProductSelect = (productId: string) => {
    if (printMode === 'single') {
        if (selectedProducts.has(productId)) {
            setSelectedProducts(new Set());
        } else {
            setSelectedProducts(new Set([productId]));
        }
        return;
    }
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
            title: "Registry Empty",
            description: "Select at least one asset to initialize printing protocol."
        });
        return;
    }
    window.print();
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Registry Collateral" />
      <main className="flex-1 p-4 md:p-10" id="main-content">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-center gap-4 text-left">
              <Button variant="outline" asChild className="h-12 px-6 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm print:hidden">
                <Link href="/inventory">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Return
                </Link>
              </Button>
              <div className="space-y-1">
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Print Station</h1>
                <p className="text-[10px] sm:text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60 print:hidden">Physical asset identifier generator</p>
              </div>
            </div>
            <div className="flex items-center gap-3 print:hidden w-full sm:w-auto">
              <Button variant="outline" className="flex-1 sm:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm">
                <Download className="mr-2 h-4 w-4 opacity-40" /> PDF Manifest
              </Button>
              <Button onClick={handlePrint} className="flex-1 sm:flex-none h-14 px-10 rounded-2xl shadow-xl font-black uppercase text-[10px] tracking-widest shadow-primary/20">
                <Printer className="mr-2 h-4 w-4" /> Finalize Print
              </Button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-10 items-start">
            <div className="lg:col-span-1 print:hidden">
              <CustomizationSidebar
                products={allProducts}
                selectedProducts={selectedProducts}
                onProductSelect={handleProductSelect}
                labelContent={labelContent}
                onLabelContentChange={setLabelContent}
                printMode={printMode}
                onPrintModeChange={handlePrintModeChange}
              />
            </div>
            <div className="lg:col-span-2">
              <PrintPreview products={allProducts} selectedProductIds={selectedProducts} labelContent={labelContent} printMode={printMode} />
            </div>
          </div>
        </div>
      </main>
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #main-content {
            padding: 0;
            margin: 0;
          }
          .label-print-area, .label-print-area * {
            visibility: visible;
          }
          .label-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            transform: scale(1);
          }
        }
        
        @page {
          size: letter;
          margin: 0.5in;
        }

        @page thermal {
          size: 2.25in 1.25in;
          margin: 0;
        }

        .thermal-print {
            page: thermal;
        }
      `}</style>
       <div className={cn('label-print-area', printMode === 'single' ? 'thermal-print' : 'sheet-print')}>
           <div className="hidden">
             <PrintPreview products={allProducts} selectedProductIds={selectedProducts} labelContent={labelContent} printMode={printMode} />
           </div>
       </div>
    </div>
  );
}

export default function LabelPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader className="animate-spin text-primary h-8 w-8" /></div>}>
            <LabelPageContent />
        </Suspense>
    );
}
