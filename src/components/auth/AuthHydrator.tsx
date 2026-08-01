"use client";

import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { adminLogin } from "@/store/slices/adminAuthSlice";
import { customerLogin } from "@/store/slices/customerAuthSlice";
import { setAdminTheme } from "@/store/slices/adminThemeSlice";
import { setCustomerTheme } from "@/store/slices/customerThemeSlice";

export default function AuthHydrator({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const adminAuth = useAppSelector((state) => state.adminAuth);
  const customerAuth = useAppSelector((state) => state.customerAuth);
  const attempted = useRef(false);
  const [hydrated, setHydrated] = useState(
    adminAuth.isAuthenticated || customerAuth.isAuthenticated
  );

  useEffect(() => {
    if (attempted.current) return;
    if (adminAuth.isAuthenticated || customerAuth.isAuthenticated) return;

    attempted.current = true;

    async function hydrate() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          dispatch(
            customerLogin({
              tenantId: data.tenantId,
              tenantCode: data.tenantCode,
              tenantName: data.tenantName,
              profileId: data.customerId,
              profileCode: data.customerCode,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              role: "CUSTOMER",
            })
          );
          if (data.theme) {
            dispatch(setCustomerTheme(data.theme));
          }
          setHydrated(true);
          return;
        }
      } catch {}

      try {
        const res = await fetch("/api/admin/me");
        if (res.ok) {
          const data = await res.json();
          dispatch(
            adminLogin({
              tenantId: data.tenantId,
              tenantCode: data.tenantCode,
              tenantName: data.tenantName,
              userId: data.userId,
              userCode: data.userCode,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              role: "ADMIN",
            })
          );
          if (data.theme) {
            dispatch(setAdminTheme(data.theme));
          }
          setHydrated(true);
          return;
        }
      } catch {}

      setHydrated(true);
    }

    hydrate();
  }, [adminAuth.isAuthenticated, customerAuth.isAuthenticated, dispatch]);

  if (!hydrated) {
    return null;
  }

  return <>{children}</>;
}
