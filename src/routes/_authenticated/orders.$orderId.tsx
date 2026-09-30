import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLiveOrders } from "@/hooks/use-data";
import { CUSTOMER_STEPS, inr, STATUS_LABEL, statusTone, time } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Order status | QuickBite" },
      { name: "description", content: "Live status, prep time and pickup time for your canteen order." },
      { property: "og:title", content: "Order status | QuickBite" },
      { property: "og:description", content: "Live status and pickup time for your order." },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { orderId } = Route.useParams();
  const { user } = Route.useRouteContext();
  useLiveOrders(`user:${user.id}:order`, `id=eq.${orderId}`);
  const { data: o, isLoading } = useQuery({
    queryKey: ["orders", orderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("*, order_items(*)").eq("id", orderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="mx-auto mt-10 h-64 max-w-xl animate-pulse rounded-3xl bg-muted" />;
  if (!o) return <p className="p-10 text-center text-muted-foreground">Order not found.</p>;

  const stepIdx = CUSTOMER_STEPS.indexOf(o.status);
  const ended = stepIdx === -1;

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All orders
      </Link>

      <div className={`rounded-3xl p-6 ${o.status === "ready" ? "bg-success text-success-foreground" : "bg-foreground text-background"}`}>
        <p className="text-sm opacity-80">Order #{o.order_number}</p>
        <h1 className="mt-1 text-3xl font-bold">{STATUS_LABEL[o.status]}</h1>
        {!ended && o.status !== "collected" && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-background/10 p-3">
              <p className="text-xs opacity-80">Prep time</p>
              <p className="font-display text-2xl font-bold">~{o.est_prep_minutes} min</p>
            </div>
            <div className="rounded-2xl bg-background/10 p-3">
              <p className="text-xs opacity-80">{o.status === "ready" ? "Ready since" : "Pick up at"}</p>
              <p className="font-display text-2xl font-bold">{time(o.status === "ready" && o.ready_at ? o.ready_at : o.est_pickup_at)}</p>
            </div>
          </div>
        )}
        {o.status === "ready" && <p className="mt-4 font-medium">Head to the counter and show order #{o.order_number}.</p>}
      </div>

      {!ended ? (
        <ol className="mt-6 space-y-0">
          {CUSTOMER_STEPS.map((s, i) => {
            const done = i <= stepIdx;
            return (
              <li key={s} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <span className={`grid size-7 place-items-center rounded-full border-2 ${done ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
                    {done && <Check className="size-4" />}
                  </span>
                  {i < CUSTOMER_STEPS.length - 1 && <span className={`h-8 w-0.5 ${i < stepIdx ? "bg-primary" : "bg-border"}`} />}
                </div>
                <p className={`pt-0.5 font-medium ${done ? "" : "text-muted-foreground"}`}>{STATUS_LABEL[s]}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={`mt-6 rounded-xl p-4 text-sm font-medium ${statusTone(o.status)}`}>
          This order was {STATUS_LABEL[o.status].toLowerCase()}. Please speak to the counter staff if you have questions.
        </p>
      )}

      <div className="mt-6 rounded-2xl border bg-card p-4">
        {o.order_items.map((i) => (
          <div key={i.id} className="flex justify-between py-1.5 text-sm">
            <span>{i.qty}× {i.item_name}</span>
            <span>{inr(Number(i.unit_price) * i.qty)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t pt-2 font-bold">
          <span>Total</span>
          <span>{inr(o.total)}</span>
        </div>
      </div>
    </main>
  );
}
