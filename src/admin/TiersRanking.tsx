import { Link } from 'react-router-dom';
import { Tiers } from './Tiers';
import { Ranking } from './Ranking';

/* Push 47 · Tiers + Ranking = one page "Tiers & ranking" with two tabs. /admin/tiers and /admin/ranking both land here. */
export function TiersRanking({ tab }: { tab: 'tiers' | 'ranking' }) {
  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">PEOPLE · ADMIN ONLY</div><h1 className="serif-h">Tiers &amp; ranking</h1></div>
        <div className="seg3" role="tablist" aria-label="Tiers or ranking">
          <Link role="tab" aria-selected={tab === 'tiers'} className={tab === 'tiers' ? 'on' : ''} to="/admin/tiers">Tiers</Link>
          <Link role="tab" aria-selected={tab === 'ranking'} className={tab === 'ranking' ? 'on' : ''} to="/admin/ranking">Ranking · score</Link>
        </div>
      </div>
      {tab === 'tiers' ? <Tiers inPage /> : <Ranking />}
    </div>
  );
}
