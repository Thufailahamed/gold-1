"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast, Toaster } from "sonner";
import { loginSchema, type LoginInput } from "@goldos/shared";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setPending(true);
    try {
      await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify(values) });
      toast.success("Welcome back");
      router.push("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <Toaster richColors />
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Gold<span className="text-gold">OS</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500">Sign in to your branch</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              {...register("email")}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              {...register("password")}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
