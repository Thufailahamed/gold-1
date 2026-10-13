"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type MeData } from "./api";
import { clearTenant } from "./tenant";
import { setShopOffsetMinutes } from "./busclock";

export function useSession() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api<MeData>("/api/v1/auth/me")
      .then((m) => {
        setShopOffsetMinutes(m.tzOffsetMinutes);
        setMe(m);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  return { me, loading };
}

export async function logout(): Promise<void> {
  try {
    await api("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearTenant();
  }
}
