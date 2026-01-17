
'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, PlusCircle, Box, Building, Store, ClipboardList, LucideIcon, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type InventoryItem } from '@/lib/data';
import { type Location, type LocationType } from '@/context/InventoryContext';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Items in {location.name}</DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] -mx-6 px-6">
                    <div className="space-y-3 py-4">
                        {items.length > 0 ? items.map(item => (
                            <Link href={`/inventory/${item.id}`} key={item.id} className="block hover:bg-muted/50 p-2 rounded-md transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-muted rounded-md flex-shrink-0">
                                         <Image src={item.imageUrl || `https://picsum.photos/seed/inv${item.id}/100/100`} alt={item.name} width={48} height={48} className='rounded-md object-cover h-full w-full'/>
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-semibold">{item.name}</p>
                                        <p className="text-sm text-muted-foreground">{item.category}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold">{item.totalStock}</p>
                                        <p className="text-xs text-muted-foreground">in stock</p>
                                    </div>
                                </div>
                            </Link>
                        )) : (
                            <p className="text-center text-muted-foreground py-10">No items are stored in this location.</p>
                        )}
                    </div>
                </ScrollArea>
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
        <Card className="transition-all duration-200 hover:shadow-xl hover:-translate-y-1 cursor-pointer" onClick={() => onClick(location)}>
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-muted/50 rounded-lg">
                        {Icon && <Icon className="w-6 h-6 text-muted-foreground" />}
                    </div>
                    <div className="flex-1">
                        <p className="font-semibold text-base">{location.name}</p>
                        <p className="text-sm text-muted-foreground">{locationType?.name || 'Uncategorized'}</p>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className="-mt-1 h-8 w-8 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => onEdit(location)}>Edit Location</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(location.id)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                 <div className="flex items-center justify-between text-sm">
                    <span className='text-muted-foreground'>Items Stored:</span>
                    <Badge variant="secondary">{itemCount}</Badge>
                </div>
            </CardContent>
        </Card>
    );
};

export const Locations = ({
    locations,
    locationTypes,
    inventory,
    setLocations,
    onAddLocation,
    onEditLocation,
}: {
    locations: Location[];
    locationTypes: LocationType[];
    inventory: InventoryItem[];
    setLocations: React.Dispatch<React.SetStateAction<Location[]>>;
    onAddLocation: () => void;
    onEditLocation: (location: Location) => void;
}) => {
    const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

    const handleDeleteLocation = (locationId: string) => {
        // In a real app, you'd want to check if any inventory items are using this location first
        setLocations(prev => prev.filter(loc => loc.id !== locationId));
    };

    const itemsPerLocation = (locationId: string) => {
        return inventory.filter(item => item.primaryLocationId === locationId || item.secondaryLocationIds?.includes(locationId)).length;
    };

    const itemsInSelectedLocation = selectedLocation ? inventory.filter(item => item.primaryLocationId === selectedLocation.id || item.secondaryLocationIds?.includes(selectedLocation.id)) : [];

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div>
                            <CardTitle>Storage Locations</CardTitle>
                            <CardDescription>Manage where your inventory is physically stored.</CardDescription>
                        </div>
                        <Button className='w-full sm:w-auto' onClick={onAddLocation}>
                            <PlusCircle className="mr-2 h-4 w-4" /> New Location
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {locations.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {locations.map(location => (
                                <LocationCard 
                                    key={location.id} 
                                    location={location} 
                                    locationType={locationTypes.find(lt => lt.id === location.locationTypeId)}
                                    itemCount={itemsPerLocation(location.id)}
                                    onEdit={onEditLocation}
                                    onDelete={handleDeleteLocation}
                                    onClick={setSelectedLocation}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-10 px-6 border-2 border-dashed rounded-lg">
                            <div className='flex justify-center mb-4'>
                                <Building className='w-10 h-10 text-muted-foreground' />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">No Locations Yet</h3>
                            <p className="text-muted-foreground mb-4">Add your first storage location to get organized.</p>
                            <Button onClick={onAddLocation}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Location
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
            {selectedLocation && (
                <LocationContentsDialog
                    location={selectedLocation}
                    items={itemsInSelectedLocation}
                    open={!!selectedLocation}
                    onOpenChange={(isOpen) => {
                        if (!isOpen) {
                            setSelectedLocation(null);
                        }
                    }}
                />
            )}
        </>
    );
}
