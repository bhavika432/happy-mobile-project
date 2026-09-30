import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, Clock, PackageX, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QuickBite: Order, Pay & Track Canteen Food in Real Time" },
      { name: "description", content: "Order canteen food without the queue. See prep time, pickup time and live order status in one app." },
      { property: "og:title", content: "QuickBite: Order Canteen Food Without the Queue" },
      { property: "og:description", content: "See prep time, pickup time and live order status in one app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const features = [
    { icon: Clock, title: "Know your pickup time", text: "Estimates reflect how busy the kitchen is right now." },
    { icon: BellRing, title: "Live order status", text: "Watch your order move from accepted to ready." },
    { icon: PackageX, title: "No surprises", text: "Out-of-stock dishes are marked the moment they run out." },
  ];
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground"><UtensilsCrossed className="size-4" /></span>
          QuickBite
        </span>
        <Button asChild variant="outline" className="rounded-full"><Link to="/auth">Sign in</Link></Button>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:pt-20">
        <p className="mb-4 inline-block rounded-full bg-accent px-3 py-1 text-sm font-semibold text-accent-foreground">Lunch rush? Not your problem.</p>
        <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.05] md:text-7xl">
          Order canteen food <span className="text-primary">without the queue.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Browse the menu, place your order, and walk over only when it's nearly ready.
        </p>
        <Button asChild size="lg" className="mt-8 h-14 rounded-full px-8 text-base"><Link to="/menu">See today's menu</Link></Button>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 md:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-3xl border bg-card p-6">
            <f.icon className="size-6 text-primary" />
            <h2 className="mt-4 text-xl font-bold">{f.title}</h2>
            <p className="mt-1 text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
