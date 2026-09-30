import { ModuleNav, PURCHASING_PAGES } from "@/components/module-nav";

export default function PurchasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleNav label="Purchasing" pages={PURCHASING_PAGES} />
      {children}
    </>
  );
}
