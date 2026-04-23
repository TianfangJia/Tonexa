import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tonexa",
  description: "Singing practice app powered by MusicXML",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-white font-sans text-zinc-900">
        {children}
      </body>
    </html>
  );
}
