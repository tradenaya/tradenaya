"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Actor, User } from "@/lib/types";

interface AuthState {
  user: User | null;
  /** Set while an admin uses JobDraft as `user`. */
  actor: Actor | null;
  /** The account was deactivated by the admin (shown on the login page). */
  inactive: boolean;
  loading: boolean;
  setUser: (u: User | null) => void;
  refresh: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [inactive, setInactive] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    () =>
      api<{ user: User; actor: Actor | null }>("/api/auth/me").then(
        (res) => {
          setUser(res.user);
          setActor(res.actor ?? null);
          setInactive(false);
          setLoading(false);
          return res.user;
        },
        (err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            setUser(null);
            setActor(null);
            setInactive(err.code === "account_inactive");
          }
          setLoading(false);
          return null;
        },
      ),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setActor(null);
  }, []);

  const value = useMemo(() => ({ user, actor, inactive, loading, setUser, refresh, logout }), [user, actor, inactive, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
