"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/auth";
import { PageSkeleton } from "@/components/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, inactive } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(inactive ? "/login?inactive=1" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, inactive, router, pathname]);

  return <AppShell>{user ? children : <PageSkeleton />}</AppShell>;
}
