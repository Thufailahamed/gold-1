"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Reveal } from "./motion";

type Plan = {
  code: string;
  name: string;
  description: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  trial_days: number;
  max_users: number | null;
  max_branches: number | null;
  features: string[];
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export function Plans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/v1/public/plans`)
      .then((r) => r.json())
      .then((b) => setPlans(b.success ? b.data.plans : []))
      .catch(() => setPlans([]));
  }, []);

  if (plans === null || plans.length === 0) return null;

  return (
    <section id="plans" className="scroll-mt-14 bg-[#f6f5f0] py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <div className="mx-auto max-w-3xl px-1 text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-deep">Plans</p>
            <h2 className="hx-display mt-3 text-[2.5rem] text-[#10201b] text-balance sm:text-6xl">
              One shop, one price.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#5d6e68] text-pretty">
              Every plan starts with a {plans[0]?.trial_days ?? 14}-day free trial. Pay by bank transfer when
              you are ready — no card required.
            </p>
          </div>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:gap-5 lg:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.code} delay={i * 90}>
              <div className="hx-tile hx-tile-light flex h-full flex-col p-7 sm:p-8">
                <h3 className="hx-display text-2xl text-[#10201b]">{p.name}</h3>
                <p className="mt-2 min-h-10 text-sm leading-relaxed text-[#5d6e68]">{p.description}</p>
                <p className="g-metric mt-4 text-4xl text-[#10201b]">
                  {(p.price_monthly_cents / 100).toLocaleString("en-US")}
                  <span className="text-sm font-normal text-[#5d6e68]"> LKR/mo</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-[#3a4d47]">
                  <li>{p.max_branches === null ? "Unlimited branches" : `${p.max_branches} branch${p.max_branches === 1 ? "" : "es"}`}</li>
                  <li>{p.max_users === null ? "Unlimited users" : `${p.max_users} users`}</li>
                  <li>{p.features.length} modules included</li>
                </ul>
                <Link href="/signup" className="hx-btn hx-btn-dark mt-6 h-11 justify-center text-[15px]">
                  Start free trial
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
