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
        background: `
          radial-gradient(circle at 50% 35%, rgba(201,154,88,0.07), transparent 60%),
          radial-gradient(circle at 10% 90%, rgba(201,154,88,0.035), transparent 60%),
          linear-gradient(160deg, #0a0806 0%, #070605 55%, #050403 100%)
        `,
        color: "var(--foreground)",
      }}
    >
      {/* Very subtle top border glow */}
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(201,154,88,0.35), transparent)",
        }}
      />

      {/* Sign-in card */}
      <Card
        className="relative z-10 w-full max-w-md overflow-hidden"
        style={{
          background: "linear-gradient(160deg, rgba(201,154,88,0.06), rgba(10,9,7,0.95))",
          border: "1px solid rgba(201,154,88,0.16)",
          boxShadow:
            "0 25px 80px rgba(0,0,0,0.65), 0 0 40px rgba(201,154,88,0.04)",
        }}
      >
        {/* Gold accent line */}
        <div
          className="h-[2px] w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, #c99a58, transparent)",
          }}
        />

        <CardHeader className="space-y-4 text-center pt-8 pb-5">
          {/* Logo */}
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl shadow-lg"
            style={{
              border: "1px solid rgba(201,154,88,0.2)",
              background: "rgba(201,154,88,0.08)",
            }}
          >
            <img
              src="/logo/tradenaya-logo.png"
              alt="Tradenaya"
              className="h-11 w-11 object-contain"
              style={{
                filter: "invert(67%) sepia(31%) saturate(720%) hue-rotate(356deg) brightness(106%) drop-shadow(0 0 10px rgba(201,154,88,0.35))",
              }}
            />
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h1
              className="text-2xl font-semibold tracking-wide"
              style={{
                fontFamily: "var(--font-cinzel), serif",
                background: "linear-gradient(100deg, #f4e6cd 0%, #eee5d8 35%, #c99a58 75%, #f4e6cd 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {title}
            </h1>

            <CardDescription
              className="text-sm"
              style={{
                fontFamily: "var(--font-cinzel), serif",
                color: "rgba(218, 178, 117, 0.58)",
                letterSpacing: "0.1em",
              }}
            >
              {subtitle}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-7">
          {children}

          {footer && (
            <div
              className="mt-6 pt-5"
              style={{
                borderTop: "1px solid rgba(201,154,88,0.14)",
              }}
            >
              {footer}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom branding */}
      <div className="absolute bottom-5 left-0 right-0 text-center">
        <span
          className="text-[11px]"
          style={{
            fontFamily: "var(--font-cinzel), serif",
            letterSpacing: "0.2em",
            color: "rgba(201, 154, 88, 0.34)",
          }}
        >
          Tradenaya
        </span>
      </div>
    </main>
  );
}
