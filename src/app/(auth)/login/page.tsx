'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Loader, KeyRound, Mail, Sparkles, ArrowRight } from 'lucide-react';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import Link from 'next/link';
import { motion } from 'framer-motion';

const loginSchema = z.object({
  email: z.string().email('Invalid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    const auth = getAuth();
    try {
      await signInWithEmailAndPassword(auth, data.email, data.password);
      router.push('/dashboard');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Sign-in Failed',
        description: 'Invalid email or password. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-sm"
    >
        <Card className="border-4 rounded-[3rem] shadow-3xl overflow-hidden bg-white/80 backdrop-blur-xl">
            <CardHeader className="p-8 pb-4 text-center border-b bg-muted/5">
                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-white rounded-[1.5rem] shadow-xl border-2 border-primary/10">
                        <ClarityFlowLogo className="w-10 h-10" />
                    </div>
                </div>
                <div className="flex items-center justify-center gap-3 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Secure Access</span>
                </div>
                <CardTitle className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                    Welcome Back
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-4">
                    Authorized studio entry required
                </CardDescription>
            </CardHeader>
            
            <CardContent className="p-8">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="space-y-2 text-left">
                        <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Identity (Email)</Label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                            <Input 
                                id="email" 
                                type="email" 
                                placeholder="ALEX@EXAMPLE.COM" 
                                {...register('email')} 
                                className="h-14 pl-12 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20"
                            />
                        </div>
                        {errors.email && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.email.message}</p>}
                    </div>
                    
                    <div className="space-y-2 text-left">
                        <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Security Key</Label>
                        <div className="relative">
                            <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                            <Input 
                                id="password" 
                                type="password" 
                                {...register('password')} 
                                className="h-14 pl-12 rounded-2xl border-2 font-bold shadow-inner focus-visible:ring-primary/20"
                            />
                        </div>
                        {errors.password && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.password.message}</p>}
                    </div>

                    <Button type="submit" className="w-full h-16 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 active:scale-95 transition-all group" disabled={isLoading}>
                        {isLoading ? (
                            <Loader className="h-6 w-6 animate-spin" />
                        ) : (
                            <span className="flex items-center gap-2">
                                Access Portal
                                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                            </span>
                        )}
                    </Button>
                </form>
            </CardContent>
            
            <CardFooter className="p-8 pt-0 flex flex-col gap-4">
                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">
                    New Creator? <Link href="/signup" className="text-primary underline decoration-2 underline-offset-4">Initialize Account</Link>
                </p>
            </CardFooter>
        </Card>
    </motion.div>
  );
}
