import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KazEDS Demo — Вход по ЭЦП",
  description: "Демонстрация входа и подписания через электронную цифровую подпись",
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
        <script src="http://extension.sign.aitu.uz/eds.js" />
      </head>
      <body className="bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
