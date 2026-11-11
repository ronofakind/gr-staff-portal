-- 114 · "Food by" (the caterer) per event + uniform follows the caterer (Nov 11, 2026 · push 95). Safe to run twice.
-- Ronnie (3:46 PM): the client is for billing; for booking the venue matters, and staff (floor AND bar) should know who's doing the food.
-- Uniform default: client with its own rule (Power Corp) → caterer → venue → black shirt. A one-off stays on the event.
alter table public.clients add column if not exists is_caterer      boolean not null default false;
alter table public.clients add column if not exists caterer_label   text;     -- what staff see: "Beatrice"
alter table public.clients add column if not exists uniform_special boolean not null default false; -- client's own uniform rule wins (Power Corp)
alter table public.venues  add column if not exists usual_caterer_id uuid references public.clients(id) on delete set null;
alter table public.events  add column if not exists caterer_id   uuid references public.clients(id) on delete set null;
alter table public.events  add column if not exists caterer_name text;    -- copy of the label, so staff can read it (clients are admin only)

-- keep caterer_name in step with caterer_id
create or replace function public._event_caterer_name() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if new.caterer_id is null then new.caterer_name := null;
  elsif tg_op = 'INSERT' or new.caterer_id is distinct from old.caterer_id or new.caterer_name is null then
    select coalesce(nullif(trim(caterer_label), ''), name) into new.caterer_name from clients where id = new.caterer_id;
  end if;
  return new;
end $$;
drop trigger if exists event_caterer_name on public.events;
create trigger event_caterer_name before insert or update of caterer_id on public.events for each row execute function public._event_caterer_name();

-- caterers (Ronnie, 3:50 PM): Beatrice, Traiteur Brera, Beso, La Marguerite, Saison Traiteur, La Nesra (own kitchen)
insert into clients(name) select x from unnest(array['La Marguerite', 'Saison Traiteur']) x where not exists (select 1 from clients where lower(name) = lower(x));
update clients set is_caterer = true, caterer_label = case name when 'Daniel Bilodeau (Beatrice)' then 'Beatrice' when 'Traiteur Brera Inc.' then 'Traiteur Brera' when 'La Nesra' then 'La Nesra kitchen' else name end
 where name in ('Daniel Bilodeau (Beatrice)', 'Traiteur Brera Inc.', 'Beso', 'La Marguerite', 'Saison Traiteur', 'La Nesra');
update clients set uniform_floor = 'black_shirt', uniform_floor_w = 'black_shirt', uniform_bar = 'black_shirt', uniform_bar_w = 'black_shirt',
  uniform_items = (select uniform_items from clients where name = 'Beso')
 where name in ('La Marguerite', 'Saison Traiteur') and uniform_floor is null;
update clients set uniform_special = true where name ilike 'power corp%';
update venues set usual_caterer_id = (select id from clients where name = 'La Nesra') where name = 'La Nesra' and usual_caterer_id is null;
update venues set usual_caterer_id = (select id from clients where name = 'Traiteur Brera Inc.') where name = 'Maison Principale' and usual_caterer_id is null;

-- Windsor Nov 12–13 (bar + floor) and Bonsecours Nov 14: food by Beatrice (uniforms unchanged)
select set_config('gr.quiet', '1', true);
update events e set caterer_id = (select id from clients where name = 'Daniel Bilodeau (Beatrice)')
  from venues v where v.id = e.venue_id and e.caterer_id is null
   and ((v.name = 'Windsor Station' and e.event_date in ('2026-11-12', '2026-11-13')) or (v.name = 'Marché Bonsecours' and e.event_date = '2026-11-14'));

select 'RESULT ' || (select count(*) from clients where is_caterer) || ' caterers · ' || (select count(*) from events where caterer_id is not null) || ' events with food by · '
  || (select count(*) from venues where usual_caterer_id is not null) || ' venues with a usual caterer';
