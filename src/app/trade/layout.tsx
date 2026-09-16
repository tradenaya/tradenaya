"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAppSelector } from "@/store/hooks";
import CustomerSidebar from "@/components/customer/CustomerSidebar";
import CustomerNavbar from "@/components/customer/CustomerNavbar";

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tenant = useAppSelector((state) => state.tenant);

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
    <div
      className="min-h-screen"
      style={{ backgroundColor: "#070605", color: "#eee5d8" }}
    >
      <CustomerSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} tenantName={tenantName} />

      <div className="flex flex-col min-h-screen">
        <CustomerNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
