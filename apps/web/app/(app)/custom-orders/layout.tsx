import { MANUFACTURING_PAGES, ModuleNav } from "@/components/module-nav";

export default function CustomOrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleNav label="Workshop" pages={MANUFACTURING_PAGES} />
      {children}
    </>
  );
}
