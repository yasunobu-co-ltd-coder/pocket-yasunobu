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

// 選択可能な声（全てノーマル）
const VOICE_OPTIONS = [
  { id: 2, name: '四国めたん', desc: '落ち着いた女性声' },
  { id: 8, name: '春日部つむぎ', desc: '明るい女性声' },
  { id: 3, name: 'ずんだもん', desc: '親しみやすい声' },
  { id: 47, name: 'ナースロボ＿タイプＴ', desc: '明瞭なロボ声' },
] as const;

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;
const STATUS_POLL_INTERVAL = 2000;

const TTSPlayer = forwardRef<TTSPlayerHandle, TTSPlayerProps>(function TTSPlayer(
  { minuteId, summaryText, clientName, onPlaybackChange, onProgressChange },
  ref
) {
  const [status, setStatus] = useState<TTSStatus>('loading');
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [speed, setSpeed] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tts-speed');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && [1, 1.25, 1.5, 2].includes(parsed)) return parsed;
      }
    }
    return 1;
  });
  const [speakerId, setSpeakerId] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tts-speaker-id');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (VOICE_OPTIONS.some(v => v.id === parsed)) return parsed;
      }
    }
    return 3;
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0);

  const [genTotal, setGenTotal] = useState(0);
  const [genCompleted, setGenCompleted] = useState(0);
  const [isFullyReady, setIsFullyReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);
  const chunksRef = useRef<AudioChunk[]>([]);
  const speakerIdRef = useRef(speakerId);

  // 親からの操作用
  useImperativeHandle(ref, () => ({
    play: handlePlay,
    pause: handlePause,
    stop: handleStop,
  }));

  useEffect(() => { checkStatus(speakerId); }, [minuteId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    speedRef.current = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
    localStorage.setItem('tts-speed', String(speed));
  }, [speed]);

  useEffect(() => {
    speakerIdRef.current = speakerId;
    localStorage.setItem('tts-speaker-id', String(speakerId));
  }, [speakerId]);

  // 再生状態変更 → 親通知 + Media Session
  const updatePlayState = useCallback((playing: boolean) => {
    onPlaybackChange?.(playing);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }, [onPlaybackChange]);

  // プログレス変更 → 親通知
  const updateProgress = useCallback((val: number) => {
    setProgress(val);
    onProgressChange?.(val);
  }, [onProgressChange]);

  // Media Session API
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

  const handleVoiceChange = (newId: number) => {
    if (newId === speakerId) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current = null; }
    isPlayingRef.current = false;
    updatePlayState(false);
    stopPolling();
    setSpeakerId(newId);
    setChunks([]);
    updateProgress(0);
    setCurrentChunkIndex(0);
    setIsFullyReady(false);
    checkStatus(newId, true);
  };

  useEffect(() => {
    return () => { stopPolling(); };
  }, []);

  useEffect(() => { chunksRef.current = chunks; }, [chunks]);

  const stopPolling = () => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  };

  const startPolling = (spkId: number) => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tts/status?minute_id=${minuteId}&speaker_id=${spkId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (spkId !== speakerIdRef.current) { stopPolling(); return; }

        setGenCompleted(data.completed_chunks || 0);
        setGenTotal(data.total_chunks || 0);

        if (data.chunks?.length > 0) {
          setChunks(data.chunks);
        }

        if (data.status === 'ready') {
          stopPolling();
          setChunks(data.chunks || []);
          setGenTotal(data.total_chunks || data.chunks?.length || 0);
          setGenCompleted(data.total_chunks || data.chunks?.length || 0);
          setIsFullyReady(true);
          if (!isPlayingRef.current) {
            setStatus('ready');
          }
        } else if (data.status === 'failed') {
          stopPolling();
          setErrorMsg(data.error_message || '音声生成に失敗しました');
          if (!isPlayingRef.current) {
            setStatus('error');
          }
        }
      } catch {
        // ignore
      }
    }, STATUS_POLL_INTERVAL);
  };

  const checkStatus = async (spkId: number, autoGenerate = false) => {
    try {
      const res = await fetch(`/api/tts/status?minute_id=${minuteId}&speaker_id=${spkId}`);
      if (!res.ok) { setStatus('not_generated'); return; }
      const data = await res.json();

      if (data.status === 'ready' && data.chunks?.length > 0) {
        setChunks(data.chunks);
        setGenTotal(data.total_chunks || data.chunks.length);
        setGenCompleted(data.total_chunks || data.chunks.length);
        setIsFullyReady(true);
        setStatus('ready');
      } else if (data.status === 'generating' || data.status === 'processing') {
        setGenTotal(data.total_chunks || 0);
        setGenCompleted(data.completed_chunks || 0);
        setIsFullyReady(false);
        if (data.chunks?.length > 0) {
          setChunks(data.chunks);
        }
        setStatus('generating');
        startPolling(spkId);
      } else if (data.status === 'failed') {
        setErrorMsg(data.error_message || '音声生成に失敗しました');
        setStatus('error');
      } else if (autoGenerate && summaryText?.trim()) {
        generateSingleSpeaker(spkId);
      } else {
        setStatus('not_generated');
      }
    } catch {
      setStatus('not_generated');
    }
  };

  const generateSingleSpeaker = async (spkId: number) => {
    setStatus('generating');
    setGenCompleted(0);
    setGenTotal(0);
    setIsFullyReady(false);
    setChunks([]);
    try {
      const res = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minute_id: minuteId, speaker_id: spkId }),
      });
      if (!res.ok) { setStatus('not_generated'); return; }
      const data = await res.json();
      setGenTotal(data.total_chunks || 0);
      setGenCompleted(data.completed_chunks || 0);
      if (data.status === 'ready') {
        await checkStatus(spkId);
      } else {
        startPolling(spkId);
      }
    } catch {
      setStatus('not_generated');
    }
  };

  const generateAudio = async () => {
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

    try {
      const res = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minute_id: minuteId, speaker_id: speakerId }),
      });

      if (!res.ok) {
        let errorText = '音声生成に失敗しました';
        try { const errData = await res.json(); errorText = errData.error || errorText; }
        catch { errorText = `サーバーエラー (${res.status})`; }
        throw new Error(errorText);
      }

      const data = await res.json();
      setGenTotal(data.total_chunks || 0);
      setGenCompleted(data.completed_chunks || 0);

      if (data.status === 'ready') {
        await checkStatus(speakerId);
      } else {
        startPolling(speakerId);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '音声生成に失敗しました';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const playChunk = useCallback((index: number) => {
    if (!isPlayingRef.current) return;

    const currentChunks = chunksRef.current;

    if (index >= currentChunks.length) {
      if (!isPlayingRef.current) return;
      isPlayingRef.current = false;
      setStatus('ready');
      setCurrentChunkIndex(0);
      updateProgress(0);
      updatePlayState(false);
      return;
    }

    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }

    const chunk = currentChunks[index];
    const audio = new Audio(chunk.audio_url);
    audio.playbackRate = speedRef.current;
    audioRef.current = audio;
    setCurrentChunkIndex(index);

    const totalChunks = currentChunks.length;
    const baseProgress = (index / totalChunks) * 100;
    const chunkProgress = (1 / totalChunks) * 100;

    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        const within = (audio.currentTime / audio.duration) * chunkProgress;
        updateProgress(Math.min(baseProgress + within, 100));
      }
    };

    audio.onended = () => {
      if (isPlayingRef.current) {
        const latestChunks = chunksRef.current;
        const nextIndex = index + 1;
        if (nextIndex < latestChunks.length) {
          playChunk(nextIndex);
        } else {
          isPlayingRef.current = false;
          setStatus('ready');
          setCurrentChunkIndex(0);
          updateProgress(0);
          updatePlayState(false);
        }
      }
    };

    audio.onerror = () => {
      setErrorMsg(`チャンク${index}の再生に失敗しました`);
      setStatus('error');
      isPlayingRef.current = false;
      updatePlayState(false);
    };

    audio.playbackRate = speedRef.current;
    audio.play().catch(() => {
      setErrorMsg('再生を開始できませんでした');
      setStatus('error');
      isPlayingRef.current = false;
      updatePlayState(false);
    });
  }, [updatePlayState, updateProgress]);

  const handlePlay = () => {
    if (status === 'paused' && audioRef.current) {
      audioRef.current.play();
      isPlayingRef.current = true;
      setStatus('playing');
      updatePlayState(true);
      return;
    }

    isPlayingRef.current = true;
    setStatus('playing');
    setCurrentChunkIndex(0);
    updateProgress(0);
    updatePlayState(true);
    playChunk(0);
  };

  const handlePause = () => {
    if (audioRef.current) audioRef.current.pause();
    isPlayingRef.current = false;
    setStatus('paused');
    updatePlayState(false);
  };

  const handleStop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current = null; }
    isPlayingRef.current = false;
    setStatus(isFullyReady ? 'ready' : 'generating');
    setCurrentChunkIndex(0);
    updateProgress(0);
    updatePlayState(false);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const currentChunks = chunksRef.current;
    if (currentChunks.length === 0) return;

    const targetChunk = Math.min(
      Math.floor((val / 100) * currentChunks.length),
      currentChunks.length - 1
    );

    updateProgress(val);
    setCurrentChunkIndex(targetChunk);

    if (status === 'playing' || status === 'paused') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      isPlayingRef.current = true;
      setStatus('playing');
      updatePlayState(true);
      playChunk(targetChunk);
    }
  };

  const selectedVoice = VOICE_OPTIONS.find(v => v.id === speakerId) || VOICE_OPTIONS[2];

  // ===== キャラクター切り替えリスト =====
  const voiceTabSelector = () => (
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

  // ===== レンダリング =====

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
        <button onClick={generateAudio}
          className="w-full bg-emerald-50 text-emerald-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-emerald-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
          <Volume2 className="w-5 h-5" />
          音声を生成
        </button>
        {voiceTabSelector()}
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
        {voiceTabSelector()}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-2">
        <div className="w-full bg-red-50 text-red-500 font-medium py-3 px-4 rounded-[14px] text-[13px] text-center">
          {errorMsg || 'エラーが発生しました'}
        </div>
        <button onClick={generateAudio}
          className="w-full bg-slate-100 text-slate-600 font-bold py-3 rounded-[14px] text-[14px] hover:bg-slate-200 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
          <RotateCcw className="w-4 h-4" />
          再試行
        </button>
        {voiceTabSelector()}
      </div>
    );
  }

  // Ready / Playing / Paused
  return (
    <div className="w-full bg-slate-50 rounded-[14px] p-4 space-y-3">
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={progress}
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

      {/* 速度 */}
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

      {/* キャラクター切り替え */}
      {voiceTabSelector()}
    </div>
  );
});

export default TTSPlayer;
