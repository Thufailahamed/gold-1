import type { Metadata } from "next";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "GoldOS Platform",
  description: "SaaS operator console for GoldOS",
  robots: { index: false, follow: false },
};

export default function PlatformRootLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
