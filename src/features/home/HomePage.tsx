import type { Account } from '../../data/store';
import { RecentTodos } from '../planner/RecentTodos';

export function HomePage({ account, onProfile }: { account: Account; onProfile: () => void }) {
  const profile = account.profile ?? account.identity.user.profile;
  const name = profile?.name || account.identity.user.name;
  return <section className="welcome home-page"><p className="eyebrow">JUST THE TWO OF US</p><h1>把小事记下，<br />把生活留给彼此。</h1><p className="muted">一个只属于两个人的生活计划本。<br />一起，留点时间给生活。</p>
    <button className="home-profile" aria-label="编辑个人资料" onClick={onProfile}><span className="avatar">{profile?.avatar ? <img src={profile.avatar} alt="" /> : name.slice(0, 1)}</span><span className="home-profile-copy"><strong>{name}</strong><small>{profile?.bio?.trim() || '认真记录日常，慢慢享受生活。'}</small></span></button>
    <RecentTodos account={account} />
  </section>;
}
