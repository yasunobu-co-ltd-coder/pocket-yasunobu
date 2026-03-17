-- 20260317_add_speaker_id.sql で旧インデックス名が間違っていたため
-- 元のユニーク制約 (minute_id, text_hash) が残ってしまい、
-- 同じテキストで別speaker_idのINSERTが500エラーになっていた問題を修正

-- 元のユニーク制約を削除
DROP INDEX IF EXISTS idx_minutes_audio_minute_hash;
DROP INDEX IF EXISTS minutes_audio_minute_id_text_hash_key;

-- speaker_id を含む新しいユニーク制約を作成
CREATE UNIQUE INDEX IF NOT EXISTS minutes_audio_minute_id_text_hash_speaker_key
  ON minutes_audio (minute_id, text_hash, speaker_id);
