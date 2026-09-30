import { ModuleNav, SALES_PAGES } from "@/components/module-nav";

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleNav label="Sales" pages={SALES_PAGES} />
      {children}
    </>
  );
}
