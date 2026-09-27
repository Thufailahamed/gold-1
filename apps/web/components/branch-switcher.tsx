"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Branch = { id: string; name: string; code: string };

const COOKIE = "goldos_branch";

export function BranchSwitcher() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [current, setCurrent] = useState<string>("");

  useEffect(() => {
    api<{ rows: Branch[] }>("/api/v1/branches?limit=100")
      .then((d) => {
        setBranches(d.rows);
        const saved = document.cookie
          .split("; ")
          .find((c) => c.startsWith(`${COOKIE}=`))
          ?.split("=")[1];
        setCurrent(saved ?? d.rows[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, []);

  function select(id: string) {
    setCurrent(id);
    document.cookie = `${COOKIE}=${id}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  }

  return (
    <select
      aria-label="Branch"
      value={current}
      onChange={(e) => select(e.target.value)}
      className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-gold"
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} ({b.code})
        </option>
      ))}
    </select>
  );
}
