-- Push 60 · Debriefs: answered, skipped, or never saw it (board DebriefSkipV1).
-- One row per manager per event: when the "How did tonight go?" question opened on their phone, when they tapped Skip,
-- and which app build they were on. No row + hours sent = the question never opened.
create table if not exists public.debrief_seen (
  event_id   uuid not null references public.events(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  shown_at   timestamptz not null default now(),
  skipped_at timestamptz,
  build      text,
  primary key (event_id, staff_id)
);
alter table public.debrief_seen enable row level security;
drop policy if exists ds_admin on public.debrief_seen;
create policy ds_admin on public.debrief_seen for all to authenticated using (is_admin()) with check (is_admin());

create or replace function public.debrief_mark(p_event uuid, p_skip boolean, p_build text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  insert into debrief_seen(event_id, staff_id, build, skipped_at)
  values (p_event, me(), left(p_build, 40), case when p_skip then now() end)
  on conflict (event_id, staff_id) do update
    set skipped_at = case when p_skip then coalesce(debrief_seen.skipped_at, now()) else debrief_seen.skipped_at end,
        build = coalesce(excluded.build, debrief_seen.build);
end $$;
grant execute on function public.debrief_mark(uuid, boolean, text) to authenticated;
