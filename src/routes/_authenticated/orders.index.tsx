import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLiveOrders } from "@/hooks/use-data";
import { ACTIVE_STATUSES, inr, STATUS_LABEL, statusTone, time } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/orders/")({
  head: () => ({
    meta: [
      { title: "My orders | QuickBite" },
      { name: "description", content: "Track your current canteen order and see past orders." },
      { property: "og:title", content: "My orders | QuickBite" },
      { property: "og:description", content: "Track your current canteen order and see past orders." },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const { user } = Route.useRouteContext();
  useLiveOrders(`user:${user.id}`, `user_id=eq.${user.id}`);
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(item_name, qty)")
        .eq("user_id", user.id)
        .order("placed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const active = (data ?? []).filter((o) => ACTIVE_STATUSES.includes(o.status));
  const past = (data ?? []).filter((o) => !ACTIVE_STATUSES.includes(o.status));

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-3xl font-bold">My orders</h1>
      {isLoading ? (
        <div className="mt-6 h-24 animate-pulse rounded-2xl bg-muted" />
      ) : !data?.length ? (
        <div className="mt-10 text-center">
          <p className="text-muted-foreground">No orders yet.</p>
          <Button asChild className="mt-4 rounded-full"><Link to="/menu">Browse the menu</Link></Button>
        </div>
      ) : (
        <>
          {active.length > 0 && <Section title="In progress" orders={active} />}
          {past.length > 0 && <Section title="Past orders" orders={past} />}
        </>
      )}
    </main>
  );
}

type O = { id: string; order_number: number; status: import("@/lib/format").OrderStatus; total: number; placed_at: string; est_pickup_at: string; order_items: { item_name: string; qty: number }[] };

function Section({ title, orders }: { title: string; orders: O[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="space-y-2">
        {orders.map((o) => (
          <Link
            key={o.id}
            to="/orders/$orderId"
            params={{ orderId: o.id }}
            className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-display font-bold">#{o.order_number}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(o.status)}`}>{STATUS_LABEL[o.status]}</span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {o.order_items.map((i) => `${i.qty}× ${i.item_name}`).join(", ")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(o.placed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {time(o.placed_at)} · {inr(o.total)}
              </p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}
