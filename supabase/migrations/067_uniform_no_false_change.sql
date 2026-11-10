-- 067 · No "uniform changed" when nothing changed (Nov 5, 2026)
-- Saving an event from the admin form fills in the uniform pieces list when the event never had one stored.
-- 062 counted that as "pieces changed" → staff got "Uniform: X → X". Now: only a real change in the pieces counts
-- (an empty / missing list before = the defaults, not a change). Safe to run twice.

-- same pieces = same, whatever the key order or missing empty lists
create or replace function public._uni_norm(x jsonb) returns jsonb language sql immutable as
$$ select case when jsonb_typeof(x) = 'object' then jsonb_build_object(
     'on',    (select coalesce(jsonb_agg(v order by v), '[]') from jsonb_array_elements_text(case when jsonb_typeof(x->'on') = 'array' then x->'on' else '[]' end) v),
     'off',   (select coalesce(jsonb_agg(v order by v), '[]') from jsonb_array_elements_text(case when jsonb_typeof(x->'off') = 'array' then x->'off' else '[]' end) v),
     'extra', coalesce(case when jsonb_typeof(x->'extra') = 'array' then x->'extra' end, '[]')) end $$;

create or replace function public.event_track_uniform() returns trigger
language plpgsql security definer set search_path = public as
$$ declare r record; ok text; nk text; okey text; ol text; nl text; begin
  if coalesce(current_setting('gr.quiet', true), '') = 'on' then return null; end if;
  if (old.uniform_floor, old.uniform_floor_w, old.uniform_bar, old.uniform_bar_w, old.uniform_items)
     is not distinct from (new.uniform_floor, new.uniform_floor_w, new.uniform_bar, new.uniform_bar_w, new.uniform_items) then return null; end if;
  for r in select s.id, s.position_code, s.position_detail, s.uniform, st.sex, s.change_prev, s.change_seen_at
             from shifts s left join staff st on st.id = s.staff_id
            where s.event_id = new.id and s.status = 'confirmed' and s.attendance is null and s.uniform is null loop
    ok := _uni_kind(old, r.position_code, r.position_detail, r.sex, null);
    nk := _uni_kind(new, r.position_code, r.position_detail, r.sex, null);
    okey := (case when coalesce(r.position_code, '') in ('BM', 'BT', 'BB') or coalesce(r.position_detail, '') ~* '^bar\M' then 'bar' else 'floor' end)
            || '_' || case when r.sex = 'f' then 'w' else 'm' end;
    if ok is distinct from nk then ol := _uni_label(ok); nl := _uni_label(nk);
    elsif jsonb_typeof(old.uniform_items->okey) = 'object' and _uni_norm(old.uniform_items->okey) is distinct from _uni_norm(new.uniform_items->okey) then ol := _uni_label(ok); nl := _uni_label(nk) || ' · pieces changed';
    else continue; end if;
    update shifts set
      change_prev = case when r.change_prev is null or r.change_seen_at is not null
                         then jsonb_build_object('start', planned_start, 'end', planned_end, 'position', coalesce(nullif(position_detail, ''), position_code), 'uniform', ol, 'uniform_new', nl)
                         else r.change_prev || jsonb_build_object('uniform', coalesce(r.change_prev->>'uniform', ol), 'uniform_new', nl) end,
      change_seen_at = null, changed_after_confirm_at = now()
     where id = r.id;
    perform _change_note(r.id, jsonb_build_array(jsonb_build_object('label', 'Uniform', 'old', ol, 'new', nl)));
  end loop;
  return null;
end $$;

select 'RESULT ' || (select count(*) from pg_trigger where tgname = 'events_track_uniform') || ' trigger' as result;
