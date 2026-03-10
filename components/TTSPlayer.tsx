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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);

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
      const data = await res.json();

      if (data.status === 'ready' && data.chunks?.length > 0) {
        setChunks(data.chunks);
        setStatus('ready');
      } else if (data.status === 'generating') {
        setStatus('generating');
        // ポーリング
        setTimeout(checkStatus, 3000);
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

    try {
      const res = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minute_id: minuteId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '音声生成に失敗しました');
      }

      if (data.status === 'ready') {
        // 生成完了 → チャンク情報を取得
        await checkStatus();
      } else if (data.status === 'generating') {
        // まだ生成中 → ポーリング
        setTimeout(checkStatus, 3000);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '音声生成に失敗しました';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const playChunk = useCallback((index: number) => {
    if (index >= chunks.length) {
      // 全チャンク再生完了
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

    // プログレス計算
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
      // 一時停止からの再開
      audioRef.current.play();
      isPlayingRef.current = true;
      setStatus('playing');
      return;
    }

    // 最初から再生
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
    };
  }, []);

  // ===== レンダリング =====

  // 未生成状態: 生成ボタンのみ
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

  // 生成中
  if (status === 'generating') {
    return (
      <div className="w-full bg-amber-50 text-amber-600 font-bold py-4 rounded-[14px] text-[15px] flex items-center justify-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        音声を生成中...
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

  // Ready / Playing / Paused → プレーヤーUI
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
          /* ready */
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
