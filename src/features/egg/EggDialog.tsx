import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { eggDraftSchema, IMAGE_LIMIT, type EggDraft, type EggEntry, type EggMedia } from '../../../shared/egg';
import { readEgg, writeEgg } from '../../data/eggs';
import type { Account } from '../../data/store';
import { Modal } from '../planner/PlannerUi';
import { imageMime, mediaSource, readMedia } from './media';
import { useRecording } from './useRecording';

export function EggDialog({ account, ownerId, entryId, onClose, onEditing }: { account: Account; ownerId?: string; entryId?: string; onClose: () => void; onEditing: (value: boolean) => void }) {
  const navigate = useNavigate();
  const [entry, setEntry] = useState<EggEntry | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [editing, setEditing] = useState(false), [reload, setReload] = useState(0);
  const [editRequested, setEditRequested] = useState(false);
  const [choosing, setChoosing] = useState(false), [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    void readEgg(account.identity.user.id, editRequested ? account.identity.user.id : ownerId, editRequested ? undefined : entryId).then(result => { if (active) { setEntry(result.entry); setError(''); if (editRequested) setEditing(true); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '无法读取彩蛋'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account.identity.user.id, ownerId, entryId, reload, editRequested]);
  useEffect(() => { onEditing(true); return () => onEditing(false); }, [onEditing]);
  const author = entry?.authorName ?? account.identity.members.find(member => member.id === (editRequested ? account.identity.user.id : ownerId))?.name ?? account.identity.user.name;
  if (editing) return <EggEditor account={account} initial={creating ? null : entry} onHistory={() => { onClose(); navigate('/egg-history'); }} onCancel={() => setEditing(false)} onSaved={value => { setEntry(value); setEditing(false); }} />;
  if (choosing) return <Modal title="我也要写" onClose={() => setChoosing(false)}>
    <div className="editor-footer">
      <button type="button" className="secondary" onClick={() => { setChoosing(false); setCreating(false); setLoading(true); setEditRequested(true); setReload(value => value + 1); }}>修改</button>
      <button type="button" className="primary" onClick={() => { setChoosing(false); setCreating(true); setEditing(true); }}>新建</button>
    </div>
  </Modal>;
  return <Modal title={`${author}说`} onClose={onClose}>
    {loading ? <p role="status">正在打开彩蛋…</p> : error ? <p className="notice error-text" role="alert">{error}<button className="text-button" onClick={() => { setLoading(true); setReload(value => value + 1); }}>重试</button></p> : (entry?.text || entry?.image || entry?.audio) ? <div className="egg-content">{entry.text && <p className="egg-text">{entry.text}</p>}
      {entry?.image && <img className="egg-image" src={mediaSource(entry.image)} alt={entry.image.name} />}
      {entry?.audio && <audio controls preload="metadata" src={mediaSource(entry.audio)}>当前浏览器不支持音频播放。</audio>}
    </div> : null}
    <div className="plan-date-actions"><button className="primary" onClick={onClose}>确定</button></div>
    <button className="text-button egg-footer-link" disabled={loading || !!error} onClick={() => setChoosing(true)}>我也要写</button>
  </Modal>;
}
function EggEditor({ account, initial, onCancel, onSaved, onHistory }: { account: Account; initial: EggEntry | null; onCancel: () => void; onHistory: () => void; onSaved: (entry: EggEntry) => void }) {
  const [draft, setDraft] = useState<EggDraft>(() => ({ text: initial?.text ?? '', image: initial?.image ?? null, audio: initial?.audio ?? null }));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [reading, setReading] = useState(false);
  const alive = useRef(true), request = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const recording = useRecording(value => setDraft(current => ({ ...current, audio: value })), setError);
  const busy = saving || reading || recording.phase !== 'idle';
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > IMAGE_LIMIT) { setError('图片不能超过 10 MB，请缩小后再上传'); return; }
    if (file.name.length > 200) { setError('图片名称过长，请重命名后再上传'); return; }
    setReading(true); setError('');
    try {
      const mime = await imageMime(file);
      if (!mime) throw new Error('请选择 PNG、JPG、GIF 或 WebP 图片；其他相册格式请先转为 JPG');
      const image = await readMedia(file.slice(0, file.size, mime), file.name || '图片');
      await new Promise<void>((resolve, reject) => { const preview = new Image(); preview.onload = () => resolve(); preview.onerror = () => reject(new Error('图片文件无法打开')); preview.src = mediaSource(image); });
      if (alive.current) setDraft(current => ({ ...current, image }));
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '图片读取失败'); }
    finally { if (alive.current) setReading(false); }
  }
  async function save() {
    const parsed = eggDraftSchema.safeParse(draft);
    if (!parsed.success) { setError(!draft.text.trim() && !draft.image && !draft.audio ? '请至少填写一项内容' : '内容校验失败，请检查文案长度、图片大小或重新录音'); return; }
    setSaving(true); setError('');
    const body = JSON.stringify(parsed.data);
    if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
    try { const result = await writeEgg<{ entry: EggEntry }>(account.identity.user.id, '/api/v1/eggs', { id: request.current.id, ownerId: account.identity.user.id, draft: parsed.data }); if (alive.current) onSaved(result.entry); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { if (alive.current) setSaving(false); }
  }
  function remove(kind: 'image' | 'audio') { setDraft(current => ({ ...current, [kind]: null })); }
  function preview(value: EggMedia, kind: 'image' | 'audio') {
    return <div className="egg-media-preview">{kind === 'image' ? <img className="egg-image" src={mediaSource(value)} alt={value.name} /> : <audio controls src={mediaSource(value)} />}<p className="hint">{value.name}</p><button type="button" className="text-button" disabled={busy} onClick={() => remove(kind)}>移除{kind === 'image' ? '图片' : '录音'}</button></div>;
  }
  return <Modal title="写一个彩蛋" onClose={() => { if (!saving) onCancel(); }}><form onSubmit={event => { event.preventDefault(); if (!busy) void save(); }}>
    <label>正文文案<textarea rows={4} maxLength={10000} disabled={saving} value={draft.text} onChange={event => setDraft(current => ({ ...current, text: event.target.value }))} /></label>
    <label>图片（支持 GIF，最大 10 MB）<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp" disabled={saving || reading || recording.phase === 'recording' || recording.phase === 'finishing'} onClick={recording.cancelRequest} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} /></label>
    {reading && <p role="status">正在读取图片…</p>}{draft.image && preview(draft.image, 'image')}
    <div className="egg-recording"><strong>录音（最多 15 秒）</strong><p role="status">{recording.phase === 'requesting' ? '正在等待麦克风授权，请查看系统提示；没有弹窗时可取消等待并检查权限设置。' : recording.phase === 'recording' ? `录音中 ${recording.seconds} / 15 秒` : recording.phase === 'finishing' ? '正在处理录音…' : '可主动停止，15 秒自动停止。'}</p>
      {recording.phase === 'requesting' ? <button type="button" className="text-button" onClick={recording.cancelRequest}>取消等待</button> : recording.phase === 'recording' ? <button type="button" className="secondary" onClick={recording.stop}>停止录音</button> : <button type="button" className="secondary" disabled={busy} onClick={() => void recording.start()}>{draft.audio ? '重新录音' : '开始录音'}</button>}
    </div>{draft.audio && preview(draft.audio, 'audio')}
    {error && <p className="notice error-text" role="alert">{error}</p>}
    <div className="editor-footer"><button type="button" className="text-button" disabled={saving} onClick={onCancel}>取消</button><button className="primary" disabled={busy}>{saving ? '保存中…' : '确定'}</button></div>
    <button type="button" className="text-button egg-footer-link" disabled={saving} onClick={onHistory}>历史记录</button>
  </form></Modal>;
}
