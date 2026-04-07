/**
 * VOICEVOX TTSプロバイダー
 *
 * 現在のデフォルトプロバイダー。VPS上のVOICEVOX Engineに接続。
 * 将来 irodori-TTS 等に差し替える場合は、同じ TTSProvider インタフェースで
 * 新ファイルを作成し、worker側のインスタンス生成を切り替えるだけでよい。
 */

import type { TTSProvider, TTSSynthesisResult } from '../radio-talk-types';

export class VoicevoxProvider implements TTSProvider {
  name = 'voicevox';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.VOICEVOX_BASE || 'http://127.0.0.1:50021';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/version`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, speakerId: number): Promise<TTSSynthesisResult> {
    // 1. audio_query: テキスト→音声合成パラメータ
    const queryRes = await fetch(
      `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
      { method: 'POST', signal: AbortSignal.timeout(30000) }
    );
    if (!queryRes.ok) {
      throw new Error(`VOICEVOX audio_query failed: ${queryRes.status} ${await queryRes.text()}`);
    }
    const audioQuery = await queryRes.json();

    // 2. synthesis: パラメータ→WAV
    const synthRes = await fetch(
      `${this.baseUrl}/synthesis?speaker=${speakerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioQuery),
        signal: AbortSignal.timeout(120000),
      }
    );
    if (!synthRes.ok) {
      const errText = await synthRes.text();
      if (errText.includes('OOM') || errText.includes('out of memory')) {
        throw new Error('VOICEVOX OOM');
      }
      throw new Error(`VOICEVOX synthesis failed: ${synthRes.status} ${errText}`);
    }

    const wavBuffer = Buffer.from(await synthRes.arrayBuffer());

    // WAVヘッダーからサンプルレート・再生時間を取得
    const sampleRate = wavBuffer.readUInt32LE(24);
    const byteRate = wavBuffer.readUInt32LE(28);
    const dataSize = wavBuffer.length - 44; // WAVヘッダー44byte
    const durationSec = Math.round(dataSize / byteRate);

    return { audioBuffer: wavBuffer, durationSec, sampleRate };
  }
}
