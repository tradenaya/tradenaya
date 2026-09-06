"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAppSelector } from "@/store/hooks";
import CustomerSidebar from "@/components/customer/CustomerSidebar";
import CustomerNavbar from "@/components/customer/CustomerNavbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const tenant = useAppSelector((state) => state.tenant);

  // key the shell by pathname so navigation unmounts/remounts it and the
  // sidebar resets to closed on every route change instead of persisting open.
  return (
    <NavShell key={pathname} tenantName={tenant.tenantName}>
      {children}
    </NavShell>
  );
}

function NavShell({
  children,
  tenantName,
}: {
  children: React.ReactNode;
  tenantName?: string;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <CustomerSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tenantName={tenantName}
      />

      <div className={`flex flex-col min-h-screen transition-all duration-300 ${sidebarOpen ? "ml-72" : ""}`}>
        <CustomerNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
