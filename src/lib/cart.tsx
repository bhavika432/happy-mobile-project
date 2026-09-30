import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartLine = { menu_item_id: string; qty: number };

type CartCtx = {
  lines: CartLine[];
  count: number;
  qtyOf: (id: string) => number;
  add: (id: string) => void;
  remove: (id: string) => void;
  drop: (id: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "quickbite-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines, loaded]);

  const value = useMemo<CartCtx>(
    () => ({
      lines,
      count: lines.reduce((a, l) => a + l.qty, 0),
      qtyOf: (id) => lines.find((l) => l.menu_item_id === id)?.qty ?? 0,
      add: (id) =>
        setLines((ls) => {
          const f = ls.find((l) => l.menu_item_id === id);
          if (f) return ls.map((l) => (l.menu_item_id === id ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
          return [...ls, { menu_item_id: id, qty: 1 }];
        }),
      remove: (id) =>
        setLines((ls) =>
          ls.flatMap((l) => (l.menu_item_id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l])),
        ),
      drop: (id) => setLines((ls) => ls.filter((l) => l.menu_item_id !== id)),
      clear: () => setLines([]),
    }),
    [lines],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}
