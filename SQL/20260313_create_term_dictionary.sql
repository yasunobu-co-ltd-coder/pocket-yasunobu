-- File: 20260313_create_term_dictionary.sql
-- Purpose: ユーザー辞書テーブルを作成
--   - 顧客ごとに固有名詞の誤認識パターンを登録
--   - 議事録生成時にLLMプロンプトへ注入し、表記ブレを軽減
-- Created: 2026-03-13

-- =============================================================================
-- 1. term_dictionary テーブル
--    顧客単位で「誤認識→正しい表記」のペアを管理
-- =============================================================================
CREATE TABLE IF NOT EXISTS term_dictionary (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,                          -- 登録したユーザー
  customer    text NOT NULL DEFAULT '',               -- 顧客名（空文字=全顧客共通）
  wrong_term  text NOT NULL,                          -- 誤認識される表記
  correct_term text NOT NULL,                         -- 正しい表記
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- user_id + customer + wrong_term でユニーク（同じ顧客の同じ誤表記は1つだけ）
CREATE UNIQUE INDEX IF NOT EXISTS idx_term_dict_unique
  ON term_dictionary (user_id, customer, wrong_term);

-- customer で検索する際のインデックス
CREATE INDEX IF NOT EXISTS idx_term_dict_customer
  ON term_dictionary (customer);

-- =============================================================================
-- 2. updated_at 自動更新トリガー
-- =============================================================================
CREATE TRIGGER trg_term_dictionary_updated_at
  BEFORE UPDATE ON term_dictionary
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. RLS (Row Level Security) ポリシー
-- =============================================================================
ALTER TABLE term_dictionary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on term_dictionary"
  ON term_dictionary FOR ALL
  USING (true)
  WITH CHECK (true);
