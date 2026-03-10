-- File: 20260311_1600_create_minutes_audio_tables.sql
-- Purpose: VOICEVOX全文読み上げ機能に必要なテーブルとStorageバケットを作成
--   - minutes_audio: 議事録ごとの音声生成メタデータ（ハッシュによるキャッシュ管理）
--   - minutes_audio_chunks: チャンク単位の音声ファイル情報
--   - tts-audio バケット: WAVファイルの保存先
-- Created: 2026-03-11 16:00

-- =============================================================================
-- 1. minutes_audio テーブル
--    議事録テキスト全体の音声生成状態を管理する
--    text_hash により同一テキストの再生成を防止（キャッシュ）
-- =============================================================================
CREATE TABLE IF NOT EXISTS minutes_audio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id   text NOT NULL,                          -- pocket-yasunobu / pocket-matip テーブルの id（型に依存しないよう text）
  text_hash   text NOT NULL,                          -- summary テキストの SHA-256 ハッシュ
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  duration_sec integer DEFAULT 0,                     -- 全チャンク合計の再生時間（秒）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- minute_id + text_hash でユニーク（同じ議事録・同じテキストの重複防止）
CREATE UNIQUE INDEX IF NOT EXISTS idx_minutes_audio_minute_hash
  ON minutes_audio (minute_id, text_hash);

-- minute_id で検索する際のインデックス
CREATE INDEX IF NOT EXISTS idx_minutes_audio_minute_id
  ON minutes_audio (minute_id);

-- =============================================================================
-- 2. minutes_audio_chunks テーブル
--    チャンクごとの音声ファイル情報を保持
-- =============================================================================
CREATE TABLE IF NOT EXISTS minutes_audio_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_id    uuid NOT NULL REFERENCES minutes_audio(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,                       -- 0始まりの連番
  chunk_text  text NOT NULL,                          -- このチャンクのテキスト
  audio_url   text,                                   -- Supabase Storage の公開URL
  duration_sec integer DEFAULT 0,                     -- このチャンクの再生時間（秒）
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- audio_id + chunk_index でユニーク
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_chunks_audio_index
  ON minutes_audio_chunks (audio_id, chunk_index);

-- audio_id で全チャンク取得する際のインデックス
CREATE INDEX IF NOT EXISTS idx_audio_chunks_audio_id
  ON minutes_audio_chunks (audio_id);

-- =============================================================================
-- 3. updated_at 自動更新トリガー
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_minutes_audio_updated_at
  BEFORE UPDATE ON minutes_audio
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. RLS (Row Level Security) ポリシー
--    anon キーでの読み書きを許可（既存テーブルと同じポリシー）
-- =============================================================================
ALTER TABLE minutes_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE minutes_audio_chunks ENABLE ROW LEVEL SECURITY;

-- minutes_audio: 全操作許可
CREATE POLICY "Allow all on minutes_audio"
  ON minutes_audio FOR ALL
  USING (true)
  WITH CHECK (true);

-- minutes_audio_chunks: 全操作許可
CREATE POLICY "Allow all on minutes_audio_chunks"
  ON minutes_audio_chunks FOR ALL
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 5. Supabase Storage バケット作成
--    ※ Supabase ダッシュボードから作成するか、以下のSQL を実行
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('tts-audio', 'tts-audio', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 全ユーザーに読み取り許可
CREATE POLICY "Public read access on tts-audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tts-audio');

-- Storage RLS: 認証済みユーザー（anon含む）に書き込み許可
CREATE POLICY "Authenticated upload on tts-audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tts-audio');

-- Storage RLS: 削除許可
CREATE POLICY "Allow delete on tts-audio"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'tts-audio');
