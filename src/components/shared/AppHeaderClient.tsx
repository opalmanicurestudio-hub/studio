'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Bell, LifeBuoy, LogOut, Settings, User, Sparkles } from 'lucide-react';
import { ClientOnly } from './ClientOnly';
import { useUser } from '@/firebase';
import { cn } from '@/lib/utils';

type AppHeaderProps = {
  title: string;
};

export function AppHeaderClient({ title }: AppHeaderProps) {
  const { user } = useUser();
  
  const getInitials = (name?: string | null): string => {
    if (!name) return 'U';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border/40 bg-background/80 px-4 backdrop-blur-xl md:px-8">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="md:hidden hover:bg-primary/10 transition-colors" />
        <h1 className="text-sm sm:text-lg font-black uppercase tracking-tighter text-slate-900 md:text-xl truncate">
          {title}
        </h1>
      </div>
      <div className="ml-auto flex items-center gap-2 md:gap-4">
        <ClientOnly>
          <Button variant="ghost" size="icon" className="rounded-full h-10 w-10 hover:bg-primary/5">
            <Bell className="h-5 w-5" />
            <span className="sr-only">Toggle notifications</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-xl p-0 hover:bg-primary/5">
                <Avatar className="h-10 w-10 rounded-xl border-2 border-transparent hover:border-primary/20 transition-all shadow-sm">
                  <AvatarImage src={user?.photoURL || undefined} alt="User" className="object-cover" />
                  <AvatarFallback className="font-black text-xs bg-primary/10 text-primary">
                    {getInitials(user?.displayName)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-[2rem] shadow-3xl border-4 p-2 overflow-hidden bg-background">
              <DropdownMenuLabel className="px-4 py-3 font-black uppercase tracking-widest text-[10px] text-muted-foreground opacity-60 border-b mb-1">
                Account Hub
              </DropdownMenuLabel>
              <DropdownMenuItem className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest focus:bg-primary/5 cursor-pointer">
                <User className="w-4 h-4 mr-3 text-primary opacity-40" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest focus:bg-primary/5 cursor-pointer">
                <Settings className="w-4 h-4 mr-3 text-primary opacity-40" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest focus:bg-primary/5 cursor-pointer">
                <LifeBuoy className="w-4 h-4 mr-3 text-primary opacity-40" />
                <span>Support</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-1 my-2" />
              <DropdownMenuItem className="rounded-xl h-11 text-destructive font-black uppercase text-[10px] tracking-widest focus:bg-destructive/5 focus:text-destructive cursor-pointer">
                <LogOut className="w-4 h-4 mr-3" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
