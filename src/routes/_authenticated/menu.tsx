import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLiveMenu, type MenuItem } from "@/hooks/use-data";
import { useCart } from "@/lib/cart";
import { errMsg, inr, time } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/menu")({
  validateSearch: (s: Record<string, unknown>): { cart?: boolean } => (s.cart ? { cart: true } : {}),
  head: () => ({
    meta: [
      { title: "Menu | QuickBite" },
      { name: "description", content: "Browse today's canteen menu, see what's in stock, and order ahead." },
      { property: "og:title", content: "Menu | QuickBite" },
      { property: "og:description", content: "Browse today's canteen menu and order ahead." },
    ],
  }),
  component: MenuPage,
});

function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      title={veg ? "Veg" : "Non-veg"}
      className={`grid size-4 shrink-0 place-items-center rounded-sm border-2 ${veg ? "border-success" : "border-destructive"}`}
    >
      <span className={`size-1.5 rounded-full ${veg ? "bg-success" : "bg-destructive"}`} />
    </span>
  );
}

function Stepper({ id, disabled }: { id: string; disabled?: boolean }) {
  const cart = useCart();
  const q = cart.qtyOf(id);
  if (q === 0)
    return (
      <Button size="sm" disabled={disabled} onClick={() => cart.add(id)} className="rounded-full px-4">
        Add
      </Button>
    );
  return (
    <div className="flex items-center gap-1 rounded-full bg-primary text-primary-foreground">
      <button className="grid size-8 place-items-center" onClick={() => cart.remove(id)} aria-label="Remove one">
        <Minus className="size-3.5" />
      </button>
      <span className="w-5 text-center text-sm font-bold">{q}</span>
      <button className="grid size-8 place-items-center disabled:opacity-50" disabled={disabled} onClick={() => cart.add(id)} aria-label="Add one">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function MenuPage() {
  const { data, isLoading, error } = useLiveMenu();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | "all">("all");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/menu" });
  const cart = useCart();

  const byId = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (cat === "all" || i.category_id === cat) &&
        (!term || i.name.toLowerCase().includes(term) || (i.description ?? "").toLowerCase().includes(term)),
    );
  }, [data, q, cat]);

  const subtotal = cart.lines.reduce((a, l) => {
    const it = byId.get(l.menu_item_id);
    return it?.is_available ? a + Number(it.price) * l.qty : a;
  }, 0);

  if (error) return <p className="p-8 text-center text-destructive">Couldn't load the menu. Please refresh.</p>;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-32 pt-6">
      <div className="mb-5">
        <h1 className="text-3xl font-bold md:text-4xl">What are you having today?</h1>
        <p className="mt-1 text-muted-foreground">Order now and pick up when it's ready — no queue.</p>
      </div>

      <div className="sticky top-14 z-20 -mx-4 space-y-3 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dosa, biryani, chai…" className="h-11 rounded-full bg-card pl-9" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: "all", name: "All" }, ...(data?.categories ?? [])].map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                cat === c.id ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-secondary"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">No dishes match “{q}”.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
        </div>
      )}

      {cart.count > 0 && !search.cart && (
        <div className="fixed inset-x-0 bottom-4 z-30 px-4">
          <button
            onClick={() => navigate({ search: { cart: true } })}
            className="mx-auto flex w-full max-w-md items-center justify-between rounded-2xl bg-foreground px-5 py-4 text-background shadow-xl"
          >
            <span className="flex items-center gap-2 font-semibold">
              <ShoppingBag className="size-5" /> {cart.count} item{cart.count > 1 ? "s" : ""}
            </span>
            <span className="font-bold">{inr(subtotal)} · View cart</span>
          </button>
        </div>
      )}

      <CartSheet open={!!search.cart} onOpenChange={(o) => navigate({ search: o ? { cart: true } : {} })} byId={byId} />
    </main>
  );
}

function ItemCard({ item }: { item: MenuItem }) {
  const out = !item.is_available;
  return (
    <div className={`flex gap-3 rounded-2xl border bg-card p-4 transition ${out ? "opacity-60" : "hover:shadow-md"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <VegMark veg={item.is_veg} />
          <h3 className="truncate font-semibold">{item.name}</h3>
        </div>
        {item.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>}
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span className="font-bold">{inr(item.price)}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3.5" /> {item.prep_minutes} min
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between">
        {out ? (
          <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">Out of stock</span>
        ) : (
          <span />
        )}
        <Stepper id={item.id} disabled={out} />
      </div>
    </div>
  );
}

function CartSheet({
  open,
  onOpenChange,
  byId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  byId: Map<string, MenuItem>;
}) {
  const cart = useCart();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [placing, setPlacing] = useState(false);
  const available = cart.lines.filter((l) => byId.get(l.menu_item_id)?.is_available);
  const blocked = cart.lines.filter((l) => !byId.get(l.menu_item_id)?.is_available);

  const quote = useQuery({
    queryKey: ["quote", available],
    enabled: open && available.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("quote_order", { _items: available });
      if (error) throw error;
      return data as { total: number; est_prep_minutes: number; est_pickup_at: string; unavailable: string[] };
    },
  });

  async function place() {
    setPlacing(true);
    const { data, error } = await supabase.rpc("place_order", { _items: available });
    setPlacing(false);
    if (error) {
      toast.error(errMsg(error));
      qc.invalidateQueries({ queryKey: ["menu"] });
      return;
    }
    cart.clear();
    qc.invalidateQueries({ queryKey: ["orders"] });
    toast.success("Order placed!");
    navigate({ to: "/orders/$orderId", params: { orderId: data as string } });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 bg-background p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5">
          <SheetTitle className="font-display text-2xl">Your cart</SheetTitle>
        </SheetHeader>
        {cart.lines.length === 0 ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-muted-foreground">Your cart is empty.</div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {blocked.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Some items just went out of stock and won't be included.
                </div>
              )}
              {cart.lines.map((l) => {
                const it = byId.get(l.menu_item_id);
                if (!it) return null;
                const out = !it.is_available;
                return (
                  <div key={l.menu_item_id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium ${out ? "line-through opacity-60" : ""}`}>{it.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {out ? <span className="font-semibold text-destructive">Out of stock</span> : inr(Number(it.price) * l.qty)}
                      </p>
                    </div>
                    {out ? (
                      <Button variant="ghost" size="icon" onClick={() => cart.drop(l.menu_item_id)} aria-label="Remove">
                        <Trash2 className="size-4" />
                      </Button>
                    ) : (
                      <Stepper id={l.menu_item_id} />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="space-y-3 border-t bg-card p-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-muted-foreground">Prep time</p>
                  <p className="font-display text-xl font-bold">{quote.data ? `~${quote.data.est_prep_minutes} min` : "—"}</p>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-muted-foreground">Pick up at</p>
                  <p className="font-display text-xl font-bold">{quote.data ? time(quote.data.est_pickup_at) : "—"}</p>
                </div>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{quote.data ? inr(quote.data.total) : "—"}</span>
              </div>
              <Button className="h-12 w-full rounded-xl text-base" disabled={placing || available.length === 0 || !quote.data} onClick={place}>
                {placing ? "Placing order…" : "Place order"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">Pay at the counter for now — in-app payment is coming soon.</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
