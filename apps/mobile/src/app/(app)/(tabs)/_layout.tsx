import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";

const APPROVER_PERMS = ["sales:approve", "oldgold:approve", "mfg:approve", "users:approve", "branches:approve", "accounts:manage", "gold:manage", "products:cancel", "purchases:cancel"];

/**
 * The five native tabs (iOS tab bar with Liquid Glass / Material bottom nav):
 * Home · Sell · Scan · Catalog · More. Tabs a role cannot use are hidden;
 * permissions are known before this mounts, so the set is stable.
 */
export default function TabsLayout() {
  const { c } = useTheme();
  const { can, canAny, me } = useSession();
  const canSell = canAny(["sales:view", "sales:create"]);
  const canCatalog = can("products:view");
  const approver = canAny(APPROVER_PERMS);
  const scope = can("branches:manage") ? "" : me?.branchIds[0] ? `&branchId=${encodeURIComponent(me.branchIds[0])}` : null;
  const pending = useQuery({
    queryKey: ["tabs", "approvals", scope],
    queryFn: () => api<{ total: number }>(`/api/v1/approvals?status=PENDING&limit=1${scope ?? ""}`),
    enabled: approver && scope !== null,
    refetchInterval: 60_000,
  });
  const badge = pending.data?.total ? (pending.data.total > 99 ? "99+" : String(pending.data.total)) : undefined;

  return (
    <NativeTabs tintColor={c.gold} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sell" hidden={!canSell}>
        <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} md="point_of_sale" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="scanner">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="barcode.viewfinder" md="barcode_scanner" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="catalog" hidden={!canCatalog}>
        <NativeTabs.Trigger.Label>Catalog</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "diamond", selected: "diamond.fill" }} md="diamond" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} md="apps" />
        {badge ? <NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
