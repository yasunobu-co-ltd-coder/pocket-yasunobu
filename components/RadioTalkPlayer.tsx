'use client';

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Radio, Play, Pause, Square, Loader2 } from 'lucide-react';
import type { ScriptSegment, SpeakerMap, RadioTalkStatus } from '@/lib/radio-talk-types';
import { DEFAULT_SPEAKER_MAP, SPEAKER_VOICE_OPTIONS } from '@/lib/radio-talk-types';

type PlayerStatus = 'idle' | 'generating_script' | 'generating_audio' | 'merging' | 'ready' | 'playing' | 'paused' | 'error';

interface RadioTalkPlayerProps {
  minuteId: number | string;
  onPlaybackChange?: (playing: boolean) => void;
}

export interface RadioTalkPlayerHandle {
  stop: () => void;
}

const POLL_MS = 2000;
const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;

const RadioTalkPlayer = forwardRef<RadioTalkPlayerHandle, RadioTalkPlayerProps>(function RadioTalkPlayer(
  { minuteId, onPlaybackChange },
  ref
) {
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [progressText, setProgressText] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [script, setScript] = useState<ScriptSegment[] | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [durationSec, setDurationSec] = useState<number | null>(null);

  // 話者設定
  const [speakerA, setSpeakerA] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SPEAKER_MAP.A;
    return parseInt(localStorage.getItem('radio-speaker-a') || String(DEFAULT_SPEAKER_MAP.A));
  });
  const [speakerB, setSpeakerB] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SPEAKER_MAP.B;
    return parseInt(localStorage.getItem('radio-speaker-b') || String(DEFAULT_SPEAKER_MAP.B));
  });
  const [showSettings, setShowSettings] = useState(false);

  // 再生制御
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const v = parseFloat(localStorage.getItem('radio-speed') || '');
    return !isNaN(v) && [1, 1.25, 1.5, 2].includes(v) ? v : 1;
  });

  // ポーリング
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioIdRef = useRef<string | null>(null);

  // ── ref公開 ──
  useImperativeHandle(ref, () => ({
    stop: handleStop,
  }));

  // ── 初期ステータス取得 ──
  useEffect(() => {
    checkStatus();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteId]);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/radio-talk/status?minute_id=${minuteId}`);
      const data = await res.json();

      if (data.status === 'not_generated' || !data.audio_id) {
        setStatus('idle');
        return;
      }

      audioIdRef.current = data.audio_id;
      if (data.script) setScript(data.script);

      if (data.status === 'ready' && data.audio_url) {
        setAudioUrl(data.audio_url);
        setDurationSec(data.duration_sec);
        setStatus('ready');
        stopPolling();
      } else if (data.status === 'failed') {
        setStatus('error');
        setErrorMsg(data.error_message || '音声生成に失敗しました');
        stopPolling();
      } else if (['pending', 'generating', 'merging'].includes(data.status)) {
        setProgressText(data.progress_text || '');
        setStatus(data.status === 'merging' ? 'merging' : 'generating_audio');
        startPolling();
      }
    } catch {
      // ネットワークエラーは無視
    }
  }, [minuteId]);

  // ── ポーリング制御 ──
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(checkStatus, POLL_MS);
  }, [checkStatus]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // ── ラジオトーク生成開始 ──
  const handleGenerate = async () => {
    setStatus('generating_script');
    setErrorMsg('');

    const speakerMap: SpeakerMap = { A: speakerA, B: speakerB };
    localStorage.setItem('radio-speaker-a', String(speakerA));
    localStorage.setItem('radio-speaker-b', String(speakerB));

    try {
      const res = await fetch('/api/radio-talk/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minute_id: minuteId, speaker_map: speakerMap }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setErrorMsg(data.error || '台本生成に失敗しました');
        return;
      }

      audioIdRef.current = data.audio_id;
      if (data.script) setScript(data.script);

      if (data.status === 'ready' && data.cached) {
        // キャッシュヒット → ステータス再取得
        await checkStatus();
      } else {
        setStatus('generating_audio');
        setProgressText('0 / ?');
        startPolling();
      }
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : '通信エラー');
    }
  };

  // ── 再生制御 ──
  const ensureAudio = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('timeupdate', () => {
        setCurrentTime(audioRef.current?.currentTime || 0);
      });
      audioRef.current.addEventListener('ended', () => {
        setStatus('ready');
        setCurrentTime(0);
        onPlaybackChange?.(false);
      });
    }
    return audioRef.current;
  };

  const handlePlay = () => {
    if (!audioUrl) return;
    const audio = ensureAudio();

    if (status === 'paused' && audio.src) {
      audio.play();
      setStatus('playing');
      onPlaybackChange?.(true);
      return;
    }

    audio.src = audioUrl;
    audio.playbackRate = speed;
    audio.play();
    setStatus('playing');
    onPlaybackChange?.(true);
  };

  const handlePause = () => {
    audioRef.current?.pause();
    setStatus('paused');
    onPlaybackChange?.(false);
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setStatus(audioUrl ? 'ready' : 'idle');
    setCurrentTime(0);
    onPlaybackChange?.(false);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = val;
    setCurrentTime(val);
  };

  const handleSpeedChange = () => {
    const idx = SPEED_OPTIONS.indexOf(speed as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
    localStorage.setItem('radio-speed', String(next));
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  // ── 表示ヘルパー ──
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isLoading = status === 'generating_script' || status === 'generating_audio' || status === 'merging';

  // ── UI ──
  return (
    <div className="w-full bg-gradient-to-r from-violet-50 to-indigo-50 rounded-[14px] p-4 space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-violet-500" />
          <span className="text-[14px] font-bold text-violet-700">ラジオトーク</span>
        </div>
        {status === 'idle' && (
          <button
            onClick={() => setShowSettings(s => !s)}
            className="text-[11px] text-slate-400 hover:text-violet-500 transition-colors"
          >
            話者設定
          </button>
        )}
      </div>

      {/* 話者設定（折りたたみ） */}
      {showSettings && status === 'idle' && (
        <div className="bg-white rounded-xl p-3 space-y-2">
          {['A', 'B'].map(role => (
            <div key={role} className="flex items-center gap-2">
              <span className="text-[12px] font-bold text-slate-600 w-14">話者{role}:</span>
              <select
                value={role === 'A' ? speakerA : speakerB}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (role === 'A') setSpeakerA(v);
                  else setSpeakerB(v);
                }}
                className="flex-1 text-[12px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"
              >
                {SPEAKER_VOICE_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.name} (ID:{opt.id})</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* 生成ボタン */}
      {status === 'idle' && (
        <button
          onClick={handleGenerate}
          className="w-full bg-violet-500 text-white font-bold py-3 rounded-xl text-[14px] hover:bg-violet-600 transition-all active:scale-[0.97]"
        >
          ラジオトーク音声を生成
        </button>
      )}

      {/* 台本生成中 */}
      {status === 'generating_script' && (
        <div className="flex items-center gap-2 justify-center py-3">
          <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
          <span className="text-[13px] text-slate-500">台本を生成中...</span>
        </div>
      )}

      {/* 音声生成中 */}
      {status === 'generating_audio' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 justify-center">
            <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
            <span className="text-[13px] text-slate-500">音声を生成中... {progressText}</span>
          </div>
          {script && (
            <div className="text-[11px] text-slate-400 text-center">
              全{script.length}セグメント
            </div>
          )}
        </div>
      )}

      {/* 結合中 */}
      {status === 'merging' && (
        <div className="flex items-center gap-2 justify-center py-3">
          <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
          <span className="text-[13px] text-slate-500">音声を結合中...</span>
        </div>
      )}

      {/* 再生UI */}
      {(status === 'ready' || status === 'playing' || status === 'paused') && (
        <div className="space-y-2">
          {/* 再生バー */}
          <input
            type="range"
            min={0}
            max={durationSec || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 accent-violet-500"
          />
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{formatTime(currentTime)}</span>
            <span>{durationSec ? formatTime(durationSec) : '--:--'}</span>
          </div>

          {/* コントロール */}
          <div className="flex items-center justify-center gap-3">
            {status === 'playing' ? (
              <button onClick={handlePause}
                className="w-12 h-12 rounded-full bg-violet-500 text-white flex items-center justify-center hover:bg-violet-600 transition-colors">
                <Pause className="w-5 h-5" />
              </button>
            ) : (
              <button onClick={handlePlay}
                className="w-12 h-12 rounded-full bg-violet-500 text-white flex items-center justify-center hover:bg-violet-600 transition-colors">
                <Play className="w-5 h-5 ml-0.5" />
              </button>
            )}
            <button onClick={handleStop}
              className="w-9 h-9 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-300 transition-colors">
              <Square className="w-4 h-4" />
            </button>
            <button onClick={handleSpeedChange}
              className="px-3 py-1.5 rounded-full bg-slate-200 text-slate-600 text-[12px] font-bold hover:bg-slate-300 transition-colors">
              {speed}x
            </button>
          </div>

          {/* 再生成ボタン */}
          <button
            onClick={() => { handleStop(); setAudioUrl(null); setStatus('idle'); }}
            className="w-full text-[12px] text-slate-400 hover:text-violet-500 py-1 transition-colors"
          >
            別の話者で再生成
          </button>
        </div>
      )}

      {/* エラー */}
      {status === 'error' && (
        <div className="space-y-2">
          <p className="text-[12px] text-red-500 text-center">{errorMsg}</p>
          <button
            onClick={() => { setStatus('idle'); setErrorMsg(''); }}
            className="w-full text-[12px] text-slate-400 hover:text-violet-500 py-1"
          >
            やり直す
          </button>
        </div>
      )}
    </div>
  );
});

export default RadioTalkPlayer;
