-- minutes_audio テーブルに speaker_id カラムを追加
-- VOICEVOX のスピーカーIDを保存（デフォルト: 3 = ずんだもん ノーマル）
ALTER TABLE minutes_audio ADD COLUMN IF NOT EXISTS speaker_id integer NOT NULL DEFAULT 3;

-- キャッシュキーを (minute_id, text_hash, speaker_id) に変更
-- 同じテキストでも声が違えば別音声として扱う
DROP INDEX IF EXISTS minutes_audio_minute_id_text_hash_key;
CREATE UNIQUE INDEX minutes_audio_minute_id_text_hash_speaker_key
  ON minutes_audio (minute_id, text_hash, speaker_id);
