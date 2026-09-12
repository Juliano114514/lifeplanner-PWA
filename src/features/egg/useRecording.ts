import { useEffect, useRef, useState } from 'react';
import { AUDIO_LIMIT, type EggMedia } from '../../../shared/egg';
import { readMedia } from './media';

export function useRecording(onReady: (value: EggMedia) => void, onError: (message: string) => void) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const session = useRef<{ active: boolean; pending: boolean; recorder: MediaRecorder | null; stream: MediaStream | null; timeout?: number; interval?: number }>({ active: true, pending: false, recorder: null, stream: null });
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
      state.active = false;
      clearTimeout(state.timeout); clearInterval(state.interval);
      document.removeEventListener('visibilitychange', hidden);
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
      state.stream?.getTracks().forEach(track => track.stop());
    };
  }, []);
  async function start() {
    const state = session.current;
    if (state.pending || state.recorder?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError('当前浏览器不支持录音，请使用支持录音的 HTTPS 浏览器'); return; }
    state.pending = true; setPhase('requesting'); onError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!state.active || document.hidden) { stream.getTracks().forEach(track => track.stop()); if (state.active) setPhase('idle'); return; }
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
      state.stream?.getTracks().forEach(track => track.stop());
      if (state.active) { setPhase('idle'); onError(reason instanceof DOMException && reason.name === 'NotAllowedError' ? '未获得麦克风权限，请允许录音后重试' : reason instanceof Error ? reason.message : '无法打开麦克风'); }
    } finally { state.pending = false; }
  }
  return { phase, seconds, start, stop };
}
