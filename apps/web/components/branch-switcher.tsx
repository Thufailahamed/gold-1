"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Building2Icon, ChevronDownIcon } from "./icons";

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
        const active = saved && d.rows.some((b) => b.id === saved) ? saved : d.rows[0]?.id ?? "";
        setCurrent(active);
        if (active && (!saved || saved !== active)) {
          document.cookie = `${COOKIE}=${active}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
          window.dispatchEvent(new CustomEvent("goldos-branch-changed", { detail: active }));
        }
      })
      .catch(() => undefined);
  }, []);

  function select(id: string) {
    setCurrent(id);
    document.cookie = `${COOKIE}=${id}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    window.dispatchEvent(new CustomEvent("goldos-branch-changed", { detail: id }));
  }

  return (
    <div className="relative hidden items-center sm:flex">
      <Building2Icon size={14} className="pointer-events-none absolute left-3 text-ink-4" />
      <select
        aria-label="Branch"
        value={current}
        onChange={(e) => select(e.target.value)}
        className="h-9 cursor-pointer appearance-none rounded-lg bg-paper pl-8 pr-8 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(28,25,23,0.14)] transition-shadow focus:outline-none focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)]"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} · {b.code}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={13} className="pointer-events-none absolute right-2.5 text-ink-4" />
    </div>
  );
}
