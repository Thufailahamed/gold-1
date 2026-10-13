import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GoldOS Platform",
  description: "SaaS operator console for GoldOS",
  robots: { index: false, follow: false },
};

export default function PlatformRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
