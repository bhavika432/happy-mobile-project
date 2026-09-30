
create type public.app_role as enum ('admin','customer');
create type public.order_status as enum ('pending_payment','paid','accepted','preparing','ready','collected','expired','rejected','cancelled','refunded');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

create table public.profiles (
  id uuid primary key,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), new.phone)
  on conflict do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order int not null default 0
);
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
alter table public.categories enable row level security;
create policy "read categories" on public.categories for select to anon, authenticated using (true);
create policy "admin categories" on public.categories for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  prep_minutes int not null default 10 check (prep_minutes > 0),
  is_veg boolean not null default true,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_items to authenticated;
grant all on public.menu_items to service_role;
alter table public.menu_items enable row level security;
create policy "read menu" on public.menu_items for select to anon, authenticated using (true);
create policy "admin menu" on public.menu_items for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.canteen_settings (
  id int primary key default 1 check (id = 1),
  kitchen_capacity int not null default 3,
  avg_minutes_per_order int not null default 6,
  base_buffer_minutes int not null default 3,
  peak_start time not null default '12:00',
  peak_end time not null default '14:00',
  peak_multiplier numeric not null default 2
);
grant select, update on public.canteen_settings to authenticated;
grant all on public.canteen_settings to service_role;
alter table public.canteen_settings enable row level security;
create policy "read settings" on public.canteen_settings for select to authenticated using (true);
create policy "admin settings" on public.canteen_settings for update to authenticated using (public.has_role(auth.uid(),'admin'));
insert into public.canteen_settings(id) values (1);

create sequence public.order_number_seq start 101;
grant usage on sequence public.order_number_seq to service_role;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number int not null default nextval('public.order_number_seq'),
  user_id uuid not null,
  status order_status not null default 'paid',
  total numeric(10,2) not null,
  est_prep_minutes int not null,
  est_pickup_at timestamptz not null,
  placed_at timestamptz not null default now(),
  accepted_at timestamptz,
  ready_at timestamptz,
  collected_at timestamptz,
  updated_at timestamptz not null default now()
);
grant select on public.orders to authenticated;
grant all on public.orders to service_role;
alter table public.orders enable row level security;
create policy "read own or admin orders" on public.orders for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  qty int not null check (qty > 0),
  unit_price numeric(10,2) not null
);
grant select on public.order_items to authenticated;
grant all on public.order_items to service_role;
alter table public.order_items enable row level security;
create policy "read order items" on public.order_items for select to authenticated using (
  exists(select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.has_role(auth.uid(),'admin'))));

create table public.order_status_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
grant select on public.order_status_log to authenticated;
grant all on public.order_status_log to service_role;
alter table public.order_status_log enable row level security;
create policy "admin read log" on public.order_status_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.compute_estimate(_base_prep int)
returns table(est_prep int, est_pickup timestamptz) language plpgsql stable security definer set search_path = public as $$
declare s public.canteen_settings; ahead int; delay int; buf numeric; t time := (now() at time zone 'Asia/Kolkata')::time;
begin
  select * into s from public.canteen_settings where id=1;
  select count(*) into ahead from public.orders where status in ('paid','accepted','preparing');
  delay := ceil((ahead * s.avg_minutes_per_order)::numeric / greatest(s.kitchen_capacity,1));
  buf := s.base_buffer_minutes * (case when t between s.peak_start and s.peak_end then s.peak_multiplier else 1 end);
  est_prep := _base_prep + delay;
  est_pickup := now() + make_interval(mins => est_prep + ceil(buf)::int);
  return next;
end $$;

create or replace function public.quote_order(_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare total numeric := 0; base int := 0; unavailable jsonb := '[]'::jsonb; r record; e record;
begin
  for r in select (x->>'menu_item_id')::uuid as mid, (x->>'qty')::int as qty from jsonb_array_elements(_items) x loop
    if r.qty is null or r.qty < 1 or r.qty > 20 then raise exception 'Invalid quantity'; end if;
    select * into e from public.menu_items where id = r.mid;
    if not found or not e.is_available then
      unavailable := unavailable || to_jsonb(r.mid);
    else
      total := total + e.price * r.qty;
      base := greatest(base, e.prep_minutes);
    end if;
  end loop;
  select * into e from public.compute_estimate(base);
  return jsonb_build_object('total', total, 'est_prep_minutes', e.est_prep, 'est_pickup_at', e.est_pickup, 'unavailable', unavailable);
end $$;

create or replace function public.place_order(_items jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); total numeric := 0; base int := 0; r record; e record; est record; oid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
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
  insert into public.orders(user_id, status, total, est_prep_minutes, est_pickup_at)
  values (uid, 'paid', total, est.est_prep, est.est_pickup) returning id into oid;
  insert into public.order_items(order_id, menu_item_id, item_name, qty, unit_price)
  select oid, m.id, m.name, (x->>'qty')::int, m.price
  from jsonb_array_elements(_items) x join public.menu_items m on m.id = (x->>'menu_item_id')::uuid;
  insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (oid, null, 'paid', uid);
  return oid;
end $$;

create or replace function public.set_order_status(_order_id uuid, _to order_status)
returns void language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur order_status; ok boolean;
begin
  if not public.has_role(uid,'admin') then raise exception 'Only staff can change order status'; end if;
  select status into cur from public.orders where id=_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  ok := (cur::text || '>' || _to::text) in (
    'pending_payment>expired','paid>accepted','paid>rejected',
    'accepted>preparing','accepted>cancelled','preparing>ready','preparing>cancelled',
    'ready>collected','rejected>refunded','cancelled>refunded');
  if not ok then raise exception 'Cannot move order from % to %', cur, _to; end if;
  update public.orders set status=_to, updated_at=now(),
    accepted_at = case when _to='accepted' then now() else accepted_at end,
    ready_at = case when _to='ready' then now() else ready_at end,
    collected_at = case when _to='collected' then now() else collected_at end
  where id=_order_id;
  insert into public.order_status_log(order_id, from_status, to_status, changed_by) values (_order_id, cur, _to, uid);
end $$;

revoke execute on function public.place_order(jsonb) from anon, public;
revoke execute on function public.set_order_status(uuid, order_status) from anon, public;
grant execute on function public.place_order(jsonb) to authenticated;
grant execute on function public.set_order_status(uuid, order_status) to authenticated;

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.menu_items;
alter table public.orders replica identity full;
alter table public.menu_items replica identity full;

with c as (
  insert into public.categories(name, display_order) values
  ('Breakfast',1),('Meals',2),('Snacks',3),('Beverages',4),('Desserts',5) returning id, name)
insert into public.menu_items(category_id, name, description, price, prep_minutes, is_veg, is_available)
select c.id, v.name, v.descr, v.price, v.prep, v.veg, v.avail from c join (values
 ('Breakfast','Masala Dosa','Crispy dosa with potato masala, chutney & sambar',60,8,true,true),
 ('Breakfast','Idli Vada','2 idlis and 1 medu vada with sambar',50,5,true,true),
 ('Breakfast','Poha','Flattened rice with peanuts and curry leaves',35,4,true,true),
 ('Breakfast','Aloo Paratha','Two parathas with curd and pickle',70,10,true,true),
 ('Meals','Veg Thali','Rice, 2 rotis, dal, 2 sabzis, curd & salad',110,6,true,true),
 ('Meals','Chicken Biryani','Hyderabadi dum biryani with raita',150,12,false,true),
 ('Meals','Paneer Butter Masala + 2 Rotis','Rich tomato gravy with soft paneer',120,10,true,true),
 ('Meals','Rajma Chawal','Kidney bean curry with steamed rice',90,5,true,false),
 ('Meals','Egg Fried Rice','Wok-tossed rice with egg and veggies',95,9,false,true),
 ('Snacks','Samosa (2 pcs)','Served with mint & tamarind chutney',30,3,true,true),
 ('Snacks','Vada Pav','Mumbai-style with dry garlic chutney',25,3,true,true),
 ('Snacks','Veg Sandwich','Grilled sandwich with cheese',55,6,true,true),
 ('Snacks','Chicken Roll','Spiced chicken in a flaky paratha',80,8,false,true),
 ('Beverages','Masala Chai','Ginger and cardamom',15,3,true,true),
 ('Beverages','Filter Coffee','South Indian style',20,3,true,true),
 ('Beverages','Fresh Lime Soda','Sweet or salted',35,2,true,true),
 ('Beverages','Mango Lassi','Thick and chilled',50,3,true,true),
 ('Desserts','Gulab Jamun (2 pcs)','Warm, in sugar syrup',40,1,true,true),
 ('Desserts','Kulfi','Malai kulfi on a stick',45,1,true,true)
) as v(cat,name,descr,price,prep,veg,avail) on v.cat = c.name;
