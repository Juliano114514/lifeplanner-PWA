import { useEffect, useRef, useState, type FormEvent } from 'react';
import { applyCommand, ensureOperation, localDateTime, today, toEpoch } from '../../../shared/domain';
import { materialize, saveProfile, type Account } from '../../data/store';
import { Modal } from '../planner/PlannerUi';

export function ProfileDialog({ account, onClose, sync }: { account: Account; onClose: () => void; sync: () => void }) {
  const [name, setName] = useState(account.profile?.name ?? account.identity.user.name);
  const [avatar, setAvatar] = useState(account.profile?.avatar ?? '');
  const [bio, setBio] = useState(account.profile?.bio ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [now, setNow] = useState(Date.now);
  const upload = useRef({ version: 0 });
  useEffect(() => {
    const pendingUpload = upload.current;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(timer); pendingUpload.version++; };
  }, []);
  const zone = account.identity.timeZone;
  const recent = materialize(account).filter(task => !task.isArchived && task.ownerId === account.identity.user.id).flatMap(task => {
    // Generate nearby recurring instances in memory without changing the sync queue.
    const expanded = task.recurrence ? applyCommand(task, {
      mutationId: 'profile-preview', taskId: task.id, expectedVersion: task.version,
      operation: ensureOperation(today(zone, now)),
    }, account.identity.user.id, zone, now) : task;
    const nearest = expanded.occurrences.filter(item => item.status === 'PENDING').map(item => ({
      item, at: item.dueAt ?? toEpoch(`${item.plannedDate}T00:00`, zone),
    })).sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now) || a.at - b.at)[0];
    return nearest ? [{ task, ...nearest }] : [];
  }).sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now) || a.at - b.at || a.task.id.localeCompare(b.task.id)).slice(0, 5);

  async function chooseAvatar(file: File) {
    const version = ++upload.current.version;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setReading(false); setError('请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片。'); return;
    }
    setReading(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法处理图片');
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      if (version === upload.current.version) setAvatar(canvas.toDataURL('image/png'));
    } catch { if (version === upload.current.version) setError('图片无法读取，请换一张图片。'); }
    finally { URL.revokeObjectURL(url); if (version === upload.current.version) setReading(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || reading) return;
    if (!name.trim()) { setError('请输入名称。'); return; }
    setBusy(true); setError('');
    try {
      await saveProfile(account.identity.user.id, { name: name.trim(), avatar, bio: bio.trim() });
      sync();
      onClose();
    } catch { setError('保存失败，请检查本机存储空间后重试。'); }
    finally { setBusy(false); }
  }
  return <Modal title="个人资料" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={event => void save(event)}>
      <fieldset disabled={busy}>
        <div className="profile-avatar-row"><span className="avatar profile-avatar">{avatar ? <img src={avatar} alt="头像预览" /> : name.trim().slice(0, 1) || '我'}</span>
          <div><label>更换头像<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseAvatar(file);
          }} /></label><button type="button" className="text-button" disabled={!avatar || reading} onClick={() => setAvatar('')}>恢复默认头像</button></div></div>
        <p className="hint">图片居中裁剪为正方形，最大 5 MB。</p>
        <label>名称<input value={name} maxLength={40} required onChange={event => setName(event.target.value)} /></label>
        <label>个人简介<textarea value={bio} rows={3} maxLength={300} placeholder="写一点关于自己的事…" onChange={event => setBio(event.target.value)} /></label>
        <p className="hint">保存后所有归属人名称立即更新，联网后同步给对方和自己的其他设备。离线修改会保留；多设备编辑以最后同步的资料为准。</p>
        {error && <p role="alert" className="notice error-text">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={reading || busy}>{reading ? '处理图片中…' : busy ? '保存中…' : '保存资料'}</button></div>
      </fieldset>
    </form>
    <section aria-label="最近的五条 Todo"><h3>最近的五条 Todo</h3><p className="hint">我的未完成任务 · 按时间接近程度排序，重复任务仅显示最近一次。</p>
      {recent.length ? <ul className="profile-todos">{recent.map(({ task, item }) => <li key={task.id}><strong>{task.title}</strong><span className="muted">{item.dueAt === null ? `计划 ${item.plannedDate}` : `截止 ${localDateTime(item.dueAt, zone).replace('T', ' ')}`}</span></li>)}</ul> : <p className="empty">无</p>}
    </section>
  </Modal>;
}
