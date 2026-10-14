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
import { Bell, LogOut, Settings, Sun, Moon, MonitorSmartphone, Check } from 'lucide-react';
import { ClientOnly } from './ClientOnly';
import { useUser, useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { useDeskTheme } from '@/components/pos/desk/kit';

type AppHeaderProps = {
  title: string;
};

export function AppHeaderClient({ title }: AppHeaderProps) {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const { pref, resolved, set } = useDeskTheme();
  const dark = resolved === 'dark';

  const getInitials = (name?: string | null): string => {
    if (!name) return 'U';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };
  const item = 'h-11 cursor-pointer rounded-xl px-3 text-[14px]';
  const looks: ['light' | 'dark' | 'system', string, typeof Sun][] = [['light', 'White', Sun], ['dark', 'Black', Moon], ['system', 'Match this device', MonitorSmartphone]];

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border/60 bg-background/85 px-4 backdrop-blur-xl md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="lg:hidden" />
        <h1 className="truncate text-[19px] font-light tracking-tight text-foreground md:text-[22px]">{title}</h1>
      </div>
      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <ClientOnly>
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full" onClick={() => set(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to white' : 'Switch to black'} title={dark ? 'Switch to white' : 'Switch to black'}>
            {dark ? <Sun className="h-5 w-5" strokeWidth={1.7} /> : <Moon className="h-5 w-5" strokeWidth={1.7} />}
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full" aria-label="Notifications">
            <Bell className="h-5 w-5" strokeWidth={1.7} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0" aria-label="Your account">
                <Avatar className="h-10 w-10 rounded-full">
                  <AvatarImage src={user?.photoURL || undefined} alt="" className="object-cover" />
                  <AvatarFallback className="bg-secondary text-[12px] font-semibold text-foreground">{getInitials(user?.displayName)}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-2xl border bg-popover p-1.5 shadow-xl">
              <DropdownMenuLabel className="px-3 py-2">
                <span className="block truncate text-[14px] font-semibold">{user?.displayName || 'Signed in'}</span>
                {user?.email && <span className="block truncate text-[12px] font-normal text-muted-foreground">{user.email}</span>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[12px] font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
              {looks.map(([k, l, I]) => (
                <DropdownMenuItem key={k} className={item} onSelect={(ev) => { ev.preventDefault(); set(k); }}>
                  <I className="mr-3 h-4 w-4" strokeWidth={1.7} /><span className="flex-1">{l}</span>{pref === k && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className={item} onSelect={() => router.push('/settings')}>
                <Settings className="mr-3 h-4 w-4" strokeWidth={1.7} /><span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem className={`${item} text-destructive focus:text-destructive`} onSelect={async () => { if (auth) { await signOut(auth).catch(() => {}); router.push('/login'); } }}>
                <LogOut className="mr-3 h-4 w-4" strokeWidth={1.7} /><span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    </header>
  );
}
