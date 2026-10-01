import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { practicePay } from "@/lib/payments.functions";
import { errMsg, inr } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/pay/$orderId")({
  head: () => ({
    meta: [
      { title: "Pay for your order | QuickBite" },
      { name: "description", content: "Secure checkout for your QuickBite canteen order." },
      { property: "og:title", content: "Pay for your order | QuickBite" },
      { property: "og:description", content: "Secure checkout for your canteen order." },
    ],
  }),
  component: PayPage,
});

function PayPage() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pay = useServerFn(practicePay);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: o, isLoading } = useQuery({
    queryKey: ["orders", orderId, "pay"],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("*, order_items(*)").eq("id", orderId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="mx-auto mt-10 h-64 max-w-md animate-pulse rounded-3xl bg-muted" />;
  if (!o) return <p className="p-10 text-center text-muted-foreground">Order not found.</p>;

  const left = o.expires_at ? Math.max(0, new Date(o.expires_at).getTime() - now) : 0;
  const expired = o.status === "expired" || (o.status === "pending_payment" && left === 0);
  if (o.status !== "pending_payment" && !expired) {
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <p className="mb-4">This order is already paid.</p>
        <Button asChild><Link to="/orders/$orderId" params={{ orderId }}>Track order</Link></Button>
      </main>
    );
  }

  async function go(outcome: "success" | "failure") {
    setBusy(true);
    try {
      const r = await pay({ data: { orderId, outcome } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (r.result === "paid") {
        toast.success("Payment received — order sent to the kitchen");
        navigate({ to: "/orders/$orderId", params: { orderId } });
      } else if (r.result === "late_refunded") {
        toast.error("Payment arrived after the order expired. It has been refunded.");
      } else {
        toast.error("Payment failed. You can try again.");
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Lock className="size-4" /> Secure checkout</span>
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">Practice mode</span>
        </div>
        <p className="text-sm text-muted-foreground">Order #{o.order_number}</p>
        <p className="font-display text-4xl font-bold">{inr(o.total)}</p>
        <ul className="my-4 space-y-1 border-y py-3 text-sm">
          {o.order_items.map((i) => (
            <li key={i.id} className="flex justify-between"><span>{i.qty}× {i.item_name}</span><span>{inr(Number(i.unit_price) * i.qty)}</span></li>
          ))}
        </ul>
        {expired ? (
          <div className="space-y-3 text-center">
            <p className="rounded-xl bg-destructive/10 p-3 text-sm font-medium text-destructive">This order expired because it wasn't paid within 10 minutes.</p>
            <Button asChild className="w-full rounded-xl"><Link to="/menu">Back to menu</Link></Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">Pay within <span className="font-semibold text-foreground">{mm}:{ss}</span> to keep your order</p>
            <Button className="h-12 w-full rounded-xl text-base" disabled={busy} onClick={() => go("success")}>
              {busy ? "Processing…" : `Pay ${inr(o.total)}`}
            </Button>
            <Button variant="ghost" className="w-full text-sm" disabled={busy} onClick={() => go("failure")}>Simulate a failed payment</Button>
            <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> No real money is charged in practice mode.</p>
          </div>
        )}
      </div>
    </main>
  );
}
