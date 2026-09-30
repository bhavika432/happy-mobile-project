import type { Database } from "@/integrations/supabase/types";

export type OrderStatus = Database["public"]["Enums"]["order_status"];

export const inr = (n: number | string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n));

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Order placed",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready for pickup",
  collected: "Collected",
  expired: "Expired",
  rejected: "Rejected",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const CUSTOMER_STEPS: OrderStatus[] = ["paid", "accepted", "preparing", "ready", "collected"];

export const ACTIVE_STATUSES: OrderStatus[] = ["paid", "accepted", "preparing", "ready"];

export function statusTone(s: OrderStatus) {
  if (s === "ready") return "bg-success text-success-foreground";
  if (s === "collected") return "bg-muted text-muted-foreground";
  if (["rejected", "cancelled", "expired", "refunded"].includes(s)) return "bg-destructive/10 text-destructive";
  if (s === "paid") return "bg-accent text-accent-foreground";
  return "bg-primary/15 text-primary";
}

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
