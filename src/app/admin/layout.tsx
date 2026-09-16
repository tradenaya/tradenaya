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
    <div className="min-h-screen" style={{ backgroundColor: "#070605", color: "#eee5d8" }}>
      <AdminSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tenantName={adminAuth.tenantName}
      />
      <div className="transition-all duration-300">
        <AdminNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="p-4 sm:p-6 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}