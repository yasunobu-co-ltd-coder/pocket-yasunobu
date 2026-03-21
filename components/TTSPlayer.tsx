'use client';

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Volume2, Play, Pause, Square, Loader2, RotateCcw } from 'lucide-react';

type TTSStatus = 'loading' | 'not_generated' | 'generating' | 'ready' | 'playing' | 'paused' | 'error';

interface AudioChunk {
  id: string;
  chunk_index: number;
  chunk_text: string;
  audio_url: string;
  duration_sec: number;
}

interface TTSPlayerProps {
  minuteId: number | string;
  summaryText: string;
  clientName?: string;
  onPlaybackChange?: (playing: boolean) => void;
  onProgressChange?: (progress: number) => void;
}

export interface TTSPlayerHandle {
  play: () => void;
  pause: () => void;
  stop: () => void;
}

const VOICE_OPTIONS = [
  { id: 2, name: '四国めたん', desc: '落ち着いた女性声' },
  { id: 8, name: '春日部つむぎ', desc: '明るい女性声' },
  { id: 3, name: 'ずんだもん', desc: '親しみやすい声' },
  { id: 47, name: 'ナースロボ＿タイプＴ', desc: '明瞭なロボ声' },
] as const;

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;
const POLL_MS = 2000;

const TTSPlayer = forwardRef<TTSPlayerHandle, TTSPlayerProps>(function TTSPlayer(
  { minuteId, summaryText, clientName, onPlaybackChange, onProgressChange },
  ref
) {
  const [status, setStatus] = useState<TTSStatus>('loading');
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [speed, setSpeed] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const v = parseFloat(localStorage.getItem('tts-speed') || '');
    return !isNaN(v) && [1, 1.25, 1.5, 2].includes(v) ? v : 1;
  });
  const [speakerId, setSpeakerId] = useState<number>(() => {
    if (typeof window === 'undefined') return 3;
    const v = parseInt(localStorage.getItem('tts-speaker-id') || '', 10);
    return VOICE_OPTIONS.some(o => o.id === v) ? v : 3;
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [genTotal, setGenTotal] = useState(0);
  const [genCompleted, setGenCompleted] = useState(0);
  const [isFullyReady, setIsFullyReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nextAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const internalPauseRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);
  const chunksRef = useRef<AudioChunk[]>([]);
  const speakerIdRef = useRef(speakerId);

  useImperativeHandle(ref, () => ({
    play: handlePlay,
    pause: handlePause,
    stop: handleStop,
  }));

  // --- sync refs ---
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => {
    speedRef.current = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
    if (nextAudioRef.current) nextAudioRef.current.playbackRate = speed;
    localStorage.setItem('tts-speed', String(speed));
  }, [speed]);
  useEffect(() => {
    speakerIdRef.current = speakerId;
    localStorage.setItem('tts-speaker-id', String(speakerId));
  }, [speakerId]);

  // --- callbacks ---
  const notifyPlay = useCallback((playing: boolean) => {
    onPlaybackChange?.(playing);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }, [onPlaybackChange]);

  const notifyProgress = useCallback((val: number) => {
    setProgress(val);
    onProgressChange?.(val);
  }, [onProgressChange]);

  // --- cleanup helpers ---
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  const cleanupAudio = useCallback(() => {
    internalPauseRef.current = true;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current = null; }
    nextAudioRef.current = null;
    internalPauseRef.current = false;
  }, []);

  useEffect(() => { return () => { stopPolling(); cleanupAudio(); }; }, [stopPolling, cleanupAudio]);

  // --- init ---
  useEffect(() => { checkStatus(speakerId); }, [minuteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Media Session ---
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const voice = VOICE_OPTIONS.find(v => v.id === speakerId);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: clientName || '議事録読み上げ',
      artist: voice?.name || 'VOICEVOX',
      album: 'Pocket',
    });
    navigator.mediaSession.setActionHandler('play', () => handlePlay());
    navigator.mediaSession.setActionHandler('pause', () => handlePause());
    navigator.mediaSession.setActionHandler('stop', () => handleStop());
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
    };
  }, [speakerId, clientName, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- polling ---
  const startPolling = useCallback((spkId: number) => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tts/status?minute_id=${minuteId}&speaker_id=${spkId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (spkId !== speakerIdRef.current) { stopPolling(); return; }

        setGenCompleted(data.completed_chunks || 0);
        setGenTotal(data.total_chunks || 0);

        if (data.status === 'ready') {
          stopPolling();
          setChunks(data.chunks || []);
          setGenTotal(data.total_chunks || data.chunks?.length || 0);
          setGenCompleted(data.total_chunks || data.chunks?.length || 0);
          setIsFullyReady(true);
          if (!isPlayingRef.current) setStatus('ready');
        } else if (data.status === 'failed') {
          stopPolling();
          setErrorMsg(data.error_message || '音声生成に失敗しました');
          if (!isPlayingRef.current) setStatus('error');
        } else if (data.chunks?.length > 0) {
          setChunks(data.chunks);
        }
      } catch { /* ignore */ }
    }, POLL_MS);
  }, [minuteId, stopPolling]);

  // --- status check ---
  const checkStatus = async (spkId: number, autoGenerate = false) => {
    try {
      const res = await fetch(`/api/tts/status?minute_id=${minuteId}&speaker_id=${spkId}`);
      if (spkId !== speakerIdRef.current) return;
      if (!res.ok) { setStatus('not_generated'); return; }
      const data = await res.json();
      if (spkId !== speakerIdRef.current) return;

      if (data.status === 'ready' && data.chunks?.length > 0) {
        setChunks(data.chunks);
        setGenTotal(data.chunks.length);
        setGenCompleted(data.chunks.length);
        setIsFullyReady(true);
        setStatus('ready');
      } else if (data.status === 'generating' || data.status === 'processing') {
        setGenTotal(data.total_chunks || 0);
        setGenCompleted(data.completed_chunks || 0);
        setIsFullyReady(false);
        if (data.chunks?.length > 0) setChunks(data.chunks);
        setStatus('generating');
        startPolling(spkId);
      } else if (data.status === 'failed') {
        setErrorMsg(data.error_message || '音声生成に失敗しました');
        setStatus('error');
      } else if (autoGenerate && summaryText?.trim()) {
        triggerGenerate(spkId);
      } else {
        setStatus('not_generated');
      }
    } catch {
      setStatus('not_generated');
    }
  };

  // --- generate (統合: generateAudio + generateSingleSpeaker) ---
  const triggerGenerate = async (spkId?: number) => {
    const targetSpk = spkId ?? speakerId;
    if (!summaryText?.trim()) {
      setErrorMsg('読み上げるテキストがありません');
      setStatus('error');
      return;
    }
    setStatus('generating');
    setErrorMsg('');
    setGenCompleted(0);
    setGenTotal(0);
    setIsFullyReady(false);
    setChunks([]);
    chunksRef.current = [];
    try {
      const res = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minute_id: minuteId, speaker_id: targetSpk }),
      });
      if (targetSpk !== speakerIdRef.current) return;
      if (!res.ok) {
        let errorText = '音声生成に失敗しました';
        try { const d = await res.json(); errorText = d.error || errorText; } catch { /* */ }
        throw new Error(errorText);
      }
      const data = await res.json();
      if (targetSpk !== speakerIdRef.current) return;
      setGenTotal(data.total_chunks || 0);
      setGenCompleted(data.completed_chunks || 0);
      if (data.status === 'ready') {
        await checkStatus(targetSpk);
      } else {
        startPolling(targetSpk);
      }
    } catch (e: unknown) {
      if (targetSpk !== speakerIdRef.current) return;
      setErrorMsg(e instanceof Error ? e.message : '音声生成に失敗しました');
      setStatus('error');
    }
  };

  // --- voice change ---
  const handleVoiceChange = (newId: number) => {
    if (newId === speakerId) return;
    setStatus('loading');
    cleanupAudio();
    isPlayingRef.current = false;
    notifyPlay(false);
    stopPolling();
    speakerIdRef.current = newId;
    setSpeakerId(newId);
    setChunks([]);
    chunksRef.current = [];
    notifyProgress(0);
    setCurrentChunkIndex(0);
    setIsFullyReady(false);
    setErrorMsg('');
    setGenTotal(0);
    setGenCompleted(0);
    checkStatus(newId, true);
  };

  // --- preload & playback ---
  const preloadNext = useCallback((index: number) => {
    const cur = chunksRef.current;
    const ni = index + 1;
    if (ni >= cur.length) { nextAudioRef.current = null; return; }
    const next = new Audio(cur[ni].audio_url);
    next.preload = 'auto';
    next.playbackRate = speedRef.current;
    nextAudioRef.current = next;
  }, []);

  const playChunk = useCallback((index: number) => {
    if (!isPlayingRef.current) return;
    const cur = chunksRef.current;

    if (index >= cur.length) {
      isPlayingRef.current = false;
      setStatus('ready');
      setCurrentChunkIndex(0);
      notifyProgress(0);
      notifyPlay(false);
      return;
    }

    internalPauseRef.current = true;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    internalPauseRef.current = false;

    // プリロード済みがあれば使う（URLの末尾で比較: ブラウザがsrcを絶対URLに変換するため）
    const targetUrl = cur[index].audio_url;
    let audio: HTMLAudioElement;
    if (nextAudioRef.current && nextAudioRef.current.src.endsWith(new URL(targetUrl, location.href).pathname)) {
      audio = nextAudioRef.current;
      nextAudioRef.current = null;
    } else {
      audio = new Audio(targetUrl);
    }
    audio.playbackRate = speedRef.current;
    audioRef.current = audio;
    setCurrentChunkIndex(index);
    preloadNext(index);

    const total = cur.length;
    const base = (index / total) * 100;
    const step = (1 / total) * 100;

    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        notifyProgress(Math.min(base + (audio.currentTime / audio.duration) * step, 100));
      }
    };

    let endedNaturally = false;

    audio.onended = () => {
      endedNaturally = true;
      if (!isPlayingRef.current) return;
      const next = index + 1;
      if (next < chunksRef.current.length) {
        playChunk(next);
      } else {
        isPlayingRef.current = false;
        setStatus('ready');
        setCurrentChunkIndex(0);
        notifyProgress(0);
        notifyPlay(false);
      }
    };

    audio.onpause = () => {
      if (!endedNaturally && !internalPauseRef.current && isPlayingRef.current && audioRef.current === audio) {
        isPlayingRef.current = false;
        setStatus('paused');
        notifyPlay(false);
      }
    };

    audio.onerror = () => {
      setErrorMsg(`チャンク${index}の再生に失敗しました`);
      setStatus('error');
      isPlayingRef.current = false;
      notifyPlay(false);
    };

    audio.play().catch(() => {
      setErrorMsg('再生を開始できませんでした');
      setStatus('error');
      isPlayingRef.current = false;
      notifyPlay(false);
    });
  }, [notifyPlay, notifyProgress, preloadNext]);

  const handlePlay = () => {
    if (status === 'paused' && audioRef.current) {
      audioRef.current.play().catch(() => {
        setErrorMsg('再生を再開できませんでした');
        setStatus('error');
        isPlayingRef.current = false;
        notifyPlay(false);
      });
      isPlayingRef.current = true;
      setStatus('playing');
      notifyPlay(true);
      return;
    }
    isPlayingRef.current = true;
    setStatus('playing');
    setCurrentChunkIndex(0);
    notifyProgress(0);
    notifyPlay(true);
    playChunk(0);
  };

  const handlePause = () => {
    internalPauseRef.current = true;
    if (audioRef.current) audioRef.current.pause();
    internalPauseRef.current = false;
    isPlayingRef.current = false;
    setStatus('paused');
    notifyPlay(false);
  };

  const handleStop = () => {
    cleanupAudio();
    isPlayingRef.current = false;
    setStatus(isFullyReady ? 'ready' : 'generating');
    setCurrentChunkIndex(0);
    notifyProgress(0);
    notifyPlay(false);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const cur = chunksRef.current;
    if (cur.length === 0) return;
    const target = Math.min(Math.floor((val / 100) * cur.length), cur.length - 1);
    notifyProgress(val);
    setCurrentChunkIndex(target);
    if (status === 'playing' || status === 'paused') {
      cleanupAudio();
      isPlayingRef.current = true;
      setStatus('playing');
      notifyPlay(true);
      playChunk(target);
    }
  };

  const selectedVoice = VOICE_OPTIONS.find(v => v.id === speakerId) || VOICE_OPTIONS[2];

  // --- voice selector ---
  const voiceSelector = (
    <div className="flex flex-col gap-1.5">
      {VOICE_OPTIONS.map(v => (
        <button
          key={v.id}
          onClick={() => handleVoiceChange(v.id)}
          className={`w-full px-4 py-2.5 rounded-[10px] flex items-center justify-between transition-all ${
            speakerId === v.id
              ? 'bg-emerald-500 text-white shadow-sm'
              : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
          }`}
        >
          <span className="text-[13px] font-bold">{v.name}</span>
          <span className={`text-[11px] ${speakerId === v.id ? 'text-emerald-100' : 'text-slate-400'}`}>{v.desc}</span>
        </button>
      ))}
    </div>
  );

  // --- render ---
  if (status === 'loading') {
    return (
      <div className="w-full flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  if (status === 'not_generated') {
    return (
      <div className="space-y-2">
        <button onClick={() => triggerGenerate()}
          className="w-full bg-emerald-50 text-emerald-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-emerald-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
          <Volume2 className="w-5 h-5" />
          音声を生成
        </button>
        {voiceSelector}
      </div>
    );
  }

  if (status === 'generating') {
    const pct = genTotal > 0 ? Math.round((genCompleted / genTotal) * 100) : 0;
    return (
      <div className="w-full bg-amber-50 rounded-[14px] p-4 space-y-2">
        <div className="flex items-center gap-2 text-amber-600 font-bold text-[15px]">
          <Loader2 className="w-5 h-5 animate-spin" />
          音声生成中...
        </div>
        {genTotal > 0 && (
          <>
            <div className="text-center text-[13px] text-amber-600 font-medium">
              {genCompleted} / {genTotal}
            </div>
            <div className="w-full h-[6px] bg-amber-200 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
        {voiceSelector}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-2">
        <div className="w-full bg-red-50 text-red-500 font-medium py-3 px-4 rounded-[14px] text-[13px] text-center">
          {errorMsg || 'エラーが発生しました'}
        </div>
        <button onClick={() => triggerGenerate()}
          className="w-full bg-slate-100 text-slate-600 font-bold py-3 rounded-[14px] text-[14px] hover:bg-slate-200 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
          <RotateCcw className="w-4 h-4" />
          再試行
        </button>
        {voiceSelector}
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-50 rounded-[14px] p-4 space-y-3">
      <input
        type="range" min={0} max={100} step={0.1} value={progress}
        onChange={handleSeek}
        className="w-full h-[6px] appearance-none bg-slate-200 rounded-full cursor-pointer accent-emerald-500
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-emerald-500
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0"
        style={{
          background: `linear-gradient(to right, #10b981 0%, #10b981 ${progress}%, #e2e8f0 ${progress}%, #e2e8f0 100%)`,
        }}
      />

      {(status === 'playing' || status === 'paused') && (
        <div className="text-[12px] text-slate-400 text-center">
          {currentChunkIndex + 1} / {chunks.length} チャンク — {selectedVoice.name}
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        {status === 'playing' ? (
          <>
            <button onClick={handlePause}
              className="w-11 h-11 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center hover:bg-amber-200 transition-colors active:scale-95">
              <Pause className="w-5 h-5" />
            </button>
            <button onClick={handleStop}
              className="w-11 h-11 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-300 transition-colors active:scale-95">
              <Square className="w-5 h-5" />
            </button>
          </>
        ) : status === 'paused' ? (
          <>
            <button onClick={handlePlay}
              className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-200 transition-colors active:scale-95">
              <Play className="w-5 h-5" />
            </button>
            <button onClick={handleStop}
              className="w-11 h-11 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-300 transition-colors active:scale-95">
              <Square className="w-5 h-5" />
            </button>
          </>
        ) : (
          <button onClick={handlePlay}
            className="w-full bg-emerald-500 text-white font-bold py-3 rounded-[12px] text-[15px] hover:bg-emerald-600 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
            <Play className="w-5 h-5" />
            再生
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <span className="text-[12px] text-slate-400 mr-0.5">速度:</span>
        {SPEED_OPTIONS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)}
            className={`px-2.5 py-1 rounded-full text-[12px] font-bold transition-all ${
              speed === s ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}>
            {s}x
          </button>
        ))}
      </div>

      {voiceSelector}
    </div>
  );
});

export default TTSPlayer;
