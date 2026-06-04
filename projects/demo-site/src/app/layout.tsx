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
        <script dangerouslySetInnerHTML={{ __html: `
          // Load Tailwind CSS + eds.js, then show page
          document.documentElement.style.opacity='0';
          var tw = document.createElement('script');
          tw.src = 'https://cdn.tailwindcss.com';
          tw.onload = function() { document.documentElement.style.opacity='1'; };
          document.head.appendChild(tw);
          // eds.js widget — uncomment for development without extension
          // var eds = document.createElement('script');
          // eds.src = 'https://sign.aitu.uz/ext/eds.js';
          // document.head.appendChild(eds);
        `}} />
      </head>
      <body className="bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
