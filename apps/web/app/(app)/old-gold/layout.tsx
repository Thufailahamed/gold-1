import { ModuleNav, OLD_GOLD_PAGES } from "@/components/module-nav";

export default function OldGoldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleNav label="Old gold" pages={OLD_GOLD_PAGES} />
      {children}
    </>
  );
}
