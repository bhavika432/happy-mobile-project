import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Practice gateway: stands in for a hosted checkout. It sends a signed event
 * through the same webhook path a real gateway would use, so PAID is still
 * only ever set by a verified webhook.
 */
export const practicePay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid(), outcome: z.enum(["success", "failure"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("orders")
      .select("id, total, status, user_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error || !order || order.user_id !== context.userId) throw new Error("Order not found");
    if (order.status !== "pending_payment") throw new Error("This order is no longer awaiting payment");

    const { processPaymentWebhook, signPayload } = await import("./payments.server");
    const ref = `prac_${crypto.randomUUID().slice(0, 12)}`;
    const body = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      type: data.outcome === "success" ? "payment.succeeded" : "payment.failed",
      data: { order_id: order.id, gateway_ref: ref, amount: Number(order.total), method: "practice_upi" },
    });
    const r = await processPaymentWebhook(body, signPayload(body));
    return { result: r.result };
  });
