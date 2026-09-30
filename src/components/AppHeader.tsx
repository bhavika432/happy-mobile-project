import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChefHat, LogOut, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin, useUser } from "@/hooks/use-data";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const { user } = useUser();
  const { data: isAdmin } = useIsAdmin(user?.id);
  const { count } = useCart();
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const link = "rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground";
  const active = { className: "bg-secondary text-foreground" };

  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link to="/menu" className="mr-2 flex items-center gap-2 font-display text-lg font-bold">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          QuickBite
        </Link>
        <nav className="flex items-center gap-1">
          <Link to="/menu" className={link} activeProps={active}>Menu</Link>
          <Link to="/orders" className={link} activeProps={active}>My orders</Link>
          {isAdmin && (
            <Link to="/admin" className={link} activeProps={active}>
              <ChefHat className="mr-1 inline size-4" />Kitchen
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link to="/menu" search={{ cart: true }} className="relative rounded-full p-2 hover:bg-secondary" aria-label="Cart">
            <ShoppingBag className="size-5" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                {count}
              </span>
            )}
          </Link>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
