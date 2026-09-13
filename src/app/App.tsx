import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Identity } from '../../shared/contracts';
import { api, ApiFailure } from '../data/api';
import { cachedAccount, readAccount, resolvePlannerConflict, saveIdentity, subscribe, type Account } from '../data/store';
import { synchronize } from '../data/sync';
import { ProfileDialog } from '../features/profile/ProfileDialog';
const EggHistoryPage = lazy(() => import('../features/egg/EggHistoryPage').then(module => ({ default: module.EggHistoryPage })));
const HomePage = lazy(() => import('../features/home/HomePage').then(module => ({ default: module.HomePage })));
const TasksPage = lazy(() => import('../features/tasks/TasksPage').then(module => ({ default: module.TasksPage })));
const SchedulePage = lazy(() => import('../features/schedule/SchedulePage').then(module => ({ default: module.SchedulePage })));
const DiaryPage = lazy(() => import('../features/diary/DiaryPage').then(module => ({ default: module.DiaryPage })));
const DishesPage = lazy(() => import('../features/inventory/InventoryPages').then(module => ({ default: module.DishesPage })));
const InventoryPage = lazy(() => import('../features/inventory/InventoryPages').then(module => ({ default: module.InventoryPage })));
const InventoryHome = lazy(() => import('../features/inventory/InventoryPages').then(module => ({ default: module.InventoryHome })));
const ShoppingPage = lazy(() => import('../features/inventory/InventoryPages').then(module => ({ default: module.ShoppingPage })));

const WishesHome = lazy(() => import('../features/wishes/WishesPage').then(module => ({ default: module.WishesHome })));
const WishesPage = lazy(() => import('../features/wishes/WishesPage').then(module => ({ default: module.WishesPage })));

const tabs = [
  { path: 'home', label: '首页', icon: '⌂' },
  { path: 'tasks', label: '任务', icon: '✓' }, { path: 'schedule', label: '日程', icon: '▦' },
  { path: 'wishes', label: '愿望', icon: '♡' },
  { path: 'diary', label: '日记', icon: '▤' },
  { path: 'inventory', label: '库存', icon: '▣' },
];
export function App() {
  const location = useLocation();
  const [account, setAccount] = useState<Account>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [editing, setEditing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const id = account?.identity.user.id;
  const displayName = account?.profile?.name ?? account?.identity.user.name ?? '';
  const pendingCount = account ? account.pending.length + account.plannerPending.length + (account.profilePending ? 1 : 0) : 0;
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const identity = await api<Identity>('/api/v1/me');
        await saveIdentity(identity);
        const result = await readAccount(identity.user.id);
        if (!cancelled) setAccount(result);
      } catch (error) {
        const cached = await cachedAccount();
        if (cancelled) return;
        if (cached) setAccount(cached);
        if (error instanceof ApiFailure) {
          setReauth(error.status === 401);
          setMessage(error.status === 401 && !cached ? '' : error.message);
        } else setMessage(cached ? '当前无法连接，已打开本机数据。编辑会保存在本机。' : '首次使用需要联网并登录 GitHub。');
      } finally { if (!cancelled) setLoading(false); }
    }
    void boot().catch(() => { setLoading(false); setMessage('无法打开本地存储，请关闭无痕模式或检查可用空间。'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!id) return;
    let active = true;
    return (() => {
      const unsubscribe = subscribe(() => { void readAccount(id).then(value => { if (active) setAccount(value); }).catch(() => setMessage('读取本地数据失败')); });
      return () => { active = false; unsubscribe(); };
    })();
  }, [id]);
  const syncNow = useCallback(() => {
    if (!id || reauth || !navigator.onLine) return;
    setBusy(true);
    void synchronize(id).then(() => setMessage('')).catch(error => {
      if (error instanceof ApiFailure) { setMessage(error.message); if (error.status === 401) setReauth(true); }
      else setMessage('暂时无法同步，本机修改已保留，稍后会重试。');
    }).finally(() => setBusy(false));
  }, [id, reauth]);
  useEffect(() => {
    syncNow();
    const restored = () => { setOnline(true); syncNow(); };
    const offline = () => setOnline(false);
    const visible = () => { if (document.visibilityState === 'visible') syncNow(); };
    window.addEventListener('online', restored); window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(visible, 30000);
    return () => { clearInterval(interval); window.removeEventListener('online', restored); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [syncNow]);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let active = true;
    void navigator.serviceWorker.register('/sw.js').then(registration => {
      if (!active) return;
      if (registration.waiting) setWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (active && worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker); });
      });
    }).catch(() => setMessage('离线应用外壳未能安装，请保持联网并重新打开页面。'));
    return () => { active = false; };
  }, []);
  async function logout() {
    try {
      await api('/api/auth/logout', {});
      localStorage.removeItem('lp-account');
      // Keep account-partitioned drafts/outbox for the same user's next login.
      window.location.assign('/tasks');
    } catch { setMessage('退出需要联网，以便注销服务端会话。本机待同步内容会保留。'); }
  }
  async function choosePlannerConflict(choice: 'cloud' | 'local') {
    if (!id) return;
    try { await resolvePlannerConflict(id, choice); setMessage(''); syncNow(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '无法处理生活记录冲突，请先采用云端再重新编辑。'); }
  }
  const authError = new URLSearchParams(window.location.search).get('authError');
  return <div className="app-layout"><aside className="sidebar"><NavLink to="/home" className="brand"><img src="/icon.svg" alt="" /><span>LifePlanner<small>两个人的日常</small></span></NavLink>
    <nav aria-label="主要导航">{tabs.map(tab => <NavLink key={tab.path} to={`/${tab.path}`} className={tab.path === 'inventory' && location.pathname === '/dishes' ? 'active' : undefined}><span aria-hidden="true">{tab.icon}</span>{tab.label}</NavLink>)}</nav>
    <div className="sidebar-note"><span>✳</span><p>不必填满每一天。<br />一起，留点时间给生活。</p></div></aside>
    <div className="main-column"><header className="topbar"><span className="workspace-label">OUR EVERYDAY <i> / </i> 共享空间</span>
      {account ? <div className="account-actions"><button className="avatar" aria-label="打开个人资料" aria-haspopup="dialog" onClick={() => setProfileOpen(true)}>{account.profile?.avatar ? <img src={account.profile.avatar} alt="" /> : displayName.slice(0, 1)}</button><span className="user-name">{displayName}</span><button className="text-button" onClick={() => void logout()}>退出</button></div> : <span className="small-leaf">✳</span>}</header>
      <main>
        {loading ? <section className="welcome"><p className="eyebrow">LIFEPLANNER</p><h1>正在打开你的日常…</h1></section> : !account ?
          <section className="welcome"><p className="eyebrow">JUST THE TWO OF US</p><h1>把小事记下，<br />把生活留给彼此。</h1><p className="muted">一个只属于两个人的生活计划本。<br />任务共享，归属清晰，离线也能记录。</p>
            <a className="primary login" href="/api/auth/github/login">使用 GitHub 登录<span>↗</span></a><p className="hint">仅允许预先配置的两个 GitHub 账号。</p>
            {authError && <p role="alert" className="notice">{authError === 'forbidden' ? '这个 GitHub 账号不在共享空间的白名单中。' : 'GitHub 登录未完成，请重新尝试。'}</p>}
            {message && <p role="status" className="notice">{message}</p>}
            <div className="install-tip"><strong>随手可用，像一个 App</strong><p>在 iPhone Safari 中点“分享”，选择“添加到主屏幕”。</p></div>
          </section> : <>
            <div className="sync-strip" role="status"><span className={`status-dot ${!online || reauth ? 'offline' : ''}`} />
              <span>{!online ? '离线 · 修改保存在本机' : reauth ? '请重新登录 · 本机修改已保留' : busy ? '正在同步…' : pendingCount ? `${pendingCount} 项修改待同步` : account.lastSync ? `已同步 · ${new Date(account.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待首次同步'}</span>
              {reauth ? <a href="/api/auth/github/login">重新登录 ↗</a> : <button className="text-button" disabled={busy || !online} onClick={syncNow}>↻ 同步</button>}</div>
            {message && <p role="alert" className="notice">{message}</p>}
            {waiting && <div className="notice">新版本已准备好，草稿和待同步内容会保留。<button className="text-button" disabled={editing || profileOpen} onClick={() => {
              navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
              waiting.postMessage({ type: 'ACTIVATE' });
            }}>{editing || profileOpen ? '关闭编辑页后更新' : '更新应用'}</button></div>}
            {profileOpen && <ProfileDialog key={id} account={account} onClose={() => setProfileOpen(false)} sync={syncNow} />}
            {account.plannerConflict && <section className="conflict" role="alert"><p className="eyebrow">需要你来决定</p><h3>共享生活记录有不同版本</h3><p>{account.plannerConflict.message}</p><p className="hint">日程、愿望、日记、菜品、库存和采购属于同一原子版本；任务不受这次选择影响。</p><div className="actions"><button onClick={() => void choosePlannerConflict('cloud')}>采用云端，放弃本机修改</button><button onClick={() => void choosePlannerConflict('local')}>在云端最新版上重放本机修改</button></div></section>}
            <Suspense fallback={<p className="empty">正在打开生活计划…</p>}><Routes><Route path="/home" element={<HomePage key={id} account={account} sync={syncNow} onEditing={setEditing} />} /><Route path="/tasks" element={<TasksPage key={id} account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="/schedule" element={<SchedulePage account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="/diary" element={<DiaryPage account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="/dishes" element={<DishesPage account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="/wishes" element={<WishesHome />} />
              <Route path="/wishes/:kind" element={<WishesPage key={location.pathname} account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="/inventory" element={<InventoryHome />} />
              <Route path="/inventory/items" element={<InventoryPage account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="/egg-history" element={<EggHistoryPage key={id} account={account} onEditing={setEditing} />} />
              <Route path="/shopping" element={<ShoppingPage account={account} sync={syncNow} onEditing={setEditing} />} />
              <Route path="*" element={<Navigate to="/home" replace />} /></Routes></Suspense>
          </>}
      </main><footer className="page-footer">LifePlanner <span>·</span> 留一点时间，好好生活。</footer></div>
  </div>;
}
