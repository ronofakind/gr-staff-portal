import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { longDate } from '../lib/format';
import { useLang } from '../lib/i18n';

export type EventPlanData = {
  sides?: { name: string; leads?: string[]; allergy_leads?: string[] }[];
  sections?: { name: string; tables?: string[] }[];
  clearing?: { course: string; items: string[] }[];
  documents?: { name: string; url: string }[];
};
export type ShiftPlan = { cocktail?: { role: string; from?: string }; side?: string; section?: string };
type Person = { id?: string; full_name: string; photo_url: string | null };

/** Big event: only this person's part of the plan. */
export function EventPlan({ backTo }: { backTo?: string }) {
  const { id } = useParams(); const lang = useLang();
  const [row, setRow] = useState<{ plan: ShiftPlan | null; events: { title: string; event_date: string; plan: EventPlanData | null } } | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [team, setTeam] = useState<Person[]>([]);

  useEffect(() => {
    supabase.from('shifts').select('plan,events(title,event_date,plan)').eq('id', id!).single().then(({ data }) => {
      const r = data as unknown as NonNullable<typeof row>; setRow(r);
      const side = r?.events.plan?.sides?.find((s) => s.name === r.plan?.side);
      const ids = [...(side?.leads ?? []), ...(side?.allergy_leads ?? [])];
      if (ids.length) supabase.rpc('plan_people', { p_shift: id, p_ids: ids }).then(({ data: p }) =>
        setPeople(Object.fromEntries(((p ?? []) as Person[]).map((x) => [x.id!, x]))));
      if (r?.plan?.section) supabase.rpc('my_section_team', { p_shift: id }).then(({ data: t }) => setTeam((t ?? []) as Person[]));
    });
  }, [id]);

  if (!row) return <div className="loading" />;
  const ev = row.events; const ep = ev.plan ?? {}; const mine = row.plan ?? {};
  const side = ep.sides?.find((s) => s.name === mine.side);
  const section = ep.sections?.find((s) => s.name === mine.section);
  const faces = (ids: string[] | undefined, ring: string) => (ids ?? []).map((i) => people[i]).filter(Boolean).map((p) => (
    <div key={p.id} className="plan-face" style={{ ['--ring' as string]: ring }}>
      <Avatar name={p.full_name} url={p.photo_url} size={52} /><span>{p.full_name.split(' ')[0]}</span>
    </div>));
  let n = 0;

  return (
    <main className="page v2">
      <header className="row" style={{ paddingTop: 12 }}>
        <Link to={backTo ?? `/shift/${id}`} className="back" aria-label="Back">‹</Link>
        <span className="kicker">{longDate(ev.event_date, lang)}</span>
      </header>
      <div style={{ padding: '0 6px' }}>
        <div className="kicker">{ev.title}</div>
        <div className="serif" style={{ fontSize: 32, lineHeight: 1.05 }}>Your plan tonight</div>
      </div>

      {mine.cocktail && (
        <section className="plan-card">
          <Head icon="🥂" kicker={`${++n} · Cocktail`} title={mine.cocktail.role} sub={mine.cocktail.from ? `From ${mine.cocktail.from}` : undefined} />
        </section>
      )}

      {side && (
        <section className="plan-card">
          <Head icon="🍽️" kicker={`${++n} · Plate service`} title={side.name} sub="Floor plan is in the documents below" />
          {(side.leads?.length ?? 0) > 0 && <div className="plan-people"><span className="lbl">Your leads</span><div className="faces">{faces(side.leads, '#9B2226')}</div></div>}
          {(side.allergy_leads?.length ?? 0) > 0 && <div className="plan-people"><span className="lbl gold">Allergy leads</span><div className="faces">{faces(side.allergy_leads, '#C99A1E')}</div></div>}
        </section>
      )}

      {section && (
        <section className="plan-card">
          <Head icon="🍷" kicker={`${++n} · Wine and water`} title={section.name} sub="Your team pours for these tables all night" />
          {(section.tables?.length ?? 0) > 0 && <div className="plan-tables">{section.tables!.map((t) => <span key={t}>{t}</span>)}</div>}
          {team.length > 0 && <div className="plan-people"><span className="lbl green">Your team</span><div className="faces">{team.map((p) => (
            <div key={p.full_name} className="plan-face" style={{ ['--ring' as string]: '#2E7D5B' }}><Avatar name={p.full_name} url={p.photo_url} size={52} /><span>{p.full_name.split(' ')[0]}</span></div>))}</div></div>}
        </section>
      )}

      {(ep.clearing?.length ?? 0) > 0 && (
        <section className="plan-card">
          <Head icon="🍴" kicker={`${++n} · Clearing`} title="What you pick up" />
          {ep.clearing!.map((c) => (
            <div key={c.course} className="clear-row">
              <div className="kicker">After {c.course}</div>
              <div className="clear-items">{c.items.map((x) => <span key={x}>{x}</span>)}</div>
            </div>
          ))}
        </section>
      )}

      {(ep.documents?.length ?? 0) > 0 && (
        <>
          <div className="sec-head"><span className="serif">Event documents</span></div>
          <div className="plan-docs">{ep.documents!.map((d) => <a key={d.url} href={d.url} target="_blank" rel="noreferrer">📄<span>{d.name}</span></a>)}</div>
        </>
      )}
      <div style={{ height: 40 }} />
    </main>
  );
}

function Head({ icon, kicker, title, sub }: { icon: string; kicker: string; title: string; sub?: string }) {
  return (
    <div className="plan-head">
      <span className="ic">{icon}</span>
      <div className="grow"><div className="kicker">{kicker}</div><div className="serif" style={{ fontSize: 22, lineHeight: 1.1 }}>{title}</div>{sub && <div className="muted sm">{sub}</div>}</div>
    </div>
  );
}
