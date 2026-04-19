-- =============================================================================
-- File: 20260415_tts_cleanup_and_autoexpire.sql
-- Purpose:
--   1. 既存のTTS音声DBレコードを全削除
--   2. last_played_at カラム追加（最終再生日時を記録）
--   3. 期限切れレコード検出用のビュー作成
-- Created: 2026-04-15
--
-- 注意:
--   Supabaseは storage.objects の直接DELETEを禁止している（保護トリガー）
--   → Storageの削除はアプリ側（Supabase SDK）で行う
--   → 自動削除はVercel Cron + /api/tts/cleanup で実装
-- =============================================================================

-- =============================================================================
-- STEP 1: 既存DBレコードの全削除（Storageは別途Dashboardで削除）
-- =============================================================================
DELETE FROM minutes_audio_chunks;
DELETE FROM minutes_audio;

-- =============================================================================
-- STEP 2: last_played_at カラム追加
--   生成直後に now() をセット、再生時に now() で更新
--   3日以上更新されなかったら期限切れとみなす
-- =============================================================================
ALTER TABLE minutes_audio
  ADD COLUMN IF NOT EXISTS last_played_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_minutes_audio_last_played_at
  ON minutes_audio (last_played_at);

-- =============================================================================
-- STEP 3: 期限切れレコード検出ビュー
--   アプリ側のクリーンアップAPIがこのビューを参照して期限切れを取得し、
--   Storage削除 + DB削除を行う
-- =============================================================================
CREATE OR REPLACE VIEW expired_tts_audio AS
SELECT
  ma.id AS audio_id,
  ma.minute_id,
  ma.last_played_at,
  mac.audio_url
FROM minutes_audio ma
LEFT JOIN minutes_audio_chunks mac ON mac.audio_id = ma.id
WHERE ma.last_played_at < now() - interval '3 days';

-- =============================================================================
-- 確認用クエリ
-- =============================================================================
-- 現在のDBレコード数
-- SELECT COUNT(*) FROM minutes_audio;
-- SELECT COUNT(*) FROM minutes_audio_chunks;
--
-- 期限切れレコード確認
-- SELECT * FROM expired_tts_audio;
--
-- =============================================================================
-- Storageの既存ファイル削除手順
-- =============================================================================
-- 1. Supabase Dashboard → Storage → tts-audio バケット を開く
-- 2. ルートのフォルダを全選択 → Delete
-- または
-- 3. アプリ側で以下を実行（一度だけ）:
--    const { data: files } = await supabase.storage.from('tts-audio').list('', { limit: 10000 });
--    await supabase.storage.from('tts-audio').remove(files.map(f => f.name));
