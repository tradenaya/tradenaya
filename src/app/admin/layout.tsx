"use client";

import { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import AdminNavbar from "@/components/admin/AdminNavbar";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const adminAuth = useAppSelector((state) => state.adminAuth);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--admin-background)", color: "var(--admin-foreground)" }}>
      <AdminSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tenantName={adminAuth.tenantName}
      />
      <div className={`transition-all duration-300 ${sidebarOpen ? "md:ml-72" : ""}`}>
        <AdminNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
