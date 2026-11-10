-- Push 70 · Ronnie edits an MD's debrief (board DebriefEditV1, Nov 10).
-- He changes the answers directly (they're what rankings / reviews read); the MD's original is kept for him only.
-- The MD isn't told. If the MD re-sends the debrief later it no longer overwrites Ronnie's edit.
alter table public.event_debriefs add column if not exists original jsonb;     -- the MD's answers before Ronnie's first edit
alter table public.event_debriefs add column if not exists edited_by uuid references public.staff(id) on delete set null;
alter table public.event_debriefs add column if not exists edited_at timestamptz;

create or replace function public.manager_send_debrief(p_event uuid, p_night text, p_client text, p_difficulty text, p_team_size text,
                                                       p_issues text[] default '{}', p_what text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  insert into event_debriefs(event_id, by_staff, night, client, difficulty, team_size, issues, what, note)
  values (p_event, me(), p_night, p_client, p_difficulty, p_team_size, coalesce(p_issues, '{}'),
          nullif(trim(coalesce(p_what, '')), ''), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (event_id, by_staff) do update set night = excluded.night, client = excluded.client, difficulty = excluded.difficulty,
     team_size = excluded.team_size, issues = excluded.issues, what = excluded.what, note = excluded.note, updated_at = now()
   where event_debriefs.edited_at is null;   -- push 70: Ronnie's edit wins
end $$;
grant execute on function public.manager_send_debrief(uuid, text, text, text, text, text[], text, text) to authenticated;
