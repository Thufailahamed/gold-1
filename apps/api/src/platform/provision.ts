/**
 * In-worker tenant provisioning (Task 4 implements the Cloudflare calls).
 * Task 3 owns the consumer side: `public.ts` signup and `app.ts` wiring use
 * this interface, so the real implementation lands without touching them.
 */
export type ProvisionInput = {
  tenantId: string;
  slug: string;
  shopName: string;
  ownerName: string;
  ownerEmail: string;
  /** Plaintext owner password — the provisioner hashes it into the seed. Never stored. */
  password: string;
  country: string;
  currency: string;
  timezone: string;
};

export type ProvisionResult = { d1Id: string; d1Name: string };

export type Provisioner = (pdb: D1Database, input: ProvisionInput) => Promise<ProvisionResult>;

/** Placeholder wiring until Task 4 lands the Cloudflare implementation. */
export const unconfiguredProvisioner: Provisioner = async () => {
  throw Object.assign(new Error("Automatic provisioning is not ready yet"), { code: "PROVISIONING", status: 503 });
};
