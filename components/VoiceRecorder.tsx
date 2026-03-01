'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Save, Loader2, Check, Upload, FileAudio } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { splitAudioIntoChunks, transcribeChunksParallel } from '@/lib/audio-chunker';

interface VoiceRecorderProps {
    userId: string;
    userName: string;
    onSaved: () => void;
    onCancel: () => void;
}

interface MinutesData {
    customer: string;
    project: string;
    summary: string;
    decisions: string[];
    todos: string[];
    nextSchedule: string;
    keywords?: string[];
}

// Web Speech API の型定義
interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface ISpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

interface ISpeechRecognitionConstructor {
    new(): ISpeechRecognition;
}

declare global {
    interface Window {
        SpeechRecognition?: ISpeechRecognitionConstructor;
        webkitSpeechRecognition?: ISpeechRecognitionConstructor;
    }
}

type InputMode = 'select' | 'recording' | 'uploading';

export default function VoiceRecorder({ userId, userName, onSaved, onCancel }: VoiceRecorderProps) {
    const VERSION = "v8.0";

    const [inputMode, setInputMode] = useState<InputMode>('select');

    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [timer, setTimer] = useState(0);
    const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const [audioLevel, setAudioLevel] = useState<number>(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Web Speech API
    const recognitionRef = useRef<ISpeechRecognition | null>(null);
    const [liveTranscript, setLiveTranscript] = useState<string>('');
    const finalTranscriptRef = useRef<string>('');

    // Upload State
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const audioFileInputRef = useRef<HTMLInputElement>(null);

    // Processing State
    const [isProcessing, setIsProcessing] = useState(false);
    const [processStep, setProcessStep] = useState<string>('');
    const [result, setResult] = useState<MinutesData | null>(null);

    // 2段階フロー
    const [showTranscript, setShowTranscript] = useState(false);
    const [editableTranscript, setEditableTranscript] = useState<string>('');

    // Form State
    const [customer, setCustomer] = useState('');

    useEffect(() => {
        return () => {
            if (timerInterval.current) clearInterval(timerInterval.current);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioContextRef.current) audioContextRef.current.close();
            if (recognitionRef.current) recognitionRef.current.stop();
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        };
    }, []);

    const startTimer = () => {
        timerInterval.current = setInterval(() => {
            setTimer(prev => prev + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerInterval.current) {
            clearInterval(timerInterval.current);
            timerInterval.current = null;
        }
    };

    const formatTime = (totalSeconds: number) => {
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const startAudioLevelMonitoring = (stream: MediaStream) => {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphone.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const updateLevel = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
            const level = Math.min(100, (average / 255) * 200);
            setAudioLevel(level);
            animationFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
    };

    const stopAudioLevelMonitoring = () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setAudioLevel(0);
    };

    const startSpeechRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('このブラウザは音声認識に対応していません。Chrome/Edgeをお使いください。');
            return false;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscriptRef.current += result[0].transcript + ' ';
                } else {
                    interimTranscript += result[0].transcript;
                }
            }
            setLiveTranscript(finalTranscriptRef.current + interimTranscript);
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event);
        };

        recognition.onend = () => {
            if (isRecording && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) { console.log('Restart failed:', e); }
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
        return true;
    };

    const stopSpeechRecognition = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
    };

    // === 録音モード ===
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            if (!startSpeechRecognition()) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            finalTranscriptRef.current = '';
            setLiveTranscript('');
            setIsRecording(true);
            setInputMode('recording');
            startTimer();
            startAudioLevelMonitoring(stream);
        } catch (err) {
            alert('マイクへのアクセスが拒否されました');
            console.error(err);
        }
    };

    const stopRecording = () => {
        setIsRecording(false);
        stopTimer();
        stopAudioLevelMonitoring();
        stopSpeechRecognition();
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        const transcript = finalTranscriptRef.current.trim() || liveTranscript.trim();
        if (transcript) {
            setEditableTranscript(transcript);
            setShowTranscript(true);
        } else {
            alert('音声が認識できませんでした。もう一度お試しください。');
            setInputMode('select');
        }
    };

    // === アップロードモード ===
    // 小さいファイル（25MB以下）はそのまま送信
    const transcribeSingleFile = async (file: File): Promise<string> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('chunkIndex', '0');

        const resp = await fetch('/api/transcribe-chunk', {
            method: 'POST',
            body: formData,
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errData.error || `文字起こし失敗 (${resp.status})`);
        }

        const data = await resp.json();
        return data.text || '';
    };

    // 大きいファイルは分割して並列処理
    const transcribeWithChunking = async (file: File): Promise<string> => {
        setProcessStep('音声ファイルを解析・分割中...');
        const { chunks, totalDuration } = await splitAudioIntoChunks(file);

        const mins = Math.floor(totalDuration / 60);
        const secs = Math.floor(totalDuration % 60);
        setProcessStep(`${mins}分${secs}秒の音声を${chunks.length}チャンクに分割しました。文字起こし中...`);

        const CONCURRENCY = 10;
        const transcript = await transcribeChunksParallel(
            chunks,
            CONCURRENCY,
            (completed, total) => {
                setProcessStep(`文字起こし中... (${completed}/${total}チャンク完了)`);
            }
        );

        return transcript;
    };

    const handleAudioFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const allowedExtensions = ['.mp3', '.m4a', '.wav', '.webm'];
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            alert('対応していないファイル形式です。\nmp3, m4a, wav ファイルをお選びください。');
            return;
        }

        // 200MB上限（分割処理するのでWhisperの25MB制限は超えてOK）
        const MAX_FILE_SIZE = 200 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            alert(`ファイルサイズが大きすぎます（${(file.size / 1024 / 1024).toFixed(0)}MB）。\n200MB以下のファイルをお選びください。`);
            return;
        }

        setUploadedFile(file);
        setInputMode('uploading');
        setIsProcessing(true);
        setProcessStep('音声ファイルを文字起こし中...');

        try {
            let transcript: string;

            // 25MB以下ならそのまま、超えたら分割並列処理
            if (file.size <= 24 * 1024 * 1024) {
                transcript = await transcribeSingleFile(file);
            } else {
                transcript = await transcribeWithChunking(file);
            }

            if (transcript.trim()) {
                setEditableTranscript(transcript.trim());
                setShowTranscript(true);
            } else {
                alert('音声を認識できませんでした。ファイルを確認してください。');
                setInputMode('select');
            }
        } catch (e: unknown) {
            console.error('Upload transcription error:', e);
            const msg = e instanceof Error ? e.message : 'Unknown error';
            alert('文字起こしエラー: ' + msg);
            setInputMode('select');
        } finally {
            setIsProcessing(false);
        }
    };

    // 議事録生成
    const generateMinutes = async () => {
        if (!editableTranscript.trim()) {
            alert('文字起こしテキストがありません');
            return;
        }
        setIsProcessing(true);
        setProcessStep('議事録を生成中...');

        try {
            const resp = await fetch("/api/generate-minutes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transcript: editableTranscript, chunkCount: 1 })
            });

            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`議事録生成失敗: ${text.substring(0, 100)}`);
            }

            const data = await resp.json();
            let minutes: MinutesData = data.result;
            if (!minutes || (!minutes.summary && !minutes.customer)) {
                minutes = {
                    customer: '', project: '', summary: editableTranscript,
                    decisions: [], todos: [], nextSchedule: '', keywords: []
                };
            }
            setResult(minutes);
            setCustomer(minutes.customer || '');
            setShowTranscript(false);
        } catch (e: unknown) {
            console.error(e);
            const msg = e instanceof Error ? e.message : 'Unknown error';
            alert('エラーが発生しました: ' + msg);
        } finally {
            setIsProcessing(false);
        }
    };

    // pocket-matip テーブルに保存
    const saveMinutes = async () => {
        if (!result) return;

        try {
            let formattedMemo = result.summary;
            if (result.decisions && result.decisions.length > 0) {
                formattedMemo += '\n\n【決定事項】\n' + result.decisions.map(d => `・${d}`).join('\n');
            }
            if (result.todos && result.todos.length > 0) {
                formattedMemo += '\n\n【TODO】\n' + result.todos.map(t => `・${t}`).join('\n');
            }
            if (result.nextSchedule) {
                formattedMemo += '\n\n【次回予定】\n' + result.nextSchedule;
            }

            const { error } = await supabase
                .from('pocket-matip')
                .insert({
                    user_id: userId,
                    user_name: userName,
                    client_name: customer || result.customer || '名称なし',
                    transcript: editableTranscript,
                    summary: formattedMemo,
                    decisions: result.decisions || [],
                    todos: result.todos || [],
                    next_schedule: result.nextSchedule || '',
                    keywords: result.keywords || [],
                });

            if (error) {
                console.error("Supabase Save Error:", error);
                throw new Error(`${error.message} (Code: ${error.code})`);
            }

            alert('保存しました');
            onSaved();
        } catch (e: unknown) {
            console.error(e);
            const msg = e instanceof Error ? e.message : 'Unknown error';
            alert('保存失敗: ' + msg);
        }
    };

    const resetAll = () => {
        setResult(null);
        setShowTranscript(false);
        setEditableTranscript('');
        setLiveTranscript('');
        finalTranscriptRef.current = '';
        setTimer(0);
        setUploadedFile(null);
        setInputMode('select');
    };

    // === Processing Screen ===
    if (isProcessing) {
        return (
            <div className="bg-[#0f0a1a] rounded-2xl p-14 text-center border border-violet-500/20 shadow-[0_0_40px_rgba(139,92,246,0.1)]">
                <Loader2 className="w-12 h-12 text-violet-500 animate-spin mx-auto mb-5" />
                <p className="text-white font-medium text-[15px]">{processStep}</p>
                {uploadedFile && (
                    <p className="text-sm text-white/50 mt-3">{uploadedFile.name}</p>
                )}
            </div>
        );
    }

    // === Transcript Review Screen ===
    if (showTranscript) {
        return (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-[#0f0a1a] rounded-2xl p-7 border border-violet-500/20 space-y-5 shadow-[0_0_40px_rgba(139,92,246,0.1)]">
                    <div className="flex items-center gap-2.5 text-violet-400 font-bold mb-1">
                        <Check className="w-5 h-5" />
                        文字起こし完了
                    </div>
                    <p className="text-sm text-white/60">
                        内容を確認・編集してから「議事録にまとめる」をタップしてください
                    </p>
                    <textarea
                        value={editableTranscript}
                        onChange={(e) => setEditableTranscript(e.target.value)}
                        className="w-full h-64 bg-black/50 border border-violet-500/20 rounded-xl p-5 text-sm text-white focus:border-violet-500 outline-none resize-none placeholder-white/30"
                        placeholder="文字起こし結果..."
                    />
                    <div className="flex gap-3 pt-1">
                        <button onClick={resetAll}
                            className="flex-1 bg-black/30 border border-violet-500/20 text-white font-bold py-3.5 rounded-xl hover:bg-violet-500/10 transition-colors">
                            やり直す
                        </button>
                        <button onClick={generateMinutes}
                            className="flex-[2] bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-violet-500/25 hover:scale-[1.02] transition-transform">
                            議事録にまとめる
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // === Minutes Result Screen ===
    if (result) {
        return (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-[#0f0a1a] rounded-2xl p-7 border border-violet-500/20 space-y-5 shadow-[0_0_40px_rgba(139,92,246,0.1)]">
                    <div className="flex items-center gap-2.5 text-violet-400 font-bold mb-1">
                        <Check className="w-5 h-5" />
                        議事録生成完了
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">顧客名</label>
                        <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)}
                            className="w-full bg-black/50 border border-violet-500/20 rounded-xl px-4 py-3 text-sm text-white focus:border-violet-500 outline-none" />
                    </div>
                    <div className="space-y-5 bg-black/30 p-5 rounded-xl border border-violet-500/10 text-sm">
                        <div>
                            <h4 className="text-violet-400 font-bold mb-2">要約</h4>
                            <p className="text-white/80 leading-relaxed whitespace-pre-wrap">{result.summary}</p>
                        </div>
                        {result.decisions && result.decisions.length > 0 && (
                            <div>
                                <h4 className="text-violet-400 font-bold mb-2">決定事項</h4>
                                <ul className="list-disc pl-4 text-white/80 space-y-1">
                                    {result.decisions.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                            </div>
                        )}
                        {result.todos && result.todos.length > 0 && (
                            <div>
                                <h4 className="text-violet-400 font-bold mb-2">TODO</h4>
                                <ul className="list-disc pl-4 text-white/80 space-y-1">
                                    {result.todos.map((t, i) => <li key={i}>{t}</li>)}
                                </ul>
                            </div>
                        )}
                        {result.nextSchedule && (
                            <div>
                                <h4 className="text-violet-400 font-bold mb-2">次回予定</h4>
                                <p className="text-white/80">{result.nextSchedule}</p>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-3 pt-3">
                        <button onClick={resetAll}
                            className="flex-1 bg-black/30 border border-violet-500/20 text-white font-bold py-3.5 rounded-xl hover:bg-violet-500/10 transition-colors">
                            やり直す
                        </button>
                        <button onClick={saveMinutes}
                            className="flex-[2] bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-violet-500/20 hover:scale-[1.02] transition-transform flex items-center justify-center gap-2">
                            <Save className="w-5 h-5" />
                            保存する
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // === Recording Screen ===
    if (inputMode === 'recording') {
        return (
            <div className="bg-[#0f0a1a] rounded-2xl p-10 border border-violet-500/20 text-center relative overflow-hidden shadow-[0_0_40px_rgba(139,92,246,0.1)]">
                <div className="absolute top-3 right-3 text-[10px] text-white/20 font-mono">{VERSION}</div>
                <div className="mb-8">
                    <div className="text-5xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-purple-400">
                        {formatTime(timer)}
                    </div>
                    <p className="text-sm text-white/60 mt-3">録音中...</p>
                </div>
                {liveTranscript && (
                    <div className="mb-8 p-4 bg-black/40 rounded-xl border border-violet-500/10 max-h-36 overflow-y-auto">
                        <p className="text-xs text-white/70 text-left whitespace-pre-wrap">{liveTranscript}</p>
                    </div>
                )}
                <div className="space-y-3 mb-10">
                    <div className="flex items-center justify-center gap-1 h-16">
                        {[...Array(15)].map((_, i) => {
                            const offset = Math.abs(7 - i) / 7;
                            const baseHeight = 4 + (1 - offset) * audioLevel * 0.5;
                            return (
                                <div key={i} className="w-1 bg-violet-500 rounded-full transition-all duration-100"
                                    style={{ height: `${Math.max(4, baseHeight)}px`, opacity: 0.3 + (audioLevel / 100) * 0.7 }} />
                            );
                        })}
                    </div>
                    <div className="flex items-center justify-center gap-2">
                        <div className="w-32 h-2 bg-black/40 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-100"
                                style={{ width: `${audioLevel}%` }} />
                        </div>
                        <span className="text-xs text-white/40 font-mono w-8">{Math.round(audioLevel)}</span>
                    </div>
                </div>
                <div className="flex justify-center">
                    <button onClick={stopRecording}
                        className="w-20 h-20 rounded-full bg-gradient-to-r from-red-500 to-rose-600 shadow-lg shadow-red-500/30 flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all animate-pulse">
                        <Square fill="currentColor" className="w-8 h-8" />
                    </button>
                </div>
                <p className="text-xs text-white/40 mt-8">タップして停止</p>
            </div>
        );
    }

    // === Select Mode Screen (Default) ===
    return (
        <div className="bg-[#0f0a1a] rounded-2xl p-10 border border-violet-500/20 text-center relative overflow-hidden shadow-[0_0_40px_rgba(139,92,246,0.1)]">
            <div className="absolute top-3 right-3 text-[10px] text-white/20 font-mono">{VERSION}</div>
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-60 h-60 bg-violet-600/10 rounded-full blur-3xl" />
            <h2 className="text-xl font-bold flex items-center justify-center gap-3 mb-10 relative z-10">
                <span className="w-11 h-11 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400">
                    <Mic className="w-6 h-6" />
                </span>
                音声から議事録を作成
            </h2>
            <div className="grid grid-cols-2 gap-5 mb-8 relative z-10">
                <button onClick={startRecording}
                    className="bg-black/30 border border-violet-500/20 rounded-2xl p-7 flex flex-col items-center gap-4 hover:border-violet-500/50 hover:bg-violet-500/10 transition-all active:scale-95 group">
                    <div className="w-18 h-18 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30 group-hover:scale-110 transition-transform">
                        <Mic className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <div className="text-[15px] font-bold text-white">録音する</div>
                        <div className="text-[11px] text-white/50 mt-1.5">リアルタイム文字起こし</div>
                    </div>
                </button>
                <button onClick={() => audioFileInputRef.current?.click()}
                    className="bg-black/30 border border-violet-500/20 rounded-2xl p-7 flex flex-col items-center gap-4 hover:border-violet-500/50 hover:bg-violet-500/10 transition-all active:scale-95 group">
                    <div className="w-18 h-18 rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:scale-110 transition-transform">
                        <Upload className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <div className="text-[15px] font-bold text-white">ファイルから</div>
                        <div className="text-[11px] text-white/50 mt-1.5">ボイスメモ等を共有</div>
                    </div>
                </button>
            </div>
            <input type="file" ref={audioFileInputRef} accept=".mp3,.m4a,.wav,.webm,audio/*" hidden onChange={handleAudioFileSelect} />
            <p className="text-sm text-white/50 mb-8 relative z-10">
                <FileAudio className="w-3.5 h-3.5 inline mr-1.5" />
                対応形式: mp3, m4a, wav
            </p>
            <div className="border-t border-violet-500/10 pt-5 relative z-10">
                <button onClick={onCancel} className="text-[15px] text-white/50 hover:text-white transition-colors py-2">
                    キャンセルして戻る
                </button>
            </div>
        </div>
    );
}
