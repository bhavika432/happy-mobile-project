ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS base_prep_minutes integer NOT NULL DEFAULT 10;
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idem ON public.orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS item_status text NOT NULL DEFAULT 'ok';

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  gateway_ref text UNIQUE,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'created',
  method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_order_uniq ON public.payments(order_id);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own or admin payments" ON public.payments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  order_item_id uuid REFERENCES public.order_items(id),
  amount numeric NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'processed',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refunds_item_uniq ON public.refunds(order_item_id) WHERE order_item_id IS NOT NULL;
CREATE UNIQUE INDEX refunds_full_uniq ON public.refunds(order_id) WHERE order_item_id IS NULL;
GRANT SELECT ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own or admin refunds" ON public.refunds FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

CREATE TABLE public.webhook_events (
  event_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.payment_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id),
  kind text NOT NULL,
  detail text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_issues_open ON public.payment_issues(order_id, kind) WHERE NOT resolved;
GRANT SELECT, UPDATE ON public.payment_issues TO authenticated;
GRANT ALL ON public.payment_issues TO service_role;
ALTER TABLE public.payment_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin issues read" ON public.payment_issues FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin issues update" ON public.payment_issues FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Recalculate prep/pickup for every open order based on its place in the queue.
CREATE OR REPLACE FUNCTION public.recalc_open_etas() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare s public.canteen_settings; r record; t time := (now() at time zone 'Asia/Kolkata')::time; buf int; prep int;
begin
  select * into s from public.canteen_settings where id=1;
  buf := ceil(s.base_buffer_minutes * (case when t between s.peak_start and s.peak_end then s.peak_multiplier else 1 end));
  for r in select id, base_prep_minutes, placed_at, (row_number() over (order by placed_at)) - 1 as ahead
           from public.orders where status in ('paid','accepted','preparing') loop
    prep := r.base_prep_minutes + ceil((r.ahead * s.avg_minutes_per_order)::numeric / greatest(s.kitchen_capacity,1));
    update public.orders set est_prep_minutes = prep,
      est_pickup_at = greatest(r.placed_at + make_interval(mins => prep + buf), now() + interval '2 minutes')
    where id = r.id and (est_prep_minutes is distinct from prep or abs(extract(epoch from est_pickup_at - greatest(r.placed_at + make_interval(mins => prep + buf), now() + interval '2 minutes'))) > 30);
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.trg_recalc_etas() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin perform public.recalc_open_etas(); return null; end $$;
CREATE TRIGGER orders_status_recalc AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_recalc_etas();

CREATE OR REPLACE FUNCTION public.trg_settings_recalc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin perform public.recalc_open_etas(); return null; end $$;
CREATE TRIGGER settings_recalc AFTER UPDATE ON public.canteen_settings
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_settings_recalc();

-- Create an unpaid order + payment intent. Idempotent per (user, key).
CREATE OR REPLACE FUNCTION public.create_checkout(_items jsonb, _idem text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare uid uuid := auth.uid(); total numeric := 0; base int := 0; r record; e record; est record; oid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if _idem is null or length(_idem) < 8 then raise exception 'Missing checkout key'; end if;
  select id into oid from public.orders where user_id = uid and idempotency_key = _idem;
  if found then return oid; end if;
  if jsonb_array_length(_items) = 0 then raise exception 'Cart is empty'; end if;
  for r in select (x->>'menu_item_id')::uuid as mid, (x->>'qty')::int as qty from jsonb_array_elements(_items) x loop
    if r.qty is null or r.qty < 1 or r.qty > 20 then raise exception 'Invalid quantity'; end if;
    select * into e from public.menu_items where id = r.mid for share;
    if not found then raise exception 'An item no longer exists'; end if;
    if not e.is_available then raise exception '% is out of stock', e.name; end if;
    total := total + e.price * r.qty;
    base := greatest(base, e.prep_minutes);
  end loop;
  select * into est from public.compute_estimate(base);
  insert into public.orders(user_id, status, total, est_prep_minutes, est_pickup_at, expires_at, idempotency_key, base_prep_minutes)
  values (uid, 'pending_payment', total, est.est_prep, est.est_pickup, now() + interval '10 minutes', _idem, base) returning id into oid;
  insert into public.order_items(order_id, menu_item_id, item_name, qty, unit_price)
  select oid, m.id, m.name, (x->>'qty')::int, m.price
  from jsonb_array_elements(_items) x join public.menu_items m on m.id = (x->>'menu_item_id')::uuid;
  insert into public.payments(order_id, amount, status) values (oid, total, 'created');
  insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (oid, null, 'pending_payment', uid);
  return oid;
end $$;

-- Called only by the verified webhook (service role). Idempotent per event id.
CREATE OR REPLACE FUNCTION public.apply_payment_event(_event_id text, _order_id uuid, _gateway_ref text, _amount numeric, _status text, _method text, _payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare o public.orders;
begin
  insert into public.webhook_events(event_id, payload) values (_event_id, _payload) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  select * into o from public.orders where id = _order_id for update;
  if not found then return 'unknown_order'; end if;
  update public.payments set gateway_ref = coalesce(gateway_ref, _gateway_ref), status = _status, method = _method, updated_at = now() where order_id = _order_id;
  if _status <> 'succeeded' then return 'recorded'; end if;
  if _amount <> o.total then
    insert into public.payment_issues(order_id, kind, detail) values (_order_id, 'amount_mismatch', format('paid %s, expected %s', _amount, o.total)) on conflict do nothing;
    return 'amount_mismatch';
  end if;
  if o.status = 'pending_payment' and o.expires_at > now() then
    update public.orders set status='paid', placed_at=now(), updated_at=now() where id=_order_id;
    insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (_order_id, 'pending_payment', 'paid', null);
    return 'paid';
  end if;
  if o.status in ('pending_payment','expired') then
    -- paid too late: expire and refund in full
    if o.status = 'pending_payment' then
      update public.orders set status='expired', updated_at=now() where id=_order_id;
      insert into public.order_status_log(order_id, from_status, to_status) values (_order_id, 'pending_payment', 'expired');
    end if;
    insert into public.refunds(order_id, amount, reason) values (_order_id, o.total, 'Paid after order expired') on conflict do nothing;
    update public.orders set refunded_amount = o.total where id=_order_id;
    return 'late_refunded';
  end if;
  return 'already_' || o.status::text;
end $$;
REVOKE ALL ON FUNCTION public.apply_payment_event(text, uuid, text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_event(text, uuid, text, numeric, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_unpaid_orders() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare n int;
begin
  with x as (update public.orders set status='expired', updated_at=now()
             where status='pending_payment' and expires_at < now() returning id)
  insert into public.order_status_log(order_id, from_status, to_status) select id, 'pending_payment', 'expired' from x;
  get diagnostics n = row_count;
  update public.payments p set status='cancelled', updated_at=now() from public.orders o
   where o.id=p.order_id and o.status='expired' and p.status='created';
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.reconcile_payments() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare n int := 0; c int;
begin
  perform public.expire_unpaid_orders();
  insert into public.payment_issues(order_id, kind, detail)
  select o.id, 'paid_without_payment', 'Order is in the kitchen but no successful payment is recorded'
  from public.orders o left join public.payments p on p.order_id=o.id
  where o.status in ('paid','accepted','preparing','ready','collected') and coalesce(p.status,'') <> 'succeeded'
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  insert into public.payment_issues(order_id, kind, detail)
  select o.id, 'payment_without_order', 'Payment succeeded but the order never reached the kitchen'
  from public.orders o join public.payments p on p.order_id=o.id
  where p.status='succeeded' and o.status in ('pending_payment','expired') and o.refunded_amount < o.total
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  insert into public.payment_issues(order_id, kind, detail)
  select o.id, 'refund_missing', 'Order was rejected or cancelled but not fully refunded'
  from public.orders o where o.status in ('rejected','cancelled') and o.refunded_amount < o.total
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
REVOKE ALL ON FUNCTION public.expire_unpaid_orders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_payments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_payments() TO authenticated;

-- Status changes: rejected/cancelled refund the remaining amount automatically.
CREATE OR REPLACE FUNCTION public.set_order_status(_order_id uuid, _to order_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare uid uuid := auth.uid(); o public.orders; ok boolean; remaining numeric;
begin
  if not public.has_role(uid,'admin') then raise exception 'Only staff can change order status'; end if;
  select * into o from public.orders where id=_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  ok := (o.status::text || '>' || _to::text) in (
    'paid>accepted','paid>rejected',
    'accepted>preparing','accepted>cancelled','preparing>ready','preparing>cancelled',
    'ready>collected');
  if not ok then raise exception 'Cannot move order from % to %', o.status, _to; end if;
  update public.orders set status=_to, updated_at=now(),
    accepted_at = case when _to='accepted' then now() else accepted_at end,
    ready_at = case when _to='ready' then now() else ready_at end,
    collected_at = case when _to='collected' then now() else collected_at end
  where id=_order_id;
  insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (_order_id, o.status, _to, uid);
  if _to in ('rejected','cancelled') then
    remaining := o.total - o.refunded_amount;
    if remaining > 0 then
      insert into public.refunds(order_id, amount, reason, created_by) values (_order_id, remaining, 'Order ' || _to::text, uid) on conflict do nothing;
    end if;
    update public.orders set status='refunded', refunded_amount=total, updated_at=now() where id=_order_id;
    insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (_order_id, _to, 'refunded', uid);
  end if;
end $$;

-- Partial refund when one line can't be made.
CREATE OR REPLACE FUNCTION public.refund_order_item(_order_item_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare uid uuid := auth.uid(); it public.order_items; o public.orders; amt numeric;
begin
  if not public.has_role(uid,'admin') then raise exception 'Only staff can refund'; end if;
  select * into it from public.order_items where id=_order_item_id for update;
  if not found then raise exception 'Item not found'; end if;
  if it.item_status <> 'ok' then raise exception 'Already refunded'; end if;
  select * into o from public.orders where id=it.order_id for update;
  if o.status not in ('paid','accepted','preparing') then raise exception 'Order can no longer be changed'; end if;
  amt := it.unit_price * it.qty;
  update public.order_items set item_status='unavailable' where id=_order_item_id;
  insert into public.refunds(order_id, order_item_id, amount, reason, created_by) values (o.id, it.id, amt, it.item_name || ' unavailable', uid);
  update public.orders set refunded_amount = refunded_amount + amt, updated_at=now() where id=o.id;
  if not exists (select 1 from public.order_items where order_id=o.id and item_status='ok') then
    update public.orders set status='refunded', updated_at=now() where id=o.id;
    insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (o.id, o.status, 'refunded', uid);
  end if;
end $$;

-- Old direct-to-paid path is retired; payment now goes through checkout + webhook.
REVOKE EXECUTE ON FUNCTION public.place_order(jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.refunds REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.refunds;
