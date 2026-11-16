-- 129 · Nov 16 2026 · invites sent from the Mac mini (Ronnie: "only for invitees").
-- Ronnie presses "Send N from Mac mini" in the Invite window → one text_outbox row per person (kind 'invite').
-- A scheduled Claude task on the Mac mini (hourly, 8 AM–10 PM) reads them through /api/ai?invites=1, sends in Messages (iMessage)
-- or WhatsApp Desktop, then reports back → outbox_invite_done marks the row and the invite link as sent (= "Invited").
-- Test mode (app_settings 'mac.invite_test', on by default): every text goes to Ronnie's own phone, "[TEST → name]" in front, link hidden.
alter table public.text_outbox add column if not exists channel text check (channel in ('imessage', 'whatsapp'));
alter table public.text_outbox add column if not exists test boolean not null default false;
alter table public.text_outbox add column if not exists invite_token text;
alter table public.text_outbox add column if not exists for_name text;
create index if not exists text_outbox_invites on public.text_outbox (staff_id, created_at desc) where kind = 'invite';
insert into public.app_settings (key, value) values ('mac.invite_test', '{"on": true}') on conflict (key) do nothing;

-- p_items: [{staff_id, token, body, channel}] · p_test_both: test rows on both channels for the first item
create or replace function public.admin_queue_invites(p_items jsonb, p_test_both boolean default false)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare it jsonb; st staff%rowtype; tst boolean; my text; n int := 0; ch text; bdy text; chans text[];
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  tst := coalesce((select (value->>'on')::boolean from app_settings where key = 'mac.invite_test'), true) or p_test_both;
  select phone into my from staff where id = me();
  if tst and nullif(regexp_replace(coalesce(my, ''), '\D', '', 'g'), '') is null then raise exception 'Test mode: add your own phone on your staff profile first'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into st from staff where id = (it->>'staff_id')::uuid;
    if st.id is null then continue; end if;
    if not exists (select 1 from invite_links where token = it->>'token' and staff_id = st.id and used_at is null and revoked_at is null) then
      raise exception 'Invite link for % is no longer valid · close and reopen the window', st.full_name; end if;
    if not tst and nullif(regexp_replace(coalesce(st.phone, ''), '\D', '', 'g'), '') is null then raise exception '% has no phone', st.full_name; end if;
    chans := case when p_test_both then array['imessage', 'whatsapp'] else array[it->>'channel'] end;
    foreach ch in array chans loop
      if ch is null or ch not in ('imessage', 'whatsapp') then raise exception 'Pick iMessage or WhatsApp for %', st.full_name; end if;
      bdy := left(coalesce(it->>'body', ''), 2000);
      if tst then bdy := '[TEST → ' || st.full_name || ' · ' || ch || '] ' || regexp_replace(bdy, '/go/[A-Za-z0-9_-]+', '/go/(link hidden in test)', 'g'); end if;
      if not tst then update text_outbox set status = 'skipped', error = 'replaced by a newer invite' where kind = 'invite' and staff_id = st.id and status = 'queued'; end if;
      insert into text_outbox (staff_id, phone, lang, body, kind, channel, test, invite_token, for_name, expires_at)
      values (st.id, case when tst then my else st.phone end, coalesce(st.language, 'en'), bdy, 'invite', ch, tst, case when tst then null else it->>'token' end, st.full_name, now() + interval '2 days');
      n := n + 1;
    end loop;
    exit when p_test_both;
  end loop;
  return n;
end $$;
revoke all on function public.admin_queue_invites(jsonb, boolean) from public, anon;
grant execute on function public.admin_queue_invites(jsonb, boolean) to authenticated;

-- the Mac mini reports back (through /api/ai, service role only)
create or replace function public.outbox_invite_done(p_id uuid, p_ok boolean, p_error text default null)
returns text language plpgsql volatile security definer set search_path = public as
$$ declare r text_outbox%rowtype; t timestamptz := now();
begin
  select * into r from text_outbox where id = p_id and kind = 'invite';
  if r.id is null then return 'not found'; end if;
  if r.status <> 'queued' then return 'already ' || r.status; end if;
  update text_outbox set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then t end, attempts = attempts + 1, error = left(p_error, 300) where id = p_id;
  if p_ok and not r.test and r.invite_token is not null then
    update invite_links set sent_at = t, expires_at = t + interval '7 days' where token = r.invite_token and used_at is null and revoked_at is null;
    update invite_links set revoked_at = t where staff_id = r.staff_id and token <> r.invite_token and used_at is null and revoked_at is null;
    update invite_requests set handled_at = t where staff_id = r.staff_id and handled_at is null;
  end if;
  return case when p_ok then 'sent' else 'failed' end;
end $$;
revoke all on function public.outbox_invite_done(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.outbox_invite_done(uuid, boolean, text) to service_role;

select 'RESULT ' || (select count(*) from pg_proc where proname in ('admin_queue_invites', 'outbox_invite_done')) || ' fns · test ' || (select value::text from app_settings where key = 'mac.invite_test');
