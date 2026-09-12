import { useEffect, useRef, useState } from 'react';
import { AUDIO_LIMIT, type EggMedia } from '../../../shared/egg';
import { readMedia } from './media';

function permissionError(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === 'NotAllowedError' || reason.name === 'SecurityError') return '麦克风被拒绝或被系统限制。请在此 PWA／安装它的浏览器的权限设置中允许麦克风，再检查系统是否允许该应用使用麦克风。';
    if (reason.name === 'NotFoundError') return '没有找到可用麦克风，请检查设备或耳机连接。';
    if (reason.name === 'NotReadableError' || reason.name === 'AbortError') return '麦克风暂时不可用，可能被其他应用占用或被系统限制。请结束其他录音后重试。';
  }
  return reason instanceof Error ? reason.message : '无法打开麦克风，请重试。';
}

export function useRecording(onReady: (value: EggMedia) => void, onError: (message: string) => void) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const session = useRef<{ active: boolean; pending: boolean; requestId: number; permissionTimer?: number; recorder: MediaRecorder | null; stream: MediaStream | null; timeout?: number; interval?: number }>({ active: true, pending: false, requestId: 0, recorder: null, stream: null });
  function cancelRequest() {
    const state = session.current;
    if (!state.pending) return;
    state.requestId++; state.pending = false;
    clearTimeout(state.permissionTimer);
    if (state.active) setPhase('idle');
  }
  function stop() {
    const state = session.current;
    clearTimeout(state.timeout); clearInterval(state.interval);
    if (state.recorder?.state === 'recording') { setPhase('finishing'); state.recorder.stop(); }
    state.stream?.getTracks().forEach(track => track.stop());
  }
  useEffect(() => {
    const state = session.current;
    state.active = true;
    const hidden = () => { if (document.hidden && state.recorder?.state === 'recording') { state.recorder.stop(); state.stream?.getTracks().forEach(track => track.stop()); } };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      state.active = false; state.requestId++; state.pending = false;
      clearTimeout(state.permissionTimer);
      clearTimeout(state.timeout); clearInterval(state.interval);
      document.removeEventListener('visibilitychange', hidden);
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
      state.stream?.getTracks().forEach(track => track.stop());
    };
  }, []);
  async function start() {
    const state = session.current;
    if (state.pending || state.recorder?.state === 'recording') return;
    if (!window.isSecureContext) { onError('录音需要安全连接，请从 HTTPS 地址打开应用。'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError('当前浏览器不支持录音，请使用支持录音的 HTTPS 浏览器'); return; }
    const requestId = ++state.requestId;
    state.pending = true; setPhase('requesting'); onError('');
    state.permissionTimer = window.setTimeout(() => {
      if (state.active && state.pending && state.requestId === requestId) {
        cancelRequest();
        onError('麦克风授权尚未返回。请检查系统或浏览器的麦克风权限，再点开始录音；图片和文案仍可继续编辑。');
      }
    }, 30000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!state.active || state.requestId !== requestId) { stream.getTracks().forEach(track => track.stop()); return; }
      clearTimeout(state.permissionTimer); state.pending = false;
      if (document.hidden) { stream.getTracks().forEach(track => track.stop()); setPhase('idle'); onError('已获得麦克风权限，请回到应用后再次点击开始录音。'); return; }
      state.stream = stream;
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('当前浏览器没有可用的录音格式');
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      state.recorder = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; stop(); if (state.active) onError('录音失败，请重新录制'); };
      recorder.onstop = () => {
        clearTimeout(state.timeout); clearInterval(state.interval);
        stream.getTracks().forEach(track => track.stop());
        if (!state.active) return;
        setPhase('finishing');
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (failed || !blob.size || blob.size > AUDIO_LIMIT) { setPhase('idle'); if (!failed) onError(blob.size ? '录音过大，请重新录制' : '没有录到声音，请重试'); return; }
        const extension = recorder.mimeType.includes('mp4') ? 'm4a' : recorder.mimeType.includes('ogg') ? 'ogg' : 'webm';
        void readMedia(blob, `录音.${extension}`).then(value => { if (state.active) onReady(value); }).catch(() => { if (state.active) onError('录音读取失败，请重试'); }).finally(() => { if (state.active) setPhase('idle'); });
      };
      recorder.start(); setSeconds(0); setPhase('recording');
      const started = performance.now();
      state.timeout = window.setTimeout(stop, 15000);
      state.interval = window.setInterval(() => setSeconds(Math.min(15, Math.floor((performance.now() - started) / 1000))), 200);
    } catch (reason) {
      if (state.requestId === requestId) {
        state.stream?.getTracks().forEach(track => track.stop());
        if (state.active) { setPhase('idle'); onError(permissionError(reason)); }
      }
    } finally { if (state.requestId === requestId) { clearTimeout(state.permissionTimer); state.pending = false; } }
  }
  return { phase, seconds, start, stop, cancelRequest };
}
