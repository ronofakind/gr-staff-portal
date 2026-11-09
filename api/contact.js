// Nov 9 · push 58 · GET /api/contact?id=ronnie|georges|all → vCard (.vcf) so new staff can save Ronnie and Georges with their photos.
// Public: only what's already printed in the handbook (names, roles, work numbers, profile photos).
const PEOPLE = {
  ronnie: { first: 'Ronald', last: 'Ladores', nick: 'Ronnie', tel: '+15149181588', title: 'Admin, payroll, floor scheduling, hiring',
    photo: 'https://oigqdecyhmeuvrpoikdv.supabase.co/storage/v1/object/public/avatars/13791946-d8df-4146-b51e-0963f0324499.jpg' },
  georges: { first: 'Georges', last: 'Mourad', nick: '', tel: '+15148044446', title: 'Bar scheduling, client relations',
    photo: 'https://oigqdecyhmeuvrpoikdv.supabase.co/storage/v1/object/public/avatars/c4d963bc-9959-4541-a8dc-766da053b697.jpg' },
};
const fold = (l) => l.match(/.{1,74}/g).join('\r\n ');
async function card(p) {
  let ph = '';
  try { const r = await fetch(p.photo); if (r.ok) ph = Buffer.from(await r.arrayBuffer()).toString('base64'); } catch { /* no photo */ }
  return ['BEGIN:VCARD', 'VERSION:3.0', `N:${p.last};${p.first};;;`, `FN:${p.first} ${p.last}`, p.nick ? `NICKNAME:${p.nick}` : '',
    'ORG:G&R à votre service', `TITLE:${p.title}`, `TEL;TYPE=CELL:${p.tel}`, ph ? fold(`PHOTO;ENCODING=b;TYPE=JPEG:${ph}`) : '', 'END:VCARD']
    .filter(Boolean).join('\r\n');
}
export default async function handler(req, res) {
  const id = String(req.query.id || 'all');
  const list = id === 'all' ? [PEOPLE.ronnie, PEOPLE.georges] : PEOPLE[id] ? [PEOPLE[id]] : null;
  if (!list) return res.status(404).send('Not found');
  const body = (await Promise.all(list.map(card))).join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${id === 'all' ? 'GR contacts' : list[0].first + ' ' + list[0].last}.vcf"`);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(body);
}
