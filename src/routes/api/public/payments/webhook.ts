import { createFileRoute } from "@tanstack/react-router";
import { processPaymentWebhook } from "@/lib/payments.server";

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const r = await processPaymentWebhook(body, request.headers.get("x-signature"));
        return Response.json({ result: r.result }, { status: r.status });
      },
    },
  },
});
