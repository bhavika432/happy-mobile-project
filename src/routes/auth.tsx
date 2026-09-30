import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Phone, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in | QuickBite" },
      { name: "description", content: "Sign in to QuickBite to order canteen food without the queue." },
      { property: "og:title", content: "Sign in | QuickBite" },
      { property: "og:description", content: "Sign in to order canteen food without the queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/menu", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/menu", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const fullPhone = () => {
    const d = phone.replace(/\D/g, "");
    return d.length === 10 ? `+91${d}` : `+${d}`;
  };

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(errMsg(r.error));
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) { toast.error("Enter a valid mobile number"); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone() });
    setBusy(false);
    if (error) { toast.error(errMsg(error)); return; }
    setSent(true);
    toast.success("Code sent by SMS");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone: fullPhone(), token: code.trim(), type: "sms" });
    setBusy(false);
    if (error) toast.error(errMsg(error));
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-7" />
          </span>
          <h1 className="mt-4 text-3xl font-bold">Welcome to QuickBite</h1>
          <p className="mt-1 text-muted-foreground">Skip the canteen queue.</p>
        </div>
        <div className="space-y-4 rounded-3xl border bg-card p-6">
          <Button variant="outline" className="h-12 w-full rounded-xl text-base" onClick={google}>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          {!sent ? (
            <form onSubmit={sendCode} className="space-y-3">
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input inputMode="tel" placeholder="Mobile number" value={phone} maxLength={16} onChange={(e) => setPhone(e.target.value)} className="h-12 rounded-xl pl-9" />
              </div>
              <Button className="h-12 w-full rounded-xl" disabled={busy}>{busy ? "Sending…" : "Send code"}</Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              <Input inputMode="numeric" placeholder="6-digit code" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} className="h-12 rounded-xl text-center text-lg tracking-widest" />
              <Button className="h-12 w-full rounded-xl" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Verify & sign in"}</Button>
              <button type="button" className="w-full text-sm text-muted-foreground" onClick={() => setSent(false)}>Use a different number</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
