/**
 * 音声ファイルをWeb Audio APIでデコードし、16kHz WAVチャンクに分割する
 * 16kHzダウンサンプルでファイルサイズを大幅削減（Whisperの内部処理も16kHz）
 *
 * メモリ効率: デコード後すぐにチャンク単位でダウンサンプル→WAV変換し、
 * 大きなPCMバッファを早期に解放して長時間音声でもOOMを回避する
 */

const CHUNK_DURATION_SEC = 18; // 18秒ごとに分割（1時間≒200チャンク）
const TARGET_SAMPLE_RATE = 16000; // 16kHz（Whisper最適）
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/** Float32Array → 16bit PCM WAV Blob に変換 */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const numSamples = samples.length;
    const byteLength = 44 + numSamples * 2;
    const buffer = new ArrayBuffer(byteLength);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, byteLength - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

/** 線形補間でダウンサンプル（チャンク単位） */
function downsampleChunk(
    channelData: Float32Array,
    srcStart: number,
    srcEnd: number,
    originalRate: number,
    targetRate: number
): Float32Array {
    if (originalRate === targetRate) {
        return channelData.slice(srcStart, srcEnd);
    }

    const ratio = originalRate / targetRate;
    const srcLength = srcEnd - srcStart;
    const newLength = Math.floor(srcLength / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
        const srcIdx = srcStart + i * ratio;
        const srcFloor = Math.floor(srcIdx);
        const srcCeil = Math.min(srcFloor + 1, channelData.length - 1);
        const frac = srcIdx - srcFloor;
        result[i] = channelData[srcFloor] * (1 - frac) + channelData[srcCeil] * frac;
    }

    return result;
}

/**
 * 音声ファイルをデコード→WAVチャンク配列を返す
 *
 * メモリ最適化:
 * - AudioContextを16kHzで作成し、decodeAudioData時点で16kHzにリサンプル
 *   → 48kHzデコード（~1.1GB）を回避し、~384MBに抑える
 * - ダウンサンプル処理が不要になり、チャンクのslice→WAV変換のみ
 */
export async function splitAudioIntoChunks(file: File): Promise<{ chunks: Blob[]; totalDuration: number }> {
    const arrayBuffer = await file.arrayBuffer();

    // 16kHzのAudioContextを作ることで、decodeAudioDataが16kHzにリサンプルしてくれる
    // これによりメモリ使用量が48kHzの約1/3になる
    const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const totalDuration = audioBuffer.duration;
    const channelData = audioBuffer.getChannelData(0); // mono, already 16kHz
    const totalSamples = channelData.length;

    const samplesPerChunk = TARGET_SAMPLE_RATE * CHUNK_DURATION_SEC;
    const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

    const chunks: Blob[] = [];
    for (let i = 0; i < totalChunks; i++) {
        const start = i * samplesPerChunk;
        const end = Math.min(start + samplesPerChunk, totalSamples);
        const chunkSamples = channelData.slice(start, end);
        chunks.push(encodeWav(chunkSamples, TARGET_SAMPLE_RATE));
    }

    await audioContext.close();
    return { chunks, totalDuration };
}

/** 1チャンクをWhisper APIへ送信（リトライ付き、全リトライ失敗時は空文字を返す） */
async function transcribeChunk(chunk: Blob, index: number): Promise<{ index: number; text: string }> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const formData = new FormData();
            formData.append('file', new File([chunk], `chunk_${index}.wav`, { type: 'audio/wav' }));
            formData.append('chunkIndex', String(index));

            const resp = await fetch('/api/transcribe-chunk', {
                method: 'POST',
                body: formData,
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(err.error || `チャンク${index}の文字起こし失敗 (${resp.status})`);
            }

            const data = await resp.json();
            return { index, text: data.text || '' };
        } catch (e) {
            console.warn(`Chunk ${index} attempt ${attempt + 1} failed:`, e);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
            }
        }
    }

    // 全リトライ失敗 → スキップ（他のチャンクは続行）
    console.error(`Chunk ${index}: ${MAX_RETRIES}回失敗、スキップします`);
    return { index, text: '' };
}

/**
 * チャンクを最大 concurrency 個ずつ並列で文字起こし
 * 失敗チャンクはスキップし、成功分だけ順序通りに結合して返す
 */
export async function transcribeChunksParallel(
    chunks: Blob[],
    concurrency: number,
    onProgress: (completed: number, total: number) => void
): Promise<string> {
    const results: string[] = new Array(chunks.length).fill('');
    let completed = 0;

    for (let batchStart = 0; batchStart < chunks.length; batchStart += concurrency) {
        const batchEnd = Math.min(batchStart + concurrency, chunks.length);
        const promises: Promise<void>[] = [];

        for (let i = batchStart; i < batchEnd; i++) {
            promises.push(
                transcribeChunk(chunks[i], i).then(({ index, text }) => {
                    results[index] = text;
                    completed++;
                    onProgress(completed, chunks.length);
                })
            );
        }

        await Promise.all(promises);
    }

    return results.filter(t => t.trim()).join(' ');
}
