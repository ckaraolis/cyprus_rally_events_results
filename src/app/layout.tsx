import type { Metadata } from "next";
import { Geist, Geist_Mono, Oswald } from "next/font/google";
import Script from "next/script";
import { themeInlineScript } from "@/components/public/theme-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Cyprus Rally Championship — Live Results",
  description: "National Cyprus Rally Championship timing and results.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script
          id="ewrc-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInlineScript() }}
        />
        {children}
      </body>
    </html>
  );
}
