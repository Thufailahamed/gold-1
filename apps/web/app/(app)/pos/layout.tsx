import { ModuleNav, SALES_PAGES } from "@/components/module-nav";

// POS lives at /pos rather than under /sales, so it opts into the sales nav here.
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleNav label="Sales" pages={SALES_PAGES} />
      {children}
    </>
  );
}
