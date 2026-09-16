"use client";

import { useAppSelector } from "@/store/hooks";
import { LayoutDashboard } from "lucide-react";

export default function AdminDashboardPage() {
  const auth = useAppSelector((state) => state.adminAuth);

  return (
    <div className="space-y-6 p-0 sm:p-6">
      <div
        className="rounded-xl border p-4 sm:p-6"
        style={{
          background: "linear-gradient(160deg, rgba(201,154,88,0.06), #0a0907)",
          borderColor: "rgba(201,154,88,0.16)",
        }}
      >
        <div className="flex items-center gap-3">
          <LayoutDashboard size={22} style={{ color: "#c99a58" }} />
          <div>
            <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-cinzel), serif" }}>
              Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">Welcome back, {auth.firstName || "Admin"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
