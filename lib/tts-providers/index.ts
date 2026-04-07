/**
 * TTSプロバイダー ファクトリ
 *
 * 環境変数 TTS_PROVIDER で切り替え可能。
 *   'voicevox' (default) → VoicevoxProvider
 *   'irodori'            → 将来追加
 *   'style-bert-vits2'   → 将来追加
 */

import type { TTSProvider } from '../radio-talk-types';
import { VoicevoxProvider } from './voicevox';

export function createTTSProvider(name?: string): TTSProvider {
  const providerName = name || process.env.TTS_PROVIDER || 'voicevox';

  switch (providerName) {
    case 'voicevox':
      return new VoicevoxProvider();

    // ---- 将来の差し替えポイント ----
    // case 'irodori':
    //   return new IrodoriProvider();
    // case 'style-bert-vits2':
    //   return new StyleBertVits2Provider();

    default:
      console.warn(`Unknown TTS provider "${providerName}", falling back to voicevox`);
      return new VoicevoxProvider();
  }
}

export { VoicevoxProvider } from './voicevox';
