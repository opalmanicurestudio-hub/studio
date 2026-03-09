'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    MoreHorizontal, 
    PlusCircle, 
    Box, 
    Building, 
    Store, 
    ClipboardList, 
    LucideIcon, 
    X, 
    ArrowRight, 
    Search, 
    PackageOpen, 
    Sparkles, 
    Warehouse, 
    MapPin,
    Users
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type InventoryItem } from '@/lib/data';
import { type Location, type LocationType } from '@/lib/data';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import Image from 'next/image';
import Link from 'next/link';

const iconMap: { [key: string]: { component: LucideIcon, label: string } } = {
    Box: { component: Box, label: 'Box' },
    Building: { component: Building, label: 'Building' },
    Store: { component: Store, label: 'Store' },
    ClipboardList: { component: ClipboardList, label: 'Clipboard' },
};

const LocationContentsDialog = ({ location, items, open, onOpenChange }: { location: Location; items: InventoryItem[]; open: boolean; onOpenChange: (open: boolean) => void; }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background flex flex-col max-h-[90vh]">
                <DialogHeader className="p-8 pb-6 border-b bg-muted/5 text-left flex-shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                        <MapPin className="w-5 h-5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Zone Audit</span>
                    </div>
                    <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Items in {location.name}</DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Verified manifest for this storage unit.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1">
                    <div className="p-8 space-y-3">
                        {items.length > 0 ? items.map(item => (
                            <Link href={`/inventory/${item.id}`} key={item.id} className="block group">
                                <div className="flex items-center gap-4 p-4 rounded-2xl border-2 border-transparent hover:border-primary/10 hover:bg-primary/[0.02] transition-all bg-white shadow-sm">
                                    <div className="w-14 h-14 bg-muted/30 rounded-2xl flex-shrink-0 border-2 border-white shadow-inner overflow-hidden relative flex items-center justify-center">
                                         {item.imageUrl ? (
                                            <Image src={item.imageUrl} alt={item.name} fill className='object-cover'/>
                                         ) : (
                                            <Box className="w-6 h-6 text-muted-foreground/30" />
                                         )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-xs md:text-sm uppercase tracking-tight text-slate-900 truncate">{item.name}</p>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{item.category}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-black text-lg md:text-xl tracking-tighter font-mono text-primary leading-none">{item.totalStock}</p>
                                        <p className="text-[8px] font-black uppercase text-primary/40 mt-1">Full Units</p>
                                    </div>
                                </div>
                            </Link>
                        )) : (
                            <div className="py-20 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
                                <PackageOpen className="w-16 h-16" />
                                <p className="text-[10px] font-black uppercase tracking-widest">Zone Manifest Empty</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
                <DialogFooter className="p-8 pt-4 border-t bg-muted/5 flex-shrink-0">
                    <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl" onClick={() => onOpenChange(false)}>Close Summary</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const LocationCard = ({ 
    location, 
    locationType, 
    itemCount,
    onEdit,
    onDelete,
    onClick,
}: { 
    location: Location, 
    locationType?: LocationType, 
    itemCount: number,
    onEdit: (location: Location) => void,
    onDelete: (locationId: string) => void,
    onClick: (location: Location) => void,
}) => {
    const Icon = locationType ? iconMap[locationType.icon]?.component : Box;
    return (
        <Card className="transition-all duration-500 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col bg-white hover:border-primary/20 hover:shadow-2xl hover:shadow-primary/5 cursor-pointer shadow-sm" onClick={() => onClick(location)}>
            <CardContent className="p-6 space-y-6 flex-1 text-left">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="p-4 rounded-2xl bg-primary/5 border-2 border-primary/10 shadow-inner group-hover:bg-primary transition-all duration-500 shrink-0">
                            {Icon && <Icon className="w-6 h-6 text-primary group-hover:text-white transition-colors" />}
                        </div>
                        <div className="min-w-0">
                            <p className="font-black uppercase tracking-tight text-sm md:text-base text-slate-900 truncate leading-none mb-1.5">{location.name}</p>
                            <Badge variant="outline" className="h-5 px-2 rounded-full font-black text-[8px] uppercase tracking-widest border-2">
                                {locationType?.name || 'Standard Unit'}
                            </Badge>
                        </div>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 rounded-xl hover:bg-primary/5 shrink-0 -mt-1 -mr-1" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => onEdit(location)} className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                                <PlusCircle className="mr-2 h-3.5 w-3.5 opacity-40" /> Edit Detail
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest py-2.5" onClick={() => onDelete(location.id)}>
                                <Trash2 className="mr-2 h-3.5 w-3.5 opacity-40" /> Terminate Zone
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="grid grid-cols-1 gap-4 mt-auto">
                    <div className="p-4 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-border/50 transition-all flex justify-between items-center">
                        <div className="space-y-0.5">
                            <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60 leading-none">Manifest Load</p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Assigned SKUs</p>
                        </div>
                        <p className="text-2xl font-black font-mono tracking-tighter text-slate-900">{itemCount}</p>
                    </div>
                </div>
            </CardContent>
            
            <div className="p-3 border-t bg-muted/5">
                <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:bg-primary/5 hover:text-primary transition-all group/btn">
                    Explore Zone <ArrowRight className="ml-2 h-3 w-3 transition-transform group-hover/btn:translate-x-1" />
                </Button>
            </div>
        </Card>
    );
};

const EmptyState = ({ onAdd }: { onAdd: () => void }) => (
    <div className="text-center py-24 px-6 col-span-full border-4 border-dashed rounded-[3rem] opacity-40 flex flex-col items-center gap-6">
        <div className='w-24 h-24 bg-muted rounded-[2rem] flex items-center justify-center shadow-inner'>
            <Warehouse className='w-12 h-12 text-muted-foreground' />
        </div>
        <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Zones Inactive</h3>
            <p className="text-sm font-bold uppercase tracking-tight text-muted-foreground max-w-sm mx-auto">
                Define your studio's physical organizational matrix to enable zone-specific asset tracking.
            </p>
        </div>
        <Button size="lg" onClick={onAdd} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20">
            <PlusCircle className="mr-2 h-5 w-5" />
            Establish First Zone
        </Button>
    </div>
);

export const Locations = ({
    locations,
    locationTypes,
    inventory,
    onAddLocation,
    onEditLocation,
    onDelete,
}: {
    locations: Location[];
    locationTypes: LocationType[];
    inventory: InventoryItem[];
    onAddLocation: () => void;
    onEditLocation: (location: Location) => void;
    onDelete: (locationId: string) => void;
}) => {
    const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

    const itemsPerLocation = (locationId: string) => {
        return inventory.filter(item => item.primaryLocationId === locationId || item.secondaryLocationIds?.includes(locationId)).length;
    };

    const itemsInSelectedLocation = selectedLocation ? inventory.filter(item => item.primaryLocationId === selectedLocation.id || item.secondaryLocationIds?.includes(selectedLocation.id)) : [];

    return (
        <div className="space-y-10 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Storage Architecture</h3>
                    <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Physical organizational matrix</p>
                </div>
                <Button onClick={onAddLocation} className="h-12 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full sm:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" /> New Zone
                </Button>
            </div>

            {locations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
                    {locations.map(location => (
                        <LocationCard 
                            key={location.id} 
                            location={location} 
                            locationType={locationTypes.find(lt => lt.id === location.locationTypeId)}
                            itemCount={itemsPerLocation(location.id)}
                            onEdit={onEditLocation}
                            onDelete={onDelete}
                            onClick={setSelectedLocation}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState onAdd={onAddLocation} />
            )}

            {selectedLocation && (
                <LocationContentsDialog
                    location={selectedLocation}
                    items={itemsInSelectedLocation}
                    open={!!selectedLocation}
                    onOpenChange={(isOpen) => !isOpen && setSelectedLocation(null)}
                />
            )}
        </div>
    );
}