"use client";

import { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import CustomerSidebar from "@/components/customer/CustomerSidebar";
import CustomerNavbar from "@/components/customer/CustomerNavbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 1024,
  );
  const tenant = useAppSelector((state) => state.tenant);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <CustomerSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tenantName={tenant.tenantName}
      />

      <div className={`flex flex-col min-h-screen transition-all duration-300 ${sidebarOpen ? "ml-72" : ""}`}>
        <CustomerNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
