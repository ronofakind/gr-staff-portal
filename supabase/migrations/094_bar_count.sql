-- Push 69 · Bar count on every bar event (boards BarCountV2 + V3, Nov 10).
-- Every out / back is a confirmed MOVE with who + when (an accidental + can't hide); undo needs a reason.
-- Spirits in quarters, wine / bubbles / beer one by one. Used = (start + more out) − brought back. Bottles can come back several times.
-- The list is per venue (else client); fixing a name / size or adding a size on the night also changes the list for next time.
-- Supplies (Full / ¾ / ½ / ¼ / Out) only at venues with bar_supplies (Le Andover, Salon Richmond). Quantities only, CSV for Ronnie.
-- Who: the BM / MD on the event, the event manager, or the person it was handed to; anyone doing the count can undo. Report: only admin.
alter table public.venues add column if not exists bar_supplies boolean not null default false;
update public.venues set bar_supplies = true where name in ('Le Andover', 'Salon Richmond');

create table if not exists public.bar_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('spirit', 'wine', 'bubbles', 'beer', 'other', 'supply')),
  name text not null, size text, sort int not null default 0, archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (venue_id is not null or client_id is not null)
);
create table if not exists public.bar_counts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  supplies jsonb not null default '[]',  -- [{item_id, name, level}]
  handed_to uuid references public.staff(id) on delete set null, handed_by uuid references public.staff(id) on delete set null,
  submitted_by uuid references public.staff(id) on delete set null, submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.bar_moves (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  step text not null check (step in ('start', 'more', 'back', 'fix', 'item')),
  items jsonb not null default '[]',     -- start/more/back: [{item_id, qty}] · fix: [{item_id, out, back}] (deltas) · item: [{item_id, from, to}]
  by_staff uuid references public.staff(id) on delete set null default public.me(),
  at timestamptz not null default now(),
  undone_at timestamptz, undone_by uuid references public.staff(id) on delete set null, undo_reason text
);
create index if not exists bar_moves_event on public.bar_moves (event_id, at);
alter table public.bar_items enable row level security; alter table public.bar_counts enable row level security; alter table public.bar_moves enable row level security;
drop policy if exists admin_all on public.bar_items; create policy admin_all on public.bar_items for all using (is_admin()) with check (is_admin());
drop policy if exists admin_all on public.bar_counts; create policy admin_all on public.bar_counts for all using (is_admin()) with check (is_admin());
drop policy if exists admin_all on public.bar_moves; create policy admin_all on public.bar_moves for all using (is_admin()) with check (is_admin());

create or replace function public._can_bar_count(p_event uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select is_admin() or exists (select 1 from events e where e.id = p_event and e.department = 'bar' and (
          e.manager_id = me()
       or exists (select 1 from shifts s where s.event_id = e.id and s.staff_id = me() and s.status <> 'declined' and s.attendance is null and s.position_code in ('BM', 'MD'))
       or exists (select 1 from bar_counts c where c.event_id = e.id and c.handed_to = me()))) $$;

create or replace function public.bar_count_get(p_event uuid) returns json
language plpgsql stable security definer set search_path = public as
$$ declare e record; c bar_counts%rowtype; cl uuid; begin
  if not _can_bar_count(p_event) then return null; end if;
  select ev.id, ev.title, ev.event_date, ev.venue_id, coalesce(v.bar_supplies, false) as sup into e from events ev left join venues v on v.id = ev.venue_id where ev.id = p_event;
  select client_id into cl from event_private where event_id = p_event;
  select * into c from bar_counts where event_id = p_event;
  return json_build_object(
    'event', json_build_object('id', e.id, 'title', e.title, 'date', e.event_date, 'supplies', e.sup),
    'items', (select coalesce(json_agg(json_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'size', i.size) order by i.kind = 'supply', i.sort, i.name, i.size), '[]')
                from bar_items i where i.archived_at is null and ((e.venue_id is not null and i.venue_id = e.venue_id) or (e.venue_id is null and cl is not null and i.client_id = cl))
                  and (i.kind <> 'supply' or e.sup)),
    'moves', (select coalesce(json_agg(json_build_object('id', m.id, 'step', m.step, 'items', m.items, 'at', m.at, 'by', st.full_name, 'by_id', m.by_staff,
                 'undone_at', m.undone_at, 'undone_by', ub.full_name, 'undo_reason', m.undo_reason) order by m.at), '[]')
                from bar_moves m left join staff st on st.id = m.by_staff left join staff ub on ub.id = m.undone_by where m.event_id = p_event),
    'count', case when c.id is null then null else json_build_object('supplies', c.supplies, 'handed_to', c.handed_to,
              'handed_to_name', (select full_name from staff where id = c.handed_to), 'handed_by_name', (select full_name from staff where id = c.handed_by),
              'submitted_at', c.submitted_at, 'submitted_by_name', (select full_name from staff where id = c.submitted_by)) end,
    'team', (select coalesce(json_agg(json_build_object('id', st.id, 'name', st.full_name, 'role', s.position_detail) order by st.full_name), '[]')
               from shifts s join staff st on st.id = s.staff_id where s.event_id = p_event and s.status <> 'declined' and s.attendance is null and s.staff_id <> me()));
end $$;

-- A confirmed move (start / more / back / fix). Items: [{item_id, qty}] or for fix [{item_id, out, back}].
create or replace function public.bar_move(p_event uuid, p_step text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v uuid; begin
  if not _can_bar_count(p_event) then raise exception 'Only the bar manager / MD of this event can do the bar count.'; end if;
  if p_step not in ('start', 'more', 'back', 'fix') or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Nothing to save.'; end if;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  insert into bar_moves(event_id, step, items) values (p_event, p_step, p_items) returning id into v;
  update bar_counts set updated_at = now() where event_id = p_event;
  return v;
end $$;
create or replace function public.bar_move_undo(p_move uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from bar_moves where id = p_move;
  if ev is null or not _can_bar_count(ev) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why (e.g. pressed twice).'; end if;
  update bar_moves set undone_at = now(), undone_by = me(), undo_reason = left(trim(p_reason), 200) where id = p_move and undone_at is null and step <> 'item';
end $$;

-- Add a bottle (or the same bottle in another size) / fix a name or size: changes the list for next time, logged.
create or replace function public.bar_item_save(p_event uuid, p_item uuid, p_kind text, p_name text, p_size text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare e record; cl uuid; old bar_items%rowtype; v uuid; begin
  if not _can_bar_count(p_event) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give it a name.'; end if;
  select id, venue_id into e from events where id = p_event; select client_id into cl from event_private where event_id = p_event;
  if p_item is null then
    if e.venue_id is null and cl is null then raise exception 'This event has no venue or client for the list.'; end if;
    insert into bar_items(venue_id, client_id, kind, name, size, sort)
      values (e.venue_id, case when e.venue_id is null then cl end, coalesce(p_kind, 'spirit'), trim(p_name), nullif(trim(coalesce(p_size, '')), ''), 999) returning id into v;
    insert into bar_moves(event_id, step, items) values (p_event, 'item', jsonb_build_array(jsonb_build_object('item_id', v, 'from', null, 'to', trim(p_name) || coalesce(' · ' || nullif(trim(coalesce(p_size, '')), ''), ''))));
    return v;
  end if;
  select * into old from bar_items where id = p_item;
  update bar_items set name = trim(p_name), size = nullif(trim(coalesce(p_size, '')), ''), kind = coalesce(p_kind, kind) where id = p_item;
  insert into bar_moves(event_id, step, items) values (p_event, 'item', jsonb_build_array(jsonb_build_object('item_id', p_item,
    'from', old.name || coalesce(' · ' || old.size, ''), 'to', trim(p_name) || coalesce(' · ' || nullif(trim(coalesce(p_size, '')), ''), ''))));
  return p_item;
end $$;

create or replace function public.bar_count_submit(p_event uuid, p_supplies jsonb) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not _can_bar_count(p_event) then raise exception 'not allowed'; end if;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  update bar_counts set supplies = coalesce(p_supplies, '[]'), submitted_by = coalesce(submitted_by, me()), submitted_at = coalesce(submitted_at, now()), updated_at = now() where event_id = p_event;
end $$;

create or replace function public.bar_count_hand(p_event uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not _can_bar_count(p_event) then raise exception 'not allowed'; end if;
  if p_staff is not null and not exists (select 1 from shifts where event_id = p_event and staff_id = p_staff and status <> 'declined' and attendance is null) then raise exception 'They are not on this event.'; end if;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  update bar_counts set handed_to = p_staff, handed_by = case when p_staff is null then null else me() end, updated_at = now() where event_id = p_event;
  if p_staff is not null then
    insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, data, for_date)
      select p_staff, 'changed', 'barhand:' || p_event || ':' || p_staff || ':' || extract(epoch from now())::bigint, '🍸 You’re doing the bar count',
             e.title || ' · handed to you by ' || split_part((select full_name from staff where id = me()), ' ', 1), '👉 Tap to open', '/bar/' || p_event,
             jsonb_build_object('event_id', p_event), e.event_date from events e where e.id = p_event
    on conflict do nothing;
  end if;
end $$;

create or replace function public.bar_count_mine(p_event uuid) returns json
language sql stable security definer set search_path = public as
$$ select case when not exists (select 1 from events where id = p_event and department = 'bar') or not _can_bar_count(p_event) then null
   else json_build_object('submitted_at', (select submitted_at from bar_counts where event_id = p_event),
                          'started', exists (select 1 from bar_moves where event_id = p_event and step = 'start' and undone_at is null),
                          'handed_to_me', exists (select 1 from bar_counts where event_id = p_event and handed_to = me())) end $$;

grant execute on function public.bar_count_get(uuid), public.bar_move(uuid, text, jsonb), public.bar_move_undo(uuid, text), public.bar_item_save(uuid, uuid, text, text, text),
  public.bar_count_submit(uuid, jsonb), public.bar_count_hand(uuid, uuid), public.bar_count_mine(uuid) to authenticated;
