import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Identity } from '../../shared/contracts';
import { api, ApiFailure } from '../data/api';
import { cachedAccount, readAccount, saveIdentity, subscribe, type Account } from '../data/store';
import { synchronize } from '../data/sync';
const TasksPage = lazy(() => import('../features/tasks/TasksPage').then(module => ({ default: module.TasksPage })));

const tabs = [
  { path: 'tasks', label: '任务', icon: '✓' }, { path: 'schedule', label: '日程', icon: '▦' },
  { path: 'diary', label: '日记', icon: '▤' }, { path: 'dishes', label: '菜品', icon: '◒' },
  { path: 'inventory', label: '库存', icon: '▣' },
];
export function App() {
  const [account, setAccount] = useState<Account>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [editing, setEditing] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const id = account?.identity.user.id;
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
  const authError = new URLSearchParams(window.location.search).get('authError');
  return <div className="app-layout"><aside className="sidebar"><NavLink to="/tasks" className="brand"><img src="/icon.svg" alt="" /><span>LifePlanner<small>两个人的日常</small></span></NavLink>
    <nav aria-label="主要导航">{tabs.map(tab => <NavLink key={tab.path} to={`/${tab.path}`}><span aria-hidden="true">{tab.icon}</span>{tab.label}</NavLink>)}</nav>
    <div className="sidebar-note"><span>✳</span><p>不必填满每一天。<br />一起，留点时间给生活。</p></div></aside>
    <div className="main-column"><header className="topbar"><span className="workspace-label">OUR EVERYDAY <i> / </i> 共享空间</span>
      {account ? <div className="account-actions"><span className="avatar">{account.identity.user.name.slice(0, 1)}</span><span className="user-name">{account.identity.user.name}</span><button className="text-button" onClick={() => void logout()}>退出</button></div> : <span className="small-leaf">✳</span>}</header>
      <main>
        {loading ? <section className="welcome"><p className="eyebrow">LIFEPLANNER</p><h1>正在打开你的日常…</h1></section> : !account ?
          <section className="welcome"><p className="eyebrow">JUST THE TWO OF US</p><h1>把小事记下，<br />把生活留给彼此。</h1><p className="muted">一个只属于两个人的生活计划本。<br />任务共享，归属清晰，离线也能记录。</p>
            <a className="primary login" href="/api/auth/github/login">使用 GitHub 登录<span>↗</span></a><p className="hint">仅允许预先配置的两个 GitHub 账号。</p>
            {authError && <p role="alert" className="notice">{authError === 'forbidden' ? '这个 GitHub 账号不在共享空间的白名单中。' : 'GitHub 登录未完成，请重新尝试。'}</p>}
            {message && <p role="status" className="notice">{message}</p>}
            <div className="install-tip"><strong>随手可用，像一个 App</strong><p>在 iPhone Safari 中点“分享”，选择“添加到主屏幕”。</p></div>
          </section> : <>
            <div className="sync-strip" role="status"><span className={`status-dot ${!online || reauth ? 'offline' : ''}`} />
              <span>{!online ? '离线 · 修改保存在本机' : reauth ? '请重新登录 · 本机修改已保留' : busy ? '正在同步…' : account.pending.length ? `${account.pending.length} 项修改待同步` : account.lastSync ? `已同步 · ${new Date(account.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待首次同步'}</span>
              {reauth ? <a href="/api/auth/github/login">重新登录 ↗</a> : <button className="text-button" disabled={busy || !online} onClick={syncNow}>↻ 同步</button>}</div>
            {message && <p role="alert" className="notice">{message}</p>}
            {waiting && <div className="notice">新版本已准备好，草稿和待同步内容会保留。<button className="text-button" disabled={editing} onClick={() => {
              navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
              waiting.postMessage({ type: 'ACTIVATE' });
            }}>{editing ? '关闭编辑页后更新' : '更新应用'}</button></div>}
            <Suspense fallback={<p className="empty">正在打开任务…</p>}><Routes><Route path="/tasks" element={<TasksPage key={id} account={account} sync={syncNow} onEditing={setEditing} />} />
              {tabs.slice(1).map(tab => <Route key={tab.path} path={`/${tab.path}`} element={<section className="placeholder"><span className="placeholder-icon">{tab.icon}</span><p className="eyebrow">ONE STEP AT A TIME</p><h1>{tab.label}，接下来见。</h1><p>这个模块尚未实现。<br />后续将按安卓现有功能接入共享空间。</p><NavLink className="primary" to="/tasks">先安排一件小事<span>↗</span></NavLink></section>} />)}
              <Route path="*" element={<Navigate to="/tasks" replace />} /></Routes></Suspense>
          </>}
      </main><footer className="page-footer">LifePlanner <span>·</span> 留一点时间，好好生活。</footer></div>
  </div>;
}
