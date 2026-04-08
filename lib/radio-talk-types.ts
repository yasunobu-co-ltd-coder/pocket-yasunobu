// ============================================================
// ラジオトーク機能 型定義
// ============================================================

/** 台本の1セグメント */
export interface ScriptSegment {
  speaker: string;  // "A" | "B" (将来拡張可)
  text: string;
}

/** 話者ごとのVOICEVOX speaker_id マッピング */
export interface SpeakerMap {
  [speaker: string]: number;  // e.g. { A: 3, B: 8 }
}

/** デフォルトの話者設定 */
export const DEFAULT_SPEAKER_MAP: SpeakerMap = {
  A: 2,   // 四国めたん（メイン話者）
  B: 3,   // ずんだもん（サブ話者）
};

/** 話者の表示名 */
export const SPEAKER_VOICE_OPTIONS: { id: number; name: string }[] = [
  { id: 2, name: '四国めたん' },
  { id: 3, name: 'ずんだもん' },
  { id: 8, name: '春日部つむぎ' },
  { id: 47, name: 'ナースロボ＿タイプT' },
];

/** radio_talk_audio の status */
export type RadioTalkStatus =
  | 'pending'
  | 'generating'
  | 'merging'
  | 'ready'
  | 'failed';

/** POST /api/radio-talk/generate リクエスト */
export interface RadioTalkGenerateRequest {
  minute_id: string | number;
  speaker_map?: SpeakerMap;
}

/** POST /api/radio-talk/generate レスポンス */
export interface RadioTalkGenerateResponse {
  audio_id: string;
  script_id: string;
  status: RadioTalkStatus;
  script: ScriptSegment[];
  cached: boolean;
}

/** GET /api/radio-talk/status レスポンス */
export interface RadioTalkStatusResponse {
  audio_id: string;
  status: RadioTalkStatus;
  total_segments: number;
  completed_segments: number;
  progress_text: string;
  audio_url: string | null;
  duration_sec: number | null;
  error_message: string | null;
  script: ScriptSegment[];
  speaker_mapping: SpeakerMap;
  created_at: string;
  updated_at: string;
}

// ============================================================
// TTSプロバイダー抽象化
// ============================================================

/** TTS合成結果 */
export interface TTSSynthesisResult {
  audioBuffer: Buffer;     // WAV/PCMバイナリ
  durationSec: number;     // 再生秒数
  sampleRate: number;      // サンプルレート
}

/** TTSプロバイダーのインタフェース（将来差し替え対応） */
export interface TTSProvider {
  /** プロバイダー名 */
  name: string;

  /** ヘルスチェック */
  healthCheck(): Promise<boolean>;

  /** テキスト→音声合成 */
  synthesize(text: string, speakerId: number): Promise<TTSSynthesisResult>;
}
