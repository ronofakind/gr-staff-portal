-- 137 · Nov 25 2026 · Ending someone before 4 h asks why (board AdminCutEarlyV1). Ronnie: no button, only the prompt.
-- The reason sets the pay: hours worked (left_early = true) for Not feeling well / Personal emergency / Behaviour / dress code;
-- 4 h minimum (left_early = false) for Slow night · not needed / Event ended early / Other (Ronnie decides "Other").
-- Client billed the same as staff paid. Not counted on Reliability (left_early is not a flag). Additive only.
alter table public.shifts add column if not exists early_reason text;
alter table public.shifts add column if not exists early_note text;
alter table public.shifts add column if not exists early_by uuid;
alter table public.shifts add column if not exists early_at timestamptz;
alter table public.shifts add column if not exists early_seen_at timestamptz;

create or replace function public.manager_end_early(p_shift uuid, p_out timestamptz, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; pin timestamptz; r text := nullif(trim(coalesce(p_reason, '')), ''); n text := nullif(trim(coalesce(p_note, '')), '');
begin
  select event_id into ev from shifts where id = p_shift;
  if ev is null then raise exception 'Shift not found'; end if;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  if r is null then raise exception 'Pick a reason'; end if;
  select punch_in into pin from punches where shift_id = p_shift;
  if pin is null then raise exception 'Start them first'; end if;
  if p_out is null or p_out <= pin then raise exception 'The end time must be after their start'; end if;
  perform manager_set_punch(p_shift, pin, p_out, null);
  update shifts set early_reason = r, early_note = n, early_by = me(), early_at = now(), early_seen_at = null,
    left_early = r in ('Not feeling well', 'Personal emergency', 'Behaviour / dress code'),
    attendance_reason = r || coalesce(' · ' || n, '')
  where id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'attendance', p_shift, jsonb_build_object('end_early', true, 'out', p_out, 'reason', r, 'note', n));
end $$;
revoke all on function public.manager_end_early(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.manager_end_early(uuid, timestamptz, text, text) to authenticated;

-- End the night early for many at once: one reason, 4 h minimum, no prompt per person (times are set by the usual End All first).
create or replace function public.manager_early_reason(p_shifts uuid[], p_reason text)
returns int language plpgsql security definer set search_path = public as
$$ declare n int := 0; s record; r text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if r is null then raise exception 'Pick a reason'; end if;
  for s in select id, event_id from shifts where id = any(coalesce(p_shifts, '{}')) loop
    if not (is_admin() or manages(s.event_id)) then raise exception 'not allowed'; end if;
    update shifts set early_reason = r, early_note = null, early_by = me(), early_at = now(), early_seen_at = null, left_early = false where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.manager_early_reason(uuid[], text) from public, anon;
grant execute on function public.manager_early_reason(uuid[], text) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shifts'
  and column_name in ('early_reason', 'early_note', 'early_by', 'early_at', 'early_seen_at')) || ' cols · '
  || (select count(*) from pg_proc where proname in ('manager_end_early', 'manager_early_reason')) || ' fns · '
  || (select count(*) from shifts where left_early) || ' left early kept';
