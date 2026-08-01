"use client";

import { useAppSelector } from "@/store/hooks";
import { LayoutDashboard } from "lucide-react";

export default function AdminDashboardPage() {
  const auth = useAppSelector((state) => state.adminAuth);

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <LayoutDashboard size={22} style={{ color: "var(--primary)" }} />
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Welcome back, {auth.firstName || "Admin"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
