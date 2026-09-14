import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

interface Props {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: Props) {
  return (
    <main
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4"
      style={{
        background: "#050505",
        color: "var(--foreground)",
      }}
    >
      {/* Subtle background atmosphere */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(
              700px 400px at 50% 35%,
              rgba(184, 134, 11, 0.07),
              transparent 70%
            ),
            radial-gradient(
              500px 300px at 10% 90%,
              rgba(184, 134, 11, 0.035),
              transparent 70%
            )
          `,
        }}
      />

      {/* Very subtle top border glow */}
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(184,134,11,0.35), transparent)",
        }}
      />

      {/* Sign-in card */}
      <Card
        className="relative z-10 w-full max-w-md overflow-hidden"
        style={{
          background: "#090909",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow:
            "0 25px 80px rgba(0,0,0,0.65), 0 0 40px rgba(184,134,11,0.035)",
        }}
      >
        {/* Gold accent line */}
        <div
          className="h-[2px] w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, #B8860B, transparent)",
          }}
        />

        <CardHeader className="space-y-4 text-center pt-8 pb-5">
          {/* Logo */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl border border-white/10 bg-[#111111] shadow-lg">
            <img
              src="/logo/tradenaya-logo.png"
              alt="Tradenaya"
              className="h-11 w-11 object-contain"
            />
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {title}
            </h1>

            <CardDescription className="text-sm text-gray-400">
              {subtitle}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-7">
          {children}

          {footer && (
            <div className="mt-6 border-t border-white/10 pt-5">
              {footer}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom branding */}
      <div className="absolute bottom-5 left-0 right-0 text-center">
        <span className="text-[11px] tracking-[0.2em] text-gray-600 uppercase">
          Tradenaya
        </span>
      </div>
    </main>
  );
}