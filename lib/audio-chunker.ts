/**
 * 音声ファイルをWeb Audio APIでデコードし、WAVチャンクに分割する
 * 各チャンクはWhisper APIの25MB制限内に収まるサイズ
 */

const CHUNK_DURATION_SEC = 180; // 3分ごとに分割

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
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);   // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
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

/** 音声ファイルをデコードしてWAVチャンク配列を返す */
export async function splitAudioIntoChunks(file: File): Promise<{ chunks: Blob[]; totalDuration: number }> {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const totalSamples = audioBuffer.length;
    const totalDuration = audioBuffer.duration;
    // モノラルに変換（チャンネル0を使用）
    const channelData = audioBuffer.getChannelData(0);

    const samplesPerChunk = sampleRate * CHUNK_DURATION_SEC;
    const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

    const chunks: Blob[] = [];
    for (let i = 0; i < totalChunks; i++) {
        const start = i * samplesPerChunk;
        const end = Math.min(start + samplesPerChunk, totalSamples);
        const chunkSamples = channelData.slice(start, end);
        chunks.push(encodeWav(chunkSamples, sampleRate));
    }

    await audioContext.close();
    return { chunks, totalDuration };
}

/** 1チャンクをWhisper APIへ送信して文字起こし */
async function transcribeChunk(chunk: Blob, index: number): Promise<{ index: number; text: string }> {
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
}

/**
 * チャンクを最大 concurrency 個ずつ並列で文字起こし
 * 結果は元の順序で結合して返す
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
