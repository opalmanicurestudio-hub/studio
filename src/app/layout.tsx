import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from "@/firebase";
import { RegisterSW } from "@/components/pwa/RegisterSW";

export const metadata: Metadata = {
  title: "ClarityFlow",
  description:
    "A comprehensive business management application for solo service professionals.",
  // ── PWA ──
  // One app for everyone: owners land on their dashboard, renters sign into
  // their portal — the same install routes by who you are, which is why
  // start_url is simply "/".
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ClarityFlow",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

// v70 — THE MOBILE FIX. Your previous layout declared the viewport as a raw
// <meta> tag inside a manual <head>, which the App Router doesn't reliably
// render — leaving pages with NO viewport tag, so phones laid them out at
// ~980px and every `md:` breakpoint matched (the "fits like desktop" bug).
// This export is the API Next.js actually honors.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
  // Deliberately no maximumScale/userScalable — pinch-zoom stays enabled.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* viewport meta REMOVED from here — it lives in the export above */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`font-body antialiased`}>
        <RegisterSW />
        <FirebaseClientProvider>
          {children}
        </FirebaseClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
