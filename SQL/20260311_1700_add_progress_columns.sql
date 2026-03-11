-- File: 20260311_1700_add_progress_columns.sql
-- Purpose: minutes_audio テーブルに進捗管理カラムを追加
--   - TTS生成をステップワイズ（1チャンクずつ）で処理するため
--   - フロントエンドで「x / n」進捗表示を可能にする
--   - Vercelサーバーレスのタイムアウト回避のための設計変更に対応
-- Created: 2026-03-11 17:00

-- 進捗管理カラム
ALTER TABLE minutes_audio ADD COLUMN IF NOT EXISTS total_chunks integer DEFAULT 0;
ALTER TABLE minutes_audio ADD COLUMN IF NOT EXISTS completed_chunks integer DEFAULT 0;
ALTER TABLE minutes_audio ADD COLUMN IF NOT EXISTS current_chunk_index integer DEFAULT 0;
ALTER TABLE minutes_audio ADD COLUMN IF NOT EXISTS progress_text text;
ALTER TABLE minutes_audio ADD COLUMN IF NOT EXISTS error_message text;
