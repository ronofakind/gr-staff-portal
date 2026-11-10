-- 077 · MD debrief after Submit hours (Nov 7, 2026)
-- 4 taps (night · client · difficulty · team size) + "What happened?" chips/line on a rough night + an optional note.
-- One per event per person who closes hours (floor MD and bar manager each send their own). Only admin reads them.
-- Safe to run twice.
create table if not exists public.event_debriefs (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  by_staff   uuid not null references public.staff(id) on delete cascade,
  night      text check (night in ('smooth', 'issues', 'rough')),
  client     text check (client in ('yes', 'mixed', 'no')),
  difficulty text check (difficulty in ('easier', 'expected', 'harder')),
  team_size  text check (team_size in ('few', 'right', 'many')),
  issues     text[] not null default '{}',
  what       text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, by_staff)
);
alter table public.event_debriefs enable row level security;
drop policy if exists edb_admin on public.event_debriefs;
create policy edb_admin on public.event_debriefs for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists edb_own_read on public.event_debriefs;
create policy edb_own_read on public.event_debriefs for select to authenticated using (by_staff = me());

create or replace function public.manager_send_debrief(p_event uuid, p_night text, p_client text, p_difficulty text, p_team_size text,
                                                       p_issues text[] default '{}', p_what text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  insert into event_debriefs(event_id, by_staff, night, client, difficulty, team_size, issues, what, note)
  values (p_event, me(), p_night, p_client, p_difficulty, p_team_size, coalesce(p_issues, '{}'),
          nullif(trim(coalesce(p_what, '')), ''), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (event_id, by_staff) do update set night = excluded.night, client = excluded.client, difficulty = excluded.difficulty,
     team_size = excluded.team_size, issues = excluded.issues, what = excluded.what, note = excluded.note, updated_at = now();
end $$;
grant execute on function public.manager_send_debrief(uuid, text, text, text, text, text[], text, text) to authenticated;

select 'RESULT ' || (select count(*) from pg_tables where tablename = 'event_debriefs') || ' table · '
    || (select count(*) from pg_proc where proname = 'manager_send_debrief') || ' fn' as result;
