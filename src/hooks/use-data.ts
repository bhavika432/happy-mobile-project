import { useEffect, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return { user, ready };
}

export function useIsAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ["is-admin", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: userId!, _role: "admin" });
      return !!data;
    },
  });
}

export const menuQuery = queryOptions({
  queryKey: ["menu"],
  queryFn: async () => {
    const [cats, items] = await Promise.all([
      supabase.from("categories").select("*").order("display_order"),
      supabase.from("menu_items").select("*").order("name"),
    ]);
    if (cats.error) throw cats.error;
    if (items.error) throw items.error;
    return { categories: cats.data, items: items.data };
  },
});

export type MenuItem = Database["public"]["Tables"]["menu_items"]["Row"];

/** Keeps the menu live: any stock or price change refreshes every open menu within a second. */
export function useLiveMenu() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("menu")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, () =>
        qc.invalidateQueries({ queryKey: ["menu"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
  return useQuery(menuQuery);
}

/** Refreshes order data whenever an order visible to this user changes. */
export function useLiveOrders(channel: string, filter?: string, onInsert?: () => void) {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel(channel)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", ...(filter ? { filter } : {}) }, (p) => {
        if (p.eventType === "INSERT") onInsert?.();
        qc.invalidateQueries({ queryKey: ["orders"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, channel, filter]);
}
