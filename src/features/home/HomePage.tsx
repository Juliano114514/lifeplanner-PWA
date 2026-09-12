import { useEffect, useRef, useState } from 'react';
import { materialize, materializePlanner, type Account } from '../../data/store';
import { RecentTodos } from '../planner/RecentTodos';
import { EggDialog } from '../egg/EggDialog';

function updatedLabel(at: number, now: number, zone: string) {
  if (!at) return '暂无记录';
  const days = Math.floor(Math.max(0, now - at) / 86400000);
  if (days < 1) return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  if (days < 7) return `${days}天前`;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: 'long', day: 'numeric' }).format(at);
}
export function HomePage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const userId = account.identity.user.id;
  const [selected, setSelected] = useState(userId), [birthday, setBirthday] = useState(false), [now, setNow] = useState(Date.now);
  const clicks = useRef({ id: '', count: 0, at: 0 });
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const members = [account.identity.user, ...account.identity.members.filter(member => member.id !== userId)];
  const planner = materializePlanner(account);
  const records = [...materialize(account), ...planner.schedules, ...planner.diaryDays, ...planner.stocks];
  const name = account.profile?.name || account.identity.user.name;
  function tap(id: string) {
    setSelected(id);
    const at = performance.now(), previous = clicks.current;
    const count = previous.id === id && at - previous.at <= 1000 ? previous.count + 1 : 1;
    clicks.current = { id, count, at };
    if (count === 5) { clicks.current = { id: '', count: 0, at: 0 }; setBirthday(true); }
  }
  return <section className="welcome home-page"><p className="eyebrow">JUST THE TWO OF US</p><h1>{name}，今天打算做什么？</h1>
    <div className="home-members" role="group" aria-label="选择待办所属用户">{members.map(member => {
      const profile = member.id === userId ? account.profile ?? member.profile : member.profile;
      const displayName = profile?.name || member.name;
      const updatedAt = Math.max(0, ...records.filter(record => record.updatedBy === member.id).map(record => record.updatedAt), ...planner.shopping.filter(record => record.createdBy === member.id).map(record => record.createdAt));
      return <button type="button" className={`home-profile ${selected === member.id ? 'selected' : ''}`} key={member.id} onClick={() => tap(member.id)} aria-pressed={selected === member.id} aria-label={`查看${displayName}的待办`}>
        <span className="home-profile-main"><span className="avatar">{profile?.avatar ? <img src={profile.avatar} alt="" /> : displayName.slice(0, 1)}</span><span className="home-profile-copy"><span className="home-profile-name"><strong>{displayName}</strong><small>最近更新（{updatedLabel(updatedAt, now, account.identity.timeZone)}）</small></span><small>{profile?.bio?.trim() || '认真记录日常，慢慢享受生活。'}</small></span></span>
        <span className="task-checkbox" aria-hidden="true">{selected === member.id ? '✓' : ''}</span>
      </button>;
    })}</div>
    <RecentTodos key={selected} account={account} ownerId={selected} sync={sync} />
    {birthday && <EggDialog account={account} ownerId={selected} onClose={() => setBirthday(false)} onEditing={onEditing} />}
  </section>;
}
