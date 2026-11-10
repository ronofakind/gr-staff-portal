-- Push 69 · Bar count on every bar event (board BarCountV2, Nov 10).
-- Spirits in quarters, wine / bubbles / beer one by one. Out at the start → + more out → brought back; used = out − back.
-- Supplies (Full / ¾ / ½ / ¼ / Out) only at venues with bar_supplies (Le Andover, Salon Richmond). Quantities only, CSV for Ronnie.
-- Report: only Ronnie (admin). The bar manager (BM on the event), the event's MD, or the person the count was handed to can fill
-- it in, and can still edit it after submitting.
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
  lines jsonb not null default '[]',     -- [{key, item_id, kind, name, size, out, more, back}]
  supplies jsonb not null default '[]',  -- [{key, item_id, name, level}]
  handed_to uuid references public.staff(id) on delete set null, handed_by uuid references public.staff(id) on delete set null,
  out_by uuid references public.staff(id) on delete set null, out_at timestamptz,
  more_at timestamptz, back_by uuid references public.staff(id) on delete set null,
  submitted_by uuid references public.staff(id) on delete set null, submitted_at timestamptz,
  edited_by uuid references public.staff(id) on delete set null, edited_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.bar_items enable row level security; alter table public.bar_counts enable row level security;
drop policy if exists admin_all on public.bar_items; create policy admin_all on public.bar_items for all using (is_admin()) with check (is_admin());
drop policy if exists admin_all on public.bar_counts; create policy admin_all on public.bar_counts for all using (is_admin()) with check (is_admin());

create or replace function public._can_bar_count(p_event uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select is_admin() or exists (select 1 from events e where e.id = p_event and e.department = 'bar' and (
          e.manager_id = me()
       or exists (select 1 from shifts s where s.event_id = e.id and s.staff_id = me() and s.status <> 'declined' and s.attendance is null and s.position_code in ('BM', 'MD'))
       or exists (select 1 from bar_counts c where c.event_id = e.id and c.handed_to = me()))) $$;

-- Everything the count screen needs: the list for this venue / client, what was saved, who's on the bar team.
create or replace function public.bar_count_get(p_event uuid) returns json
language plpgsql stable security definer set search_path = public as
$$ declare e record; c bar_counts%rowtype; cl uuid; begin
  if not _can_bar_count(p_event) then return null; end if;
  select ev.id, ev.title, ev.event_date, ev.venue_id, coalesce(v.bar_supplies, false) as sup into e from events ev left join venues v on v.id = ev.venue_id where ev.id = p_event;
  select client_id into cl from event_private where event_id = p_event;
  select * into c from bar_counts where event_id = p_event;
  return json_build_object(
    'event', json_build_object('id', e.id, 'title', e.title, 'date', e.event_date, 'supplies', e.sup),
    'items', (select coalesce(json_agg(json_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'size', i.size) order by i.kind = 'supply', i.sort, i.name), '[]')
                from bar_items i where i.archived_at is null and ((e.venue_id is not null and i.venue_id = e.venue_id) or (cl is not null and i.client_id = cl))
                  and (i.kind <> 'supply' or e.sup)),
    'count', case when c.id is null then null else json_build_object('lines', c.lines, 'supplies', c.supplies, 'handed_to', c.handed_to,
              'handed_to_name', (select full_name from staff where id = c.handed_to), 'handed_by_name', (select full_name from staff where id = c.handed_by),
              'out_at', c.out_at, 'more_at', c.more_at, 'submitted_at', c.submitted_at, 'submitted_by_name', (select full_name from staff where id = c.submitted_by), 'edited_at', c.edited_at) end,
    'team', (select coalesce(json_agg(json_build_object('id', st.id, 'name', st.full_name, 'role', s.position_detail) order by st.full_name), '[]')
               from shifts s join staff st on st.id = s.staff_id where s.event_id = p_event and s.status <> 'declined' and s.attendance is null and s.staff_id <> me()));
end $$;

-- Save (step = 'out' | 'more' | 'back' | 'edit'); p_submit marks it submitted. Edits after submitting stay allowed.
create or replace function public.bar_count_save(p_event uuid, p_lines jsonb, p_supplies jsonb, p_step text, p_submit boolean default false) returns void
language plpgsql security definer set search_path = public as
$$ declare was timestamptz; begin
  if not _can_bar_count(p_event) then raise exception 'Only the bar manager / MD of this event can do the bar count.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_typeof(coalesce(p_supplies, '[]')) <> 'array' then raise exception 'bad count'; end if;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  select submitted_at into was from bar_counts where event_id = p_event;
  update bar_counts set lines = p_lines, supplies = coalesce(p_supplies, '[]'), updated_at = now(),
         out_by = case when p_step = 'out' then me() else out_by end, out_at = case when p_step = 'out' and out_at is null then now() else out_at end,
         more_at = case when p_step = 'more' then now() else more_at end,
         back_by = case when p_step = 'back' then me() else back_by end,
         submitted_by = case when p_submit and was is null then me() else submitted_by end,
         submitted_at = case when p_submit and was is null then now() else submitted_at end,
         edited_by = case when was is not null then me() else edited_by end, edited_at = case when was is not null then now() else edited_at end
   where event_id = p_event;
end $$;

-- Hand the count to someone on the event (null = take it back).
create or replace function public.bar_count_hand(p_event uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not _can_bar_count(p_event) then raise exception 'not allowed'; end if;
  if p_staff is not null and not exists (select 1 from shifts where event_id = p_event and staff_id = p_staff and status <> 'declined' and attendance is null) then raise exception 'They are not on this event.'; end if;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  update bar_counts set handed_to = p_staff, handed_by = case when p_staff is null then null else me() end, updated_at = now() where event_id = p_event;
  if p_staff is not null then
    insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, data, for_date)
      select p_staff, 'changed', 'barhand:' || p_event || ':' || p_staff, '🍸 You’re doing the bar count', e.title || ' · handed to you by ' || split_part((select full_name from staff where id = me()), ' ', 1),
             '👉 Tap to open', '/bar/' || p_event, jsonb_build_object('event_id', p_event), e.event_date from events e where e.id = p_event
    on conflict do nothing;
  end if;
end $$;

-- Staff: is there a bar count for me on this event? (Shift page card)
create or replace function public.bar_count_mine(p_event uuid) returns json
language sql stable security definer set search_path = public as
$$ select case when not exists (select 1 from events where id = p_event and department = 'bar') or not _can_bar_count(p_event) or is_admin() and not exists (select 1 from shifts where event_id = p_event and staff_id = me()) then null
   else json_build_object('submitted_at', (select submitted_at from bar_counts where event_id = p_event), 'out_at', (select out_at from bar_counts where event_id = p_event),
                          'handed_to_me', exists (select 1 from bar_counts where event_id = p_event and handed_to = me())) end $$;

grant execute on function public.bar_count_get(uuid), public.bar_count_save(uuid, jsonb, jsonb, text, boolean), public.bar_count_hand(uuid, uuid), public.bar_count_mine(uuid) to authenticated;
