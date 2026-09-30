import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.rpc("has_role", { _user_id: context.user.id, _role: "admin" });
    if (!data) throw redirect({ to: "/menu" });
  },
  head: () => ({
    meta: [
      { title: "Kitchen | QuickBite" },
      { name: "description", content: "Staff dashboard for incoming canteen orders and stock." },
      { property: "og:title", content: "Kitchen | QuickBite" },
      { property: "og:description", content: "Staff dashboard for canteen orders and stock." },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const tab = "rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground";
  const on = { className: "bg-foreground text-background" };
  return (
    <div className="mx-auto max-w-7xl px-4 py-5">
      <div className="mb-4 flex gap-2">
        <Link to="/admin" activeOptions={{ exact: true }} className={tab} activeProps={on}>Order board</Link>
        <Link to="/admin/menu" className={tab} activeProps={on}>Menu & stock</Link>
      </div>
      <Outlet />
    </div>
  );
}
