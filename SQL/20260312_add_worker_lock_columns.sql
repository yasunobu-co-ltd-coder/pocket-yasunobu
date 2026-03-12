-- File: 20260312_add_worker_lock_columns.sql
-- Purpose: VPSワーカーのジョブロック用カラムを追加
--   - processing_started_at: ワーカーがジョブをピックアップした時刻
--   - locked_by: ワーカーのインスタンスID（重複防止）
-- Created: 2026-03-12

-- ジョブロック用カラム追加
ALTER TABLE minutes_audio
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

-- processing 状態を許可するように CHECK 制約を更新
-- 既存の CHECK 制約を削除して再作成
ALTER TABLE minutes_audio DROP CONSTRAINT IF EXISTS minutes_audio_status_check;
ALTER TABLE minutes_audio ADD CONSTRAINT minutes_audio_status_check
  CHECK (status IN ('pending', 'generating', 'processing', 'ready', 'failed'));
