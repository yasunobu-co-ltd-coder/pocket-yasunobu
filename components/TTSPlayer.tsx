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
  summaryText: string; // 変更検知用
}

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;

export default function TTSPlayer({ minuteId, summaryText }: TTSPlayerProps) {
  const [status, setStatus] = useState<TTSStatus>('not_generated');
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0); // 0-100

  // 生成進捗用
  const [genTotal, setGenTotal] = useState(0);
  const [genCompleted, setGenCompleted] = useState(0);
  const [audioId, setAudioId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const isGeneratingRef = useRef(false);

  // 初回マウント時にステータス確認
  useEffect(() => {
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteId]);

  // 速度変更をオーディオ要素に反映
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const checkStatus = async () => {
    try {
      const res = await fetch(`/api/tts/status?minute_id=${minuteId}`);
      if (!res.ok) {
        setStatus('not_generated');
        return;
      }
      const data = await res.json();

      if (data.status === 'ready' && data.chunks?.length > 0) {
        setChunks(data.chunks);
        setAudioId(data.audio_id);
        setGenTotal(data.total_chunks || data.chunks.length);
        setGenCompleted(data.total_chunks || data.chunks.length);
        setStatus('ready');
      } else if (data.status === 'generating') {
        setAudioId(data.audio_id);
        setGenTotal(data.total_chunks || 0);
        setGenCompleted(data.completed_chunks || 0);
        setStatus('generating');
        // 生成ループを開始（まだ動いてなければ）
        if (!isGeneratingRef.current && data.audio_id) {
          runGenerationLoop(data.audio_id);
        }
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

  /**
   * ステップワイズ生成ループ
   * process-next を1チャンクずつ呼び、完了まで繰り返す
   */
  const runGenerationLoop = async (aid: string) => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;

    try {
      let hasMore = true;
      while (hasMore) {
        const res = await fetch('/api/tts/process-next', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio_id: aid }),
        });

        if (!res.ok) {
          let errorText = '音声生成に失敗しました';
          try {
            const errData = await res.json();
            errorText = errData.error || errorText;
          } catch {
            // JSONパース失敗 (504等)
            errorText = `サーバーエラー (${res.status})`;
          }
          setErrorMsg(errorText);
          setStatus('error');
          isGeneratingRef.current = false;
          return;
        }

        const data = await res.json();
        setGenCompleted(data.completed_chunks || 0);
        setGenTotal(data.total_chunks || 0);

        if (data.status === 'ready') {
          hasMore = false;
        } else if (data.status === 'failed') {
          setErrorMsg(data.error || '音声生成に失敗しました');
          setStatus('error');
          isGeneratingRef.current = false;
          return;
        } else {
          hasMore = data.has_more !== false;
        }
      }

      // 完了 → チャンク情報を取得
      isGeneratingRef.current = false;
      await checkStatus();
    } catch (e: unknown) {
      isGeneratingRef.current = false;
      const msg = e instanceof Error ? e.message : '音声生成に失敗しました';
      setErrorMsg(msg);
      setStatus('error');
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

    try {
      const res = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minute_id: minuteId }),
      });

      if (!res.ok) {
        let errorText = '音声生成に失敗しました';
        try {
          const errData = await res.json();
          errorText = errData.error || errorText;
        } catch {
          errorText = `サーバーエラー (${res.status})`;
        }
        throw new Error(errorText);
      }

      const data = await res.json();
      setAudioId(data.audio_id);
      setGenTotal(data.total_chunks || 0);
      setGenCompleted(data.completed_chunks || 0);

      if (data.status === 'ready') {
        await checkStatus();
      } else if (data.status === 'generating' && data.audio_id) {
        // ステップワイズ生成ループを開始
        runGenerationLoop(data.audio_id);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '音声生成に失敗しました';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const playChunk = useCallback((index: number) => {
    if (index >= chunks.length) {
      isPlayingRef.current = false;
      setStatus('ready');
      setCurrentChunkIndex(0);
      setProgress(0);
      return;
    }

    const chunk = chunks[index];
    const audio = new Audio(chunk.audio_url);
    audio.playbackRate = speed;
    audioRef.current = audio;
    setCurrentChunkIndex(index);

    const totalChunks = chunks.length;
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
        playChunk(index + 1);
      }
    };

    audio.onerror = () => {
      setErrorMsg(`チャンク${index}の再生に失敗しました`);
      setStatus('error');
      isPlayingRef.current = false;
    };

    audio.play().catch(() => {
      setErrorMsg('再生を開始できませんでした');
      setStatus('error');
      isPlayingRef.current = false;
    });
  }, [chunks, speed]);

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
    if (audioRef.current) {
      audioRef.current.pause();
    }
    isPlayingRef.current = false;
    setStatus('paused');
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    isPlayingRef.current = false;
    setStatus('ready');
    setCurrentChunkIndex(0);
    setProgress(0);
  };

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      isPlayingRef.current = false;
      isGeneratingRef.current = false;
    };
  }, []);

  // ===== レンダリング =====

  // 未生成状態
  if (status === 'not_generated') {
    return (
      <button
        onClick={generateAudio}
        className="w-full bg-emerald-50 text-emerald-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-emerald-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
        <Volume2 className="w-5 h-5" />
        音声を生成
      </button>
    );
  }

  // 生成中（進捗表示付き）
  if (status === 'generating') {
    const pct = genTotal > 0 ? Math.round((genCompleted / genTotal) * 100) : 0;
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
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  // エラー
  if (status === 'error') {
    return (
      <div className="space-y-2">
        <div className="w-full bg-red-50 text-red-500 font-medium py-3 px-4 rounded-[14px] text-[13px] text-center">
          {errorMsg || 'エラーが発生しました'}
        </div>
        <button
          onClick={generateAudio}
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
      {/* プログレスバー */}
      <div className="w-full h-[6px] bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* チャンク情報 */}
      {(status === 'playing' || status === 'paused') && (
        <div className="text-[12px] text-slate-400 text-center">
          {currentChunkIndex + 1} / {chunks.length} チャンク
        </div>
      )}

      {/* コントロール */}
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

      {/* 速度コントロール */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-[12px] text-slate-400 mr-1">速度:</span>
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-3 py-1 rounded-full text-[12px] font-bold transition-all ${
              speed === s
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
