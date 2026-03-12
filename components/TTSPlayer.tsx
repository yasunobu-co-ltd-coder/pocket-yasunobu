'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Volume2, Play, Pause, Square, Loader2, RotateCcw } from 'lucide-react';

type TTSStatus = 'not_generated' | 'generating' | 'ready' | 'playing' | 'paused' | 'error';

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
}

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;
const STATUS_POLL_INTERVAL = 2000;

export default function TTSPlayer({ minuteId, summaryText }: TTSPlayerProps) {
  const [status, setStatus] = useState<TTSStatus>('not_generated');
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0);

  const [genTotal, setGenTotal] = useState(0);
  const [genCompleted, setGenCompleted] = useState(0);
  // 生成完了フラグ（generating/processing 中かどうか）
  const [isFullyReady, setIsFullyReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);
  const chunksRef = useRef<AudioChunk[]>([]);

  useEffect(() => { checkStatus(); }, [minuteId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    speedRef.current = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      isPlayingRef.current = false;
      stopPolling();
    };
  }, []);

  // chunksRef を常に最新に保つ
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);

  const stopPolling = () => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  };

  const startPolling = () => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tts/status?minute_id=${minuteId}`);
        if (!res.ok) return;
        const data = await res.json();

        setGenCompleted(data.completed_chunks || 0);
        setGenTotal(data.total_chunks || 0);

        // チャンクリストを更新（生成中でも利用可能なチャンクを反映）
        if (data.chunks?.length > 0) {
          setChunks(data.chunks);
        }

        if (data.status === 'ready') {
          stopPolling();
          setChunks(data.chunks || []);
          setGenTotal(data.total_chunks || data.chunks?.length || 0);
          setGenCompleted(data.total_chunks || data.chunks?.length || 0);
          setIsFullyReady(true);
          // 再生中でなければ ready に遷移
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
        // generating/processing → ポーリング継続
      } catch {
        // ネットワークエラーは無視
      }
    }, STATUS_POLL_INTERVAL);
  };

  const checkStatus = async () => {
    try {
      const res = await fetch(`/api/tts/status?minute_id=${minuteId}`);
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
        startPolling();
      } else if (data.status === 'failed') {
        setErrorMsg(data.error_message || '音声生成に失敗しました');
        setStatus('error');
      } else {
        setStatus('not_generated');
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
        body: JSON.stringify({ minute_id: minuteId }),
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
        await checkStatus();
      } else {
        startPolling();
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
      // 生成がまだ終わってないなら少し待ってリトライ
      if (!isPlayingRef.current) return;
      // 全チャンク再生完了
      isPlayingRef.current = false;
      setStatus('ready');
      setCurrentChunkIndex(0);
      setProgress(0);
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
        setProgress(Math.min(baseProgress + within, 100));
      }
    };

    audio.onended = () => {
      if (isPlayingRef.current) {
        // 次のチャンクへ（chunksRef.current で最新リストを参照）
        const latestChunks = chunksRef.current;
        const nextIndex = index + 1;
        if (nextIndex < latestChunks.length) {
          playChunk(nextIndex);
        } else {
          // 全チャンク再生完了
          isPlayingRef.current = false;
          setStatus('ready');
          setCurrentChunkIndex(0);
          setProgress(0);
        }
      }
    };

    audio.onerror = () => {
      setErrorMsg(`チャンク${index}の再生に失敗しました`);
      setStatus('error');
      isPlayingRef.current = false;
    };

    audio.playbackRate = speedRef.current;
    audio.play().catch(() => {
      setErrorMsg('再生を開始できませんでした');
      setStatus('error');
      isPlayingRef.current = false;
    });
  }, []);

  const handlePlay = () => {
    if (status === 'paused' && audioRef.current) {
      audioRef.current.play();
      isPlayingRef.current = true;
      setStatus('playing');
      return;
    }

    isPlayingRef.current = true;
    setStatus('playing');
    setCurrentChunkIndex(0);
    setProgress(0);
    playChunk(0);
  };

  const handlePause = () => {
    if (audioRef.current) audioRef.current.pause();
    isPlayingRef.current = false;
    setStatus('paused');
  };

  const handleStop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current = null; }
    isPlayingRef.current = false;
    setStatus(isFullyReady ? 'ready' : 'generating');
    setCurrentChunkIndex(0);
    setProgress(0);
  };

  // ===== レンダリング =====

  if (status === 'not_generated') {
    return (
      <button onClick={generateAudio}
        className="w-full bg-emerald-50 text-emerald-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-emerald-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
        <Volume2 className="w-5 h-5" />
        音声を生成
      </button>
    );
  }

  // 生成中（early playback 対応）
  if (status === 'generating') {
    const pct = genTotal > 0 ? Math.round((genCompleted / genTotal) * 100) : 0;
    const canEarlyPlay = chunks.length > 0;

    return (
      <div className="w-full bg-amber-50 rounded-[14px] p-4 space-y-2">
        <div className="flex items-center justify-center gap-2 text-amber-600 font-bold text-[15px]">
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
        {canEarlyPlay && (
          <button onClick={handlePlay}
            className="w-full bg-emerald-500 text-white font-bold py-3 rounded-[12px] text-[14px] hover:bg-emerald-600 transition-all active:scale-[0.97] flex items-center justify-center gap-2 mt-2">
            <Play className="w-4 h-4" />
            生成済み部分を再生 ({chunks.length}チャンク)
          </button>
        )}
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
      </div>
    );
  }

  // Ready / Playing / Paused
  return (
    <div className="w-full bg-slate-50 rounded-[14px] p-4 space-y-3">
      <div className="w-full h-[6px] bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }} />
      </div>

      {(status === 'playing' || status === 'paused') && (
        <div className="text-[12px] text-slate-400 text-center">
          {currentChunkIndex + 1} / {chunks.length} チャンク
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

      <div className="flex items-center justify-center gap-2">
        <span className="text-[12px] text-slate-400 mr-1">速度:</span>
        {SPEED_OPTIONS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)}
            className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all ${
              speed === s ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
