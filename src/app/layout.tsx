import Providers from "./providers";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "sonner";

// Fonts are bundled in ./fonts (downloaded from Google Fonts) instead of
// next/font/google, so production builds never fetch from Google — that fetch
// step failed on the VPS ("next/font/google queries have exactly one entry").

const inter = localFont({
  variable: "--font-inter",
  src: [{ path: "./fonts/inter-latin-variable.woff2", weight: "300 700", style: "normal" }],
  display: "swap",
});

const poppins = localFont({
  variable: "--font-poppins",
  src: [
    { path: "./fonts/poppins-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins-latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins-latin-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/poppins-latin-800.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
});

const cinzel = localFont({
  variable: "--font-cinzel",
  src: [{ path: "./fonts/cinzel-latin-variable.woff2", weight: "400 600", style: "normal" }],
  display: "swap",
});

const cinzelDecorative = localFont({
  variable: "--font-cinzel-decorative",
  src: [
    { path: "./fonts/cinzel-decorative-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/cinzel-decorative-latin-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});

const notoSerifDevanagari = localFont({
  variable: "--font-devanagari",
  src: [{ path: "./fonts/noto-serif-devanagari-devanagari-variable.woff2", weight: "500 700", style: "normal" }],
  display: "swap",
  preload: false, // only the landing page's mantra uses it
});

export const metadata: Metadata = {
  title: "Tradenaya",
  description: "Tradenaya authentication and dashboard experience",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${cinzel.variable} ${cinzelDecorative.variable} ${notoSerifDevanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ fontFamily: "var(--font-cinzel), var(--font-inter), system-ui, sans-serif" }}>
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
