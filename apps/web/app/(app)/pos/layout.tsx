// POS runs as a full-screen terminal over the console shell; the page draws
// its own top bar with the sales nav, so this layout adds nothing around it.
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
