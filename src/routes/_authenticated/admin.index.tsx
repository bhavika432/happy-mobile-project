import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLiveOrders } from "@/hooks/use-data";
import { errMsg, inr, time, type OrderStatus } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: Board,
});

const COLUMNS: { status: OrderStatus; title: string; next?: { to: OrderStatus; label: string }; alt?: { to: OrderStatus; label: string } }[] = [
  { status: "paid", title: "New", next: { to: "accepted", label: "Accept" }, alt: { to: "rejected", label: "Reject" } },
  { status: "accepted", title: "Accepted", next: { to: "preparing", label: "Start cooking" }, alt: { to: "cancelled", label: "Cancel" } },
  { status: "preparing", title: "Preparing", next: { to: "ready", label: "Mark ready" } },
  { status: "ready", title: "Ready", next: { to: "collected", label: "Collected" } },
];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.3, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* audio not available */
  }
}

function Board() {
  const [sound, setSound] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const qc = useQueryClient();

  useLiveOrders("admin", undefined, () => {
    toast("New order received");
    if (soundRef.current) beep();
  });

  const { data } = useQuery({
    queryKey: ["orders", "board"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(item_name, qty)")
        .in("status", ["paid", "accepted", "preparing", "ready"])
        .order("placed_at");
      if (error) throw error;
      const ids = [...new Set(data.map((o) => o.user_id))];
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, full_name, phone").in("id", ids)
        : { data: [] };
      const byId = new Map((profs ?? []).map((p) => [p.id, p]));
      return data.map((o) => ({ ...o, profiles: byId.get(o.user_id) ?? null }));
    },
  });

  async function move(id: string, to: OrderStatus) {
    const { error } = await supabase.rpc("set_order_status", { _order_id: id, _to: to });
    if (error) toast.error(errMsg(error));
    qc.invalidateQueries({ queryKey: ["orders"] });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Live orders</h1>
        <Button
          variant={sound ? "default" : "outline"}
          className="rounded-full"
          onClick={() => {
            setSound(!sound);
            if (!sound) beep();
          }}
        >
          {sound ? <BellRing className="mr-2 size-4" /> : <BellOff className="mr-2 size-4" />}
          Sound {sound ? "on" : "off"}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => {
          const list = (data ?? []).filter((o) => o.status === c.status);
          return (
            <section key={c.status} className="rounded-3xl bg-secondary/60 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 font-display text-lg font-bold">
                {c.title}
                <span className="rounded-full bg-card px-2.5 text-sm">{list.length}</span>
              </h2>
              <div className="space-y-3">
                {list.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing here</p>}
                {list.map((o) => (
                  <article key={o.id} className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-xl font-bold">#{o.order_number}</span>
                      <span className="text-xs text-muted-foreground">{time(o.placed_at)}</span>
                    </div>
                    {o.profiles?.full_name && <p className="text-sm text-muted-foreground">{o.profiles.full_name}</p>}
                    <ul className="my-2 space-y-0.5 text-sm">
                      {o.order_items.map((i, k) => (
                        <li key={k}><span className="font-semibold">{i.qty}×</span> {i.item_name}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">{inr(o.total)} · pickup {time(o.est_pickup_at)}</p>
                    <div className="mt-3 flex gap-2">
                      {c.next && <Button size="sm" className="flex-1 rounded-full" onClick={() => move(o.id, c.next!.to)}>{c.next.label}</Button>}
                      {c.alt && <Button size="sm" variant="outline" className="rounded-full" onClick={() => move(o.id, c.alt!.to)}>{c.alt.label}</Button>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
