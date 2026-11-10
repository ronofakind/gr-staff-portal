-- Push 45 (Nov 3, 2026) · "No outside food" venue rule (all synagogues / Chabad venues, Ronnie).
-- Additive: one venue switch. Every event at a venue with it on shows "At this venue · No outside food or drinks".
alter table public.venues add column if not exists no_outside_food boolean not null default false;

-- Ronnie's 6 venues (Nov 3, 5:27 PM), matched by name or street address; nothing is created.
update public.venues set no_outside_food = true
 where name ilike any (array['%shaar hashomayim%','%shaare zedek%','%shomrim laboker%','%sepharade%','%beth chabad%','%chabad of westmount%'])
    or coalesce(address,'') ilike any (array['%450%kensington%','%5305%rosedale%','%6410%westbury%','%5700%einstein%','%6501%kildare%','%1303%greene%']);

-- Check: which venues are on, and which of the 6 have no venue row yet (create them in Venues & clients, then flip the switch).
select string_agg(name, ' · ' order by name) as switched_on,
       (select string_agg(x, ' · ') from unnest(array['Shaar Hashomayim','Shaare Zedek','Shomrim Laboker','Sepharade','Beth Chabad','Chabad of Westmount']) x
         where not exists (select 1 from venues v where v.no_outside_food and v.name ilike '%' || x || '%')) as not_found_by_name
  from public.venues where no_outside_food;
