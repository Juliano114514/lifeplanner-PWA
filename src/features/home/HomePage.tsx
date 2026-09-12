import { useEffect, useRef, useState } from 'react';
import type { Account } from '../../data/store';
import { RecentTodos } from '../planner/RecentTodos';
import { EggDialog } from '../egg/EggDialog';

function updatedLabel(at: number, now: number, zone: string) {
  if (!at) return '尚未同步';
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}秒前`;
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}分钟前`;
  const days = Math.floor(elapsed / 86400000);
  if (days < 1) return `${Math.floor(elapsed / 3600000)}小时前（${new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)}）`;
  if (days < 7) return `${days}天前`;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'long', day: 'numeric' }).format(at);
}
export function HomePage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const userId = account.identity.user.id;
  const [selected, setSelected] = useState(userId), [birthday, setBirthday] = useState<string | null>(null), [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const clicks = useRef({ id: '', count: 0, at: 0 });
  function tapCard(id: string) {
    setSelected(id);
    const at = performance.now(), previous = clicks.current;
    const count = previous.id === id && at - previous.at <= 1000 ? previous.count + 1 : 1;
    clicks.current = { id, count, at };
    if (count === 5) { clicks.current = { id: '', count: 0, at: 0 }; setBirthday(id); }
  }
  const members = [account.identity.user, ...account.identity.members.filter(member => member.id !== userId)];
  const name = account.profile?.name || account.identity.user.name;
  return <section className="welcome home-page"><p className="eyebrow">JUST THE TWO OF US</p><h1>{name}，今天打算做什么？</h1>
    <div className="home-members" role="group" aria-label="选择待办所属用户">{members.map(member => {
      const profile = member.id === userId ? account.profile ?? member.profile : member.profile;
      const displayName = profile?.name || member.name;
      const updatedAt = member.lastSyncAt ?? 0;
      return <button type="button" className={`home-profile ${selected === member.id ? 'selected' : ''}`} key={member.id} onClick={() => tapCard(member.id)} aria-pressed={selected === member.id} aria-label={`查看${displayName}的待办，连续点击五次打开彩蛋`}>
        <span className="avatar home-profile-avatar" aria-hidden="true">{profile?.avatar ? <img src={profile.avatar} alt="" /> : displayName.slice(0, 1)}</span>
        <span className="home-profile-select">
          <span className="home-profile-copy"><span className="home-profile-name"><strong>{displayName}</strong><small>最近同步：{updatedLabel(updatedAt, now, account.identity.timeZone)}</small></span><small>{profile?.bio?.trim() || '认真记录日常，慢慢享受生活。'}</small></span>
          <span className="task-checkbox" aria-hidden="true">{selected === member.id ? '✓' : ''}</span>
        </span>
      </button>;
    })}</div>
    <RecentTodos key={selected} account={account} ownerId={selected} sync={sync} />
    {birthday && <EggDialog account={account} ownerId={birthday} onClose={() => setBirthday(null)} onEditing={onEditing} />}
  </section>;
}
