import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "KazEDS Demo — Вход по ЭЦП",
  description: "Демонстрация входа и подписания через электронную цифровую подпись",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
        <Script src="http://extension.eds.aitu.uz/eds.js" strategy="beforeInteractive" />
      </head>
      <body className="bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
