import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/auth";
import { THEME_INIT_SCRIPT, ThemedToaster } from "@/components/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobDraft",
  description: "Tailored job application drafts in your own Gmail, twice a day.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets the "dark" class before React loads.
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <AuthProvider>{children}</AuthProvider>
        <ThemedToaster />
      </body>
    </html>
  );
}
