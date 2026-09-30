import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLiveMenu, type MenuItem } from "@/hooks/use-data";
import { errMsg, inr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/menu")({
  component: MenuManager,
});

type Draft = { id?: string; name: string; description: string; price: string; prep_minutes: string; category_id: string; is_veg: boolean };

function MenuManager() {
  const { data } = useLiveMenu();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  async function toggle(i: MenuItem) {
    qc.setQueryData(["menu"], (d: typeof data) =>
      d ? { ...d, items: d.items.map((x) => (x.id === i.id ? { ...x, is_available: !i.is_available } : x)) } : d,
    );
    const { error } = await supabase.from("menu_items").update({ is_available: !i.is_available }).eq("id", i.id);
    if (error) toast.error(errMsg(error));
    qc.invalidateQueries({ queryKey: ["menu"] });
  }

  async function save() {
    if (!draft) return;
    const price = Number(draft.price);
    const prep = Number(draft.prep_minutes);
    if (!draft.name.trim() || !draft.category_id || !(price >= 0) || !(prep > 0)) {
      toast.error("Please fill in name, category, price and prep time");
      return;
    }
    const row = { name: draft.name.trim(), description: draft.description.trim() || null, price, prep_minutes: prep, category_id: draft.category_id, is_veg: draft.is_veg };
    const { error } = draft.id
      ? await supabase.from("menu_items").update(row).eq("id", draft.id)
      : await supabase.from("menu_items").insert(row);
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    toast.success("Saved");
    setDraft(null);
    qc.invalidateQueries({ queryKey: ["menu"] });
  }

  async function del(i: MenuItem) {
    if (!confirm(`Delete ${i.name}?`)) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", i.id);
    if (error) toast.error(errMsg(error));
    qc.invalidateQueries({ queryKey: ["menu"] });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Menu & stock</h1>
        <Button
          className="rounded-full"
          onClick={() => setDraft({ name: "", description: "", price: "", prep_minutes: "5", category_id: data?.categories[0]?.id ?? "", is_veg: true })}
        >
          <Plus className="mr-1 size-4" /> Add dish
        </Button>
      </div>
      <div className="space-y-6">
        {data?.categories.map((c) => (
          <section key={c.id}>
            <h2 className="mb-2 font-display text-xl font-bold">{c.name}</h2>
            <div className="divide-y rounded-2xl border bg-card">
              {data.items.filter((i) => i.category_id === c.id).map((i) => (
                <div key={i.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${i.is_available ? "" : "text-muted-foreground line-through"}`}>{i.name}</p>
                    <p className="text-sm text-muted-foreground">{inr(i.price)} · {i.prep_minutes} min</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className={i.is_available ? "text-success" : "text-destructive"}>{i.is_available ? "In stock" : "Out"}</span>
                    <Switch checked={i.is_available} onCheckedChange={() => toggle(i)} />
                  </label>
                  <Button variant="ghost" size="icon" onClick={() => setDraft({ id: i.id, name: i.name, description: i.description ?? "", price: String(i.price), prep_minutes: String(i.prep_minutes), category_id: i.category_id, is_veg: i.is_veg })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => del(i)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{draft?.id ? "Edit dish" : "Add dish"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div><Label>Name</Label><Input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Price (₹)</Label><Input type="number" min={0} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></div>
                <div><Label>Prep time (min)</Label><Input type="number" min={1} value={draft.prep_minutes} onChange={(e) => setDraft({ ...draft, prep_minutes: e.target.value })} /></div>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={draft.category_id} onValueChange={(v) => setDraft({ ...draft, category_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{data?.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={draft.is_veg} onCheckedChange={(v) => setDraft({ ...draft, is_veg: v })} /> Vegetarian</label>
            </div>
          )}
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
