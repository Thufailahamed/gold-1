import { GOLD_PAGES, ModuleNav } from "@/components/module-nav";

export default function GoldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleNav label="Gold vault" pages={GOLD_PAGES} />
      {children}
    </>
  );
}
