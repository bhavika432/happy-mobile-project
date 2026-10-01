import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Event = z.object({
  id: z.string().min(8).max(100),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  data: z.object({
    order_id: z.string().uuid(),
    gateway_ref: z.string().min(4).max(100),
    amount: z.number().nonnegative(),
    method: z.string().max(40),
  }),
});

export function signPayload(body: string) {
  return createHmac("sha256", process.env["PAYMENT_WEBHOOK_SECRET"]!).update(body).digest("hex");
}

/** Verifies the gateway signature, then applies the event once (duplicates are ignored). */
export async function processPaymentWebhook(body: string, signature: string | null) {
  const secret = process.env["PAYMENT_WEBHOOK_SECRET"];
  if (!secret) return { status: 500, result: "not_configured" };
  const expected = Buffer.from(signPayload(body));
  const got = Buffer.from(signature ?? "");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { status: 401, result: "bad_signature" };

  const parsed = Event.safeParse(JSON.parse(body));
  if (!parsed.success) return { status: 400, result: "bad_payload" };
  const e = parsed.data;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("apply_payment_event", {
    _event_id: e.id,
    _order_id: e.data.order_id,
    _gateway_ref: e.data.gateway_ref,
    _amount: e.data.amount,
    _status: e.type === "payment.succeeded" ? "succeeded" : "failed",
    _method: e.data.method,
    _payload: e,
  });
  if (error) {
    console.error(error);
    return { status: 500, result: "error" };
  }
  return { status: 200, result: data as string };
}
