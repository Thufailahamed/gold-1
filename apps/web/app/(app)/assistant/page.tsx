import { redirect } from "next/navigation";

/** The assistant lives in the Accounts suite now; old links keep working. */
export default async function AssistantRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") params.set(k, v);
  const qs = params.toString();
  redirect(`/accounts/assistant${qs ? `?${qs}` : ""}`);
}
