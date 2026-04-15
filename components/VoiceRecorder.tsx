'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Save, Loader2, Check, Upload, FileAudio, ArrowLeft, ChevronRight, Download, Pencil, ArrowRightLeft, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { splitAudioIntoChunks, transcribeChunksParallel } from '@/lib/audio-chunker';
import { generateMinutesPdf } from '@/lib/generate-pdf';

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
type MinutesStyle = 'meeting' | 'lecture' | 'sales' | 'discussion';

const STYLE_OPTIONS: { value: MinutesStyle; label: string; desc: string }[] = [
    { value: 'meeting',    label: '会議',     desc: '複数人の会議・MTG' },
    { value: 'lecture',    label: '講演',     desc: '講義・セミナー・勉強会' },
    { value: 'sales',      label: '営業対談', desc: '商談・ヒアリング' },
    { value: 'discussion', label: '長い対談', desc: '対談・インタビュー' },
];

export default function VoiceRecorder({ userId, userName, onSaved, onCancel }: VoiceRecorderProps) {
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
    const isRecordingRef = useRef<boolean>(false);
    const [liveTranscript, setLiveTranscript] = useState<string>('');
    const finalTranscriptRef = useRef<string>('');

    // Recording safeguards
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const silentAudioRef = useRef<{ ctx: AudioContext; osc: OscillatorNode } | null>(null);
    const [bgWarning, setBgWarning] = useState(false);
    const bgTranscriptSnapshotRef = useRef<string>('');

    // Upload State
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
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

    // 編集モード
    const [isEditingResult, setIsEditingResult] = useState(false);
    const [editSummary, setEditSummary] = useState('');
    const [editDecisions, setEditDecisions] = useState('');
    const [editTodos, setEditTodos] = useState('');
    const [editNextSchedule, setEditNextSchedule] = useState('');

    // 保存中ロック
    const [isSaving, setIsSaving] = useState(false);

    // スタイル選択
    const [minutesStyle, setMinutesStyle] = useState<MinutesStyle>('meeting');

    // 文字起こし整形
    const [isCleaningUp, setIsCleaningUp] = useState(false);

    // 一括置換
    const [showReplace, setShowReplace] = useState(false);
    const [replaceRules, setReplaceRules] = useState<{ from: string; to: string }[]>([{ from: '', to: '' }]);

    useEffect(() => {
        return () => {
            if (timerInterval.current) clearInterval(timerInterval.current);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioContextRef.current) audioContextRef.current.close();
            if (recognitionRef.current) recognitionRef.current.stop();
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            // セーフガードクリーンアップ
            if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch {} }
            if (silentAudioRef.current) { try { silentAudioRef.current.osc.stop(); silentAudioRef.current.ctx.close(); } catch {} }
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { try { mediaRecorderRef.current.stop(); } catch {} }
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

    const smoothedLevelRef = useRef<number>(0);
    const barLevelsRef = useRef<number[]>(new Array(32).fill(0));

    const startAudioLevelMonitoring = (stream: MediaStream) => {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        const bufferLength = analyser.frequencyBinCount;
        const freqData = new Uint8Array(bufferLength);
        microphone.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const NOISE_GATE = 8;
        const BAR_COUNT = 32;

        const updateLevel = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(freqData);

            const barsPerBin = Math.floor(bufferLength / BAR_COUNT);
            const newBarLevels = barLevelsRef.current;

            let totalEnergy = 0;
            for (let bar = 0; bar < BAR_COUNT; bar++) {
                let sum = 0;
                const start = bar * barsPerBin;
                for (let j = start; j < start + barsPerBin; j++) {
                    sum += freqData[j];
                }
                const avg = sum / barsPerBin;
                const gated = avg < NOISE_GATE ? 0 : avg - NOISE_GATE;
                const normalized = Math.min(100, (gated / (255 - NOISE_GATE)) * 100);
                const prev = newBarLevels[bar];
                newBarLevels[bar] = normalized > prev
                    ? prev + (normalized - prev) * 0.6
                    : prev + (normalized - prev) * 0.2;
                totalEnergy += newBarLevels[bar];
            }
            barLevelsRef.current = newBarLevels;

            const overall = totalEnergy / BAR_COUNT;
            const prevSmoothed = smoothedLevelRef.current;
            smoothedLevelRef.current = overall > prevSmoothed
                ? prevSmoothed + (overall - prevSmoothed) * 0.5
                : prevSmoothed + (overall - prevSmoothed) * 0.15;
            setAudioLevel(smoothedLevelRef.current);
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
            // recognitionRef が null なら明示的に停止された → 再起動しない
            if (isRecordingRef.current && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) { console.log('Restart failed:', e); }
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
        return true;
    };

    const stopSpeechRecognition = () => {
        if (recognitionRef.current) {
            // ref を先に null 化 → onend の自動再起動を確実にブロック
            const rec = recognitionRef.current;
            recognitionRef.current = null;
            try { rec.abort(); } catch { /* すでに停止済み */ }
        }
    };

    // === 録音セーフガード ===

    // Wake Lock: 画面スリープ防止
    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLockRef.current = await navigator.wakeLock.request('screen');
                wakeLockRef.current.addEventListener('release', () => {
                    console.log('[WakeLock] released');
                });
                console.log('[WakeLock] acquired');
            }
        } catch (e) {
            console.warn('[WakeLock] failed:', e);
        }
    };

    const releaseWakeLock = () => {
        if (wakeLockRef.current) {
            wakeLockRef.current.release();
            wakeLockRef.current = null;
        }
    };

    // 無音オーディオ再生: バックグラウンドでブラウザを起こし続ける
    const startSilentAudio = () => {
        try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.001; // ほぼ無音
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            silentAudioRef.current = { ctx, osc };
            console.log('[SilentAudio] started');
        } catch (e) {
            console.warn('[SilentAudio] failed:', e);
        }
    };

    const stopSilentAudio = () => {
        if (silentAudioRef.current) {
            try {
                silentAudioRef.current.osc.stop();
                silentAudioRef.current.ctx.close();
            } catch { /* already stopped */ }
            silentAudioRef.current = null;
        }
    };

    // MediaRecorder: 音声チャンク定期保存（30秒ごと）
    const startMediaRecorder = (stream: MediaStream) => {
        try {
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            recordedChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunksRef.current.push(e.data);
                    // IndexedDBにバックアップ保存
                    saveChunksToIndexedDB();
                }
            };

            recorder.start(30000); // 30秒ごとにチャンク取得
            mediaRecorderRef.current = recorder;
            console.log('[MediaRecorder] started with 30s timeslice');
        } catch (e) {
            console.warn('[MediaRecorder] failed to start:', e);
        }
    };

    const stopMediaRecorder = (): Blob | null => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        if (recordedChunksRef.current.length > 0) {
            return new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        }
        return null;
    };

    // IndexedDB バックアップ
    const getDB = (): Promise<IDBDatabase> => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('pocket-recording-backup', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('chunks')) {
                    db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    };

    const saveChunksToIndexedDB = async () => {
        try {
            const db = await getDB();
            const tx = db.transaction('chunks', 'readwrite');
            const store = tx.objectStore('chunks');
            // 古いデータをクリアして最新を保存
            store.clear();
            const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
            store.put({
                id: 1,
                audio: blob,
                transcript: finalTranscriptRef.current,
                timestamp: Date.now(),
            });
            console.log(`[IndexedDB] saved ${recordedChunksRef.current.length} chunks, transcript ${finalTranscriptRef.current.length} chars`);
        } catch (e) {
            console.warn('[IndexedDB] save failed:', e);
        }
    };

    const clearIndexedDB = async () => {
        try {
            const db = await getDB();
            const tx = db.transaction('chunks', 'readwrite');
            tx.objectStore('chunks').clear();
        } catch { /* ignore */ }
    };

    const loadBackupFromIndexedDB = async (): Promise<{ audio: Blob | null; transcript: string } | null> => {
        try {
            const db = await getDB();
            const tx = db.transaction('chunks', 'readonly');
            const store = tx.objectStore('chunks');
            return new Promise((resolve) => {
                const req = store.get(1);
                req.onsuccess = () => {
                    if (req.result) {
                        resolve({ audio: req.result.audio, transcript: req.result.transcript || '' });
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            });
        } catch {
            return null;
        }
    };

    // visibilitychange: バックグラウンド検知
    useEffect(() => {
        const handleVisibility = () => {
            if (!isRecordingRef.current) return;

            if (document.visibilityState === 'hidden') {
                // バックグラウンドに移行 → 即座にスナップショット保存
                bgTranscriptSnapshotRef.current = finalTranscriptRef.current;
                saveChunksToIndexedDB();
                console.log('[Visibility] went to background, saved snapshot');
            } else if (document.visibilityState === 'visible') {
                // 復帰時: 音声認識が止まっている可能性をチェック
                console.log('[Visibility] returned to foreground');
                // Wake Lock を再取得（ブラウザによっては解放されている）
                requestWakeLock();

                // 音声認識が止まっていたら再起動
                if (isRecordingRef.current && !recognitionRef.current) {
                    startSpeechRecognition();
                }

                // バックグラウンド中にテキストが途切れた場合の警告
                const currentLen = finalTranscriptRef.current.length;
                const snapshotLen = bgTranscriptSnapshotRef.current.length;
                if (snapshotLen > 0 && currentLen === snapshotLen) {
                    setBgWarning(true);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

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
            setBgWarning(false);
            bgTranscriptSnapshotRef.current = '';
            isRecordingRef.current = true;
            setIsRecording(true);
            setInputMode('recording');
            startTimer();
            startAudioLevelMonitoring(stream);

            // セーフガード起動
            await requestWakeLock();
            startSilentAudio();
            startMediaRecorder(stream);
            await clearIndexedDB();
        } catch (err) {
            alert('マイクへのアクセスが拒否されました');
            console.error(err);
        }
    };

    const stopRecording = async () => {
        // 1. フラグを即座に落とす（onend 再起動防止）
        isRecordingRef.current = false;
        setIsRecording(false);

        // 2. Speech API を最優先で停止（abort で即座に強制終了）
        stopSpeechRecognition();

        // 3. タイマー・音声モニタリング停止
        stopTimer();
        stopAudioLevelMonitoring();

        // 4. セーフガード停止
        releaseWakeLock();
        stopSilentAudio();
        const recordedBlob = stopMediaRecorder();

        // 5. MediaStream トラック停止（マイク解放）
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => {
                t.stop();
                t.enabled = false;
            });
            streamRef.current = null;
        }

        let transcript = finalTranscriptRef.current.trim() || liveTranscript.trim();

        // 6. テキストが空 or 短すぎる場合、IndexedDBバックアップから復元を試みる
        if (!transcript || transcript.length < 10) {
            const backup = await loadBackupFromIndexedDB();
            if (backup?.transcript && backup.transcript.trim().length > (transcript?.length || 0)) {
                transcript = backup.transcript.trim();
                console.log('[Recovery] restored transcript from IndexedDB backup');
            }
        }

        // 7. 録音データがある場合、Whisperで文字起こしも試みる（テキストが短い場合のフォールバック）
        if (recordedBlob && recordedBlob.size > 10000 && (!transcript || transcript.length < 50)) {
            try {
                setIsProcessing(true);
                setProcessStep('録音データから文字起こし中...');
                const formData = new FormData();
                formData.append('file', new File([recordedBlob], 'recording.webm', { type: 'audio/webm' }));
                formData.append('chunkIndex', '0');
                const resp = await fetch('/api/transcribe-chunk', {
                    method: 'POST',
                    body: formData,
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.text && data.text.trim().length > (transcript?.length || 0)) {
                        transcript = data.text.trim();
                        console.log('[Recovery] used Whisper fallback transcription');
                    }
                }
            } catch (e) {
                console.warn('[Recovery] Whisper fallback failed:', e);
            }
        }

        await clearIndexedDB();

        if (transcript) {
            setEditableTranscript(transcript);
            setShowTranscript(true);
        } else {
            alert('音声が認識できませんでした。もう一度お試しください。');
            setInputMode('select');
        }
    };

    // === アップロードモード ===
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

    // サーバーサイドで音声分割・文字起こし（m4a等でクライアント側デコード失敗時のフォールバック）
    const transcribeServerSide = async (file: File): Promise<string> => {
        setProcessStep('サーバーで音声ファイルを変換・文字起こし中...');
        const formData = new FormData();
        formData.append('file', file);

        const resp = await fetch('/api/transcribe-large', {
            method: 'POST',
            body: formData,
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errData.error || `サーバー処理失敗 (${resp.status})`);
        }

        const data = await resp.json();
        return data.text || '';
    };

    const transcribeOneFile = async (file: File): Promise<string> => {
        if (file.size <= 4 * 1024 * 1024) {
            return await transcribeSingleFile(file);
        } else {
            try {
                return await transcribeWithChunking(file);
            } catch (chunkError) {
                console.warn('クライアント側の音声分割に失敗:', chunkError);
                // サーバーサイドフォールバックは4.5MB以下のみ（Vercelペイロード制限）
                if (file.size <= 4.5 * 1024 * 1024) {
                    return await transcribeServerSide(file);
                }
                throw new Error(
                    `音声ファイルの解析に失敗しました（${(file.size / 1024 / 1024).toFixed(1)}MB）。` +
                    'ブラウザのメモリ不足の可能性があります。' +
                    '他のタブを閉じてからもう一度お試しください。'
                );
            }
        }
    };

    const handleAudioFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0) return;

        const allowedExtensions = ['.mp3', '.m4a', '.wav', '.webm'];
        const files: File[] = [];
        let totalSize = 0;

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const ext = '.' + file.name.split('.').pop()?.toLowerCase();
            if (!allowedExtensions.includes(ext)) {
                alert(`対応していないファイル形式です: ${file.name}\nmp3, m4a, wav, webm ファイルをお選びください。`);
                return;
            }
            totalSize += file.size;
            files.push(file);
        }

        const MAX_TOTAL_SIZE = 400 * 1024 * 1024;
        if (totalSize > MAX_TOTAL_SIZE) {
            alert(`合計ファイルサイズが大きすぎます（${(totalSize / 1024 / 1024).toFixed(0)}MB）。\n合計400MB以下にしてください。`);
            return;
        }

        // ファイル名でソート（時系列順になりやすい）
        files.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

        setUploadedFiles(files);
        setInputMode('uploading');
        setIsProcessing(true);

        try {
            const transcripts: string[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (files.length > 1) {
                    setProcessStep(`音声ファイルを文字起こし中... (${i + 1}/${files.length}: ${file.name})`);
                } else {
                    setProcessStep('音声ファイルを文字起こし中...');
                }

                const text = await transcribeOneFile(file);
                if (text.trim()) {
                    transcripts.push(text.trim());
                }
            }

            const combined = transcripts.join('\n\n');

            if (combined.trim()) {
                setEditableTranscript(combined.trim());
                setProcessStep('議事録を作成中...');
                await generateMinutes(combined.trim());
            } else {
                alert('音声を認識できませんでした。ファイルを確認してください。');
                setInputMode('select');
                setIsProcessing(false);
            }
        } catch (e: unknown) {
            console.error('Upload transcription error:', e);
            const msg = e instanceof Error ? e.message : 'Unknown error';
            alert('文字起こしエラー: ' + msg);
            setInputMode('select');
            setIsProcessing(false);
        }

        // input をリセット（同じファイルを再選択可能に）
        if (e.target) e.target.value = '';
    };

    // 議事録生成（引数があればそちらを使用、なければ editableTranscript）
    const generateMinutes = async (transcriptText?: string) => {
        const text = transcriptText || editableTranscript;
        if (!text.trim()) {
            alert('文字起こしテキストがありません');
            return;
        }
        setIsProcessing(true);
        setProcessStep('議事録を生成中...');

        try {
            const resp = await fetch("/api/generate-minutes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transcript: text, chunkCount: 1, user_id: userId, customer, style: minutesStyle })
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

    const addReplaceRule = () => {
        setReplaceRules([...replaceRules, { from: '', to: '' }]);
    };
    const removeReplaceRule = (index: number) => {
        setReplaceRules(replaceRules.filter((_, i) => i !== index));
    };
    const updateReplaceRule = (index: number, field: 'from' | 'to', value: string) => {
        setReplaceRules(replaceRules.map((r, i) => i === index ? { ...r, [field]: value } : r));
    };
    const applyReplaceRules = () => {
        const validRules = replaceRules.filter(r => r.from.trim());
        if (validRules.length === 0) return;
        let summary = editSummary;
        let decisions = editDecisions;
        let todos = editTodos;
        let schedule = editNextSchedule;
        let totalCount = 0;
        for (const rule of validRules) {
            totalCount += summary.split(rule.from).length - 1;
            totalCount += decisions.split(rule.from).length - 1;
            totalCount += todos.split(rule.from).length - 1;
            totalCount += schedule.split(rule.from).length - 1;
            summary = summary.split(rule.from).join(rule.to);
            decisions = decisions.split(rule.from).join(rule.to);
            todos = todos.split(rule.from).join(rule.to);
            schedule = schedule.split(rule.from).join(rule.to);
        }
        if (totalCount === 0) {
            alert('該当する単語が見つかりませんでした');
            return;
        }
        setEditSummary(summary);
        setEditDecisions(decisions);
        setEditTodos(todos);
        setEditNextSchedule(schedule);
        alert(`${totalCount}箇所を置換しました`);
    };

    // 編集モード開始
    const startEditingResult = () => {
        if (!result) return;
        setEditSummary(result.summary);
        setEditDecisions((result.decisions || []).join('\n'));
        setEditTodos((result.todos || []).join('\n'));
        setEditNextSchedule(result.nextSchedule || '');
        setIsEditingResult(true);
        setShowReplace(false);
        setReplaceRules([{ from: '', to: '' }]);
    };

    // 編集完了
    const finishEditingResult = () => {
        if (!result) return;
        setResult({
            ...result,
            summary: editSummary,
            decisions: editDecisions.split('\n').filter(s => s.trim()),
            todos: editTodos.split('\n').filter(s => s.trim()),
            nextSchedule: editNextSchedule,
        });
        setIsEditingResult(false);
    };

    // 文字起こし整形
    const cleanupTranscript = async (format: 'structured' | 'summary' | 'verbatim') => {
        if (!editableTranscript.trim() || isCleaningUp) return;
        setIsCleaningUp(true);
        try {
            const resp = await fetch('/api/cleanup-transcript', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: editableTranscript, format }),
            });
            if (!resp.ok) throw new Error(`整形失敗 (${resp.status})`);
            const data = await resp.json();
            if (data.text) setEditableTranscript(data.text);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            alert('整形エラー: ' + msg);
        } finally {
            setIsCleaningUp(false);
        }
    };

    // TTS自動生成（ジョブ作成のみ → VPSワーカーが処理）
    const triggerTtsInBackground = async (minuteId: number) => {
        try {
            const genRes = await fetch('/api/tts/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ minute_id: minuteId }),
            });
            if (!genRes.ok) return;
            console.log('[TTS] Job created for minute', minuteId, '- VPS worker will process');
        } catch (e) {
            console.error('[TTS] Job creation error:', e);
        }
    };

    // pocket-yasunobu テーブルに保存
    const saveMinutes = async () => {
        if (!result || isSaving) return;
        const meetingName = (customer || result.customer || '').trim();
        if (!meetingName) {
            alert('会議名を入力してください');
            return;
        }

        setIsSaving(true);
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

            const res = await fetch('/api/minutes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    client_name: meetingName,
                    transcript: editableTranscript,
                    summary: formattedMemo,
                    decisions: result.decisions || [],
                    todos: result.todos || [],
                    next_schedule: result.nextSchedule || '',
                    keywords: result.keywords || [],
                }),
            });
            const inserted = await res.json();

            if (!res.ok) {
                console.error("Minutes Save Error:", inserted);
                throw new Error(inserted.error || 'Save failed');
            }

            // 裏でTTS音声を自動生成
            if (inserted?.id) {
                triggerTtsInBackground(inserted.id);
            }

            alert('保存しました（音声は裏で自動生成中）');
            onSaved();
        } catch (e: unknown) {
            console.error(e);
            const msg = e instanceof Error ? e.message : 'Unknown error';
            alert('保存失敗: ' + msg);
            setIsSaving(false);
        }
    };

    const resetAll = () => {
        setResult(null);
        setShowTranscript(false);
        setEditableTranscript('');
        setLiveTranscript('');
        finalTranscriptRef.current = '';
        setTimer(0);
        setUploadedFiles([]);
        setInputMode('select');
        setBgWarning(false);
    };

    // === Processing Screen ===
    if (isProcessing) {
        return (
            <div className="bg-white rounded-[20px] p-12 text-center border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)]">
                <Loader2 className="w-10 h-10 text-violet-500 animate-spin mx-auto mb-5" />
                <p className="text-slate-700 font-semibold text-[15px] mb-1">{processStep}</p>
                {uploadedFiles.length > 0 && (
                    <p className="text-[13px] text-slate-400 mt-2">
                        {uploadedFiles.length === 1
                            ? uploadedFiles[0].name
                            : `${uploadedFiles.length}ファイル選択中`}
                    </p>
                )}
            </div>
        );
    }

    // === Transcript Review Screen ===
    if (showTranscript) {
        return (
            <div className="space-y-5 animate-fade-in-up">
                <button onClick={resetAll} className="flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    やり直す
                </button>

                <div className="bg-white rounded-[20px] border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] overflow-hidden">
                    {/* Status bar */}
                    <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2.5">
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="text-[14px] font-semibold text-emerald-700">文字起こし完了</span>
                    </div>

                    <div className="p-6 space-y-5">
                        <p className="text-[13px] text-slate-400">
                            内容を確認・編集してから「議事録にまとめる」をタップしてください
                        </p>
                        <label htmlFor="editable-transcript" className="sr-only">文字起こし結果</label>
                        <textarea
                            id="editable-transcript"
                            name="transcript"
                            value={editableTranscript}
                            onChange={(e) => setEditableTranscript(e.target.value)}
                            className="w-full h-56 bg-slate-50 border border-slate-200 rounded-[12px] p-4 text-[14px] text-slate-700 leading-[1.6] focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none resize-none placeholder-slate-300 transition-all"
                            placeholder="文字起こし結果..."
                        />

                        {/* 整形オプション */}
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.5px]">
                                事前整形（任意）
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                {([
                                    { format: 'structured', label: '構造化', desc: '見出し付き' },
                                    { format: 'summary',    label: '要約',   desc: '1/5に圧縮' },
                                    { format: 'verbatim',   label: 'ほぼ原文', desc: '最小限整形' },
                                ] as const).map(({ format, label, desc }) => (
                                    <button
                                        key={format}
                                        disabled={isCleaningUp}
                                        onClick={() => cleanupTranscript(format)}
                                        className={`flex flex-col items-center gap-0.5 py-3 px-2 rounded-[12px] border text-center transition-all active:scale-[0.97] ${
                                            isCleaningUp
                                                ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700'
                                        }`}
                                    >
                                        {isCleaningUp ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : null}
                                        <span className="text-[13px] font-bold">{label}</span>
                                        <span className="text-[10px] text-slate-400">{desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* スタイル選択 */}
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.5px]">
                                議事録スタイル
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                {STYLE_OPTIONS.map(({ value, label, desc }) => (
                                    <button
                                        key={value}
                                        onClick={() => setMinutesStyle(value)}
                                        className={`flex flex-col items-center gap-0.5 py-3 px-2 rounded-[12px] border text-center transition-all active:scale-[0.97] ${
                                            minutesStyle === value
                                                ? 'bg-violet-50 border-violet-400 text-violet-700 shadow-[0_0_0_2px_rgba(124,58,237,0.15)]'
                                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700'
                                        }`}
                                    >
                                        <span className="text-[13px] font-bold">{label}</span>
                                        <span className="text-[10px] text-slate-400">{desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button onClick={() => generateMinutes()}
                            className="w-full text-white font-bold py-4 rounded-[14px] shadow-[0_4px_12px_rgba(124,58,237,0.3)] active:scale-[0.97] transition-transform text-[16px]"
                            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}>
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
            <div className="space-y-5 animate-fade-in-up">
                <button onClick={resetAll} className="flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    やり直す
                </button>

                <div className="bg-white rounded-[20px] border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] overflow-hidden">
                    {/* Status bar */}
                    <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2.5">
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="text-[14px] font-semibold text-emerald-700">議事録生成完了</span>
                    </div>

                    <div className="p-6 space-y-5">
                        {/* Customer name input */}
                        <div>
                            <label htmlFor="meeting-name" className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">会議名</label>
                            <input id="meeting-name" name="meeting-name" type="text" value={customer} onChange={(e) => setCustomer(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-[12px] px-4 py-3.5 text-[16px] text-slate-700 focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none transition-all" />
                        </div>

                        {/* Minutes content */}
                        {isEditingResult ? (
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="edit-summary" className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">要約</label>
                                    <textarea id="edit-summary" name="edit-summary" value={editSummary} onChange={(e) => setEditSummary(e.target.value)}
                                        className="w-full h-56 bg-slate-50 border border-slate-200 rounded-[12px] p-4 text-[14px] text-slate-700 leading-[1.6] focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none resize-none transition-all" />
                                </div>
                                <div>
                                    <label htmlFor="edit-decisions" className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">決定事項（1行に1項目）</label>
                                    <textarea id="edit-decisions" name="edit-decisions" value={editDecisions} onChange={(e) => setEditDecisions(e.target.value)}
                                        className="w-full h-28 bg-slate-50 border border-slate-200 rounded-[12px] p-4 text-[14px] text-slate-700 leading-[1.6] focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none resize-none transition-all" />
                                </div>
                                <div>
                                    <label htmlFor="edit-todos" className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">TODO（1行に1項目）</label>
                                    <textarea id="edit-todos" name="edit-todos" value={editTodos} onChange={(e) => setEditTodos(e.target.value)}
                                        className="w-full h-28 bg-slate-50 border border-slate-200 rounded-[12px] p-4 text-[14px] text-slate-700 leading-[1.6] focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none resize-none transition-all" />
                                </div>
                                <div>
                                    <label htmlFor="edit-next-schedule" className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">次回予定</label>
                                    <input id="edit-next-schedule" name="edit-next-schedule" type="text" value={editNextSchedule} onChange={(e) => setEditNextSchedule(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-[12px] px-4 py-3.5 text-[14px] text-slate-700 focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none transition-all" />
                                </div>
                                {/* 一括置換 */}
                                <div>
                                    <button onClick={() => setShowReplace(!showReplace)}
                                        className="flex items-center gap-2 text-[13px] font-bold text-amber-600 hover:text-amber-700 transition-colors">
                                        <ArrowRightLeft className="w-4 h-4" />
                                        一括置換 {showReplace ? '▲' : '▼'}
                                    </button>
                                    {showReplace && (
                                        <div className="mt-3 bg-amber-50 rounded-[12px] p-4 space-y-3">
                                            <p className="text-[12px] text-amber-600">要約・決定事項・TODO・次回予定を一括で置き換えます</p>
                                            {replaceRules.map((rule, i) => (
                                                <div key={i} className="bg-white border border-amber-200 rounded-[10px] p-3 space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-amber-500 w-8 flex-shrink-0">前</span>
                                                        <input type="text" id={`replace-from-${i}`} name={`replace-from-${i}`} value={rule.from} onChange={(e) => updateReplaceRule(i, 'from', e.target.value)}
                                                            placeholder="置換前の単語"
                                                            className="flex-1 bg-amber-50 border border-amber-100 rounded-[6px] px-3 py-1.5 text-[13px] text-slate-700 focus:border-amber-400 outline-none" />
                                                        {replaceRules.length > 1 && (
                                                            <button onClick={() => removeReplaceRule(i)}
                                                                className="w-7 h-7 rounded-full hover:bg-red-100 flex items-center justify-center transition-colors flex-shrink-0">
                                                                <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-emerald-500 w-8 flex-shrink-0">後</span>
                                                        <input type="text" id={`replace-to-${i}`} name={`replace-to-${i}`} value={rule.to} onChange={(e) => updateReplaceRule(i, 'to', e.target.value)}
                                                            placeholder="置換後の単語"
                                                            className="flex-1 bg-emerald-50 border border-emerald-100 rounded-[6px] px-3 py-1.5 text-[13px] text-slate-700 focus:border-emerald-400 outline-none" />
                                                        {replaceRules.length > 1 && <div className="w-7 flex-shrink-0" />}
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="flex gap-2">
                                                <button onClick={addReplaceRule}
                                                    className="flex-1 bg-white border border-amber-200 text-amber-600 font-bold py-2 rounded-[8px] text-[12px] hover:bg-amber-100 transition-colors flex items-center justify-center gap-1">
                                                    <Plus className="w-3.5 h-3.5" />
                                                    ルール追加
                                                </button>
                                                <button onClick={applyReplaceRules}
                                                    className="flex-1 bg-amber-500 text-white font-bold py-2 rounded-[8px] text-[12px] hover:bg-amber-600 transition-colors active:scale-[0.97]">
                                                    置換を適用
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button onClick={finishEditingResult}
                                    className="w-full bg-emerald-500 text-white font-bold py-4 rounded-[14px] text-[15px] hover:bg-emerald-600 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
                                    <Check className="w-5 h-5" />
                                    編集完了
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div>
                                    <h4 className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">要約</h4>
                                    <p className="text-[14px] text-slate-600 leading-[1.6] whitespace-pre-wrap">{result.summary}</p>
                                </div>
                                {result.decisions && result.decisions.length > 0 && (
                                    <div>
                                        <h4 className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">決定事項</h4>
                                        <ul className="space-y-1.5">
                                            {result.decisions.map((d, i) => (
                                                <li key={i} className="text-[14px] text-slate-600 flex gap-2">
                                                    <span className="text-violet-400 mt-0.5">•</span>
                                                    <span>{d}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {result.todos && result.todos.length > 0 && (
                                    <div>
                                        <h4 className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">TODO</h4>
                                        <ul className="space-y-1.5">
                                            {result.todos.map((t, i) => (
                                                <li key={i} className="text-[14px] text-slate-600 flex gap-2">
                                                    <span className="text-violet-400 mt-0.5">•</span>
                                                    <span>{t}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {result.nextSchedule && (
                                    <div>
                                        <h4 className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">次回予定</h4>
                                        <p className="text-[14px] text-slate-600">{result.nextSchedule}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* PDF export button */}
                        <button
                            disabled={isSaving}
                            onClick={() => {
                                generateMinutesPdf({
                                    meetingName: customer || result.customer || '',
                                    summary: result.summary,
                                    decisions: result.decisions,
                                    todos: result.todos,
                                    nextSchedule: result.nextSchedule,
                                    keywords: result.keywords,
                                });
                                saveMinutes();
                            }}
                            className={`w-full font-bold py-4 rounded-[14px] text-[15px] transition-all active:scale-[0.97] flex items-center justify-center gap-2 ${isSaving ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-100 text-slate-600 hover:bg-violet-50 hover:text-violet-600'}`}>
                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                            {isSaving ? '保存中...' : 'PDFで出力'}
                        </button>

                        {/* Edit button */}
                        {!isEditingResult && (
                            <button onClick={startEditingResult}
                                className="w-full bg-amber-50 text-amber-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-amber-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2 border border-amber-200">
                                <Pencil className="w-5 h-5" />
                                編集する
                            </button>
                        )}

                        {/* Save button */}
                        <button onClick={saveMinutes}
                            disabled={isSaving}
                            className={`w-full text-white font-bold py-4 rounded-[14px] shadow-[0_4px_12px_rgba(124,58,237,0.3)] transition-transform flex items-center justify-center gap-2 text-[16px] ${isSaving ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.97]'}`}
                            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}>
                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                            {isSaving ? '保存中...' : '保存する'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // === Recording Screen ===
    if (inputMode === 'recording') {
        return (
            <div className="space-y-5 animate-fade-in-up">
                <div className="bg-white rounded-[20px] border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] overflow-hidden">
                    {/* Recording status bar */}
                    <div className="px-6 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[13px] font-semibold text-red-600">録音中</span>
                    </div>

                    {bgWarning && (
                        <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                            <span className="text-[12px] text-amber-700">
                                バックグラウンド移行を検知しました。一部の音声が記録されていない可能性があります。録音は継続中です。
                            </span>
                            <button onClick={() => setBgWarning(false)} className="text-amber-500 text-[11px] font-bold ml-auto flex-shrink-0">
                                OK
                            </button>
                        </div>
                    )}

                    <div className="p-10 text-center">
                        {/* Timer */}
                        <div className="mb-8">
                            <div className="text-[48px] font-mono font-bold text-slate-800 tracking-wider">
                                {formatTime(timer)}
                            </div>
                        </div>

                        {/* Audio level - mirror waveform (center = loudest) */}
                        <div className="mb-10">
                            <div className="flex items-center justify-center gap-[2px] h-20">
                                {(() => {
                                    const bars = barLevelsRef.current;
                                    const half = Math.floor(bars.length / 2);
                                    const mirrored: number[] = [];
                                    for (let i = half - 1; i >= 0; i--) mirrored.push(bars[i]);
                                    for (let i = 0; i < half; i++) mirrored.push(bars[i]);
                                    return mirrored.map((barLevel, i) => {
                                        const h = 3 + (barLevel / 100) * 72;
                                        const intensity = Math.min(1, barLevel / 40);
                                        return (
                                            <div key={i} className="w-[3px] rounded-full"
                                                style={{
                                                    height: `${Math.max(3, h)}px`,
                                                    backgroundColor: `rgba(124, 58, 237, ${0.2 + intensity * 0.8})`,
                                                }} />
                                        );
                                    });
                                })()}
                            </div>
                        </div>

                        {/* Stop button */}
                        <button onClick={stopRecording}
                            className="w-[80px] h-[80px] rounded-full bg-red-500 shadow-[0_6px_16px_rgba(239,68,68,0.35)] flex items-center justify-center text-white hover:scale-105 active:scale-90 transition-all mx-auto">
                            <Square fill="currentColor" className="w-7 h-7" />
                        </button>
                        <p className="text-[12px] text-slate-400 mt-5">タップして停止</p>
                    </div>
                </div>
            </div>
        );
    }

    // === Select Mode Screen (Default) ===
    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Back */}
            <button onClick={onCancel} className="flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
                <ArrowLeft className="w-4 h-4" />
                戻る
            </button>

            {/* Title */}
            <div className="px-1 mb-2">
                <h2 className="text-[18px] font-bold text-slate-800">入力方法を選択</h2>
                <p className="text-[13px] text-slate-400 mt-2">音声を録音するか、ファイルをアップロードしてください</p>
            </div>

            {/* Option cards */}
            <div className="space-y-4">
                {/* Record option */}
                <button onClick={startRecording}
                    className="w-full bg-white border border-slate-200 rounded-[18px] p-5 flex items-center gap-5 hover:border-violet-200 hover:shadow-[0_6px_16px_rgba(124,58,237,0.1)] transition-all active:scale-[0.98] group shadow-[0_4px_6px_-2px_rgba(0,0,0,0.03)]">
                    <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center shadow-[0_6px_16px_rgba(124,58,237,0.3)] flex-shrink-0 group-hover:scale-105 transition-transform">
                        <Mic className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-[15px] font-bold text-slate-800">録音する</div>
                        <div className="text-[12px] text-slate-400 mt-0.5">リアルタイム文字起こし</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                </button>

                {/* Upload option */}
                <button onClick={() => audioFileInputRef.current?.click()}
                    className="w-full bg-white border border-slate-200 rounded-[18px] p-5 flex items-center gap-5 hover:border-violet-200 hover:shadow-[0_6px_16px_rgba(124,58,237,0.1)] transition-all active:scale-[0.98] group shadow-[0_4px_6px_-2px_rgba(0,0,0,0.03)]">
                    <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-[0_6px_16px_rgba(124,58,237,0.3)] flex-shrink-0 group-hover:scale-105 transition-transform">
                        <Upload className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-[15px] font-bold text-slate-800">ファイルから</div>
                        <div className="text-[12px] text-slate-400 mt-0.5">ボイスメモ等を共有（複数可）</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                </button>
            </div>

            <input id="audio-file-input" name="audio-file" type="file" ref={audioFileInputRef} accept=".mp3,.m4a,.wav,.webm,audio/*" multiple hidden onChange={handleAudioFileSelect} />

            <p className="text-[12px] text-slate-300 text-center flex items-center justify-center gap-1.5 pt-2">
                <FileAudio className="w-3 h-3" />
                対応形式: mp3, m4a, wav, webm (複数選択可・合計最大400MB)
            </p>
        </div>
    );
}
