import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KazEDS",
  description: "Электронная цифровая подпись",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1F4E79",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html:not(.ready) body { opacity: 0; }` }} />
        <script dangerouslySetInnerHTML={{ __html: `
          var t = document.createElement('script');
          t.src = 'https://cdn.tailwindcss.com';
          t.onload = function() { document.documentElement.classList.add('ready'); };
          document.head.appendChild(t);
        `}} />
      </head>
      <body className="bg-gradient-to-b from-slate-50 to-slate-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
