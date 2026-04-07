-- ============================================================
-- RLSポリシー変更: anon ロールを SELECT のみに制限
-- service_role はRLSをバイパスするため影響なし
-- フロントのINSERT/UPDATE/DELETEはAPI route経由(service_role)に移行済み
-- 実行日: 2026-03-25
-- ============================================================

-- ■ pocket-yasunobu テーブル
DROP POLICY IF EXISTS "Allow all on pocket-yasunobu" ON "pocket-yasunobu";
DROP POLICY IF EXISTS "anon_select_only" ON "pocket-yasunobu";
CREATE POLICY "anon_select_only" ON "pocket-yasunobu"
  FOR SELECT USING (true);

-- ■ minutes_audio テーブル
DROP POLICY IF EXISTS "Allow all on minutes_audio" ON minutes_audio;
DROP POLICY IF EXISTS "anon_select_only" ON minutes_audio;
CREATE POLICY "anon_select_only" ON minutes_audio
  FOR SELECT USING (true);

-- ■ minutes_audio_chunks テーブル
DROP POLICY IF EXISTS "Allow all on minutes_audio_chunks" ON minutes_audio_chunks;
DROP POLICY IF EXISTS "anon_select_only" ON minutes_audio_chunks;
CREATE POLICY "anon_select_only" ON minutes_audio_chunks
  FOR SELECT USING (true);

-- ■ term_dictionary テーブル
DROP POLICY IF EXISTS "Allow all on term_dictionary" ON term_dictionary;
DROP POLICY IF EXISTS "anon_select_only" ON term_dictionary;
CREATE POLICY "anon_select_only" ON term_dictionary
  FOR SELECT USING (true);

-- ■ users テーブル
DROP POLICY IF EXISTS "Allow all on users" ON users;
DROP POLICY IF EXISTS "anon_select_only" ON users;
CREATE POLICY "anon_select_only" ON users
  FOR SELECT USING (true);

-- ■ Storage: tts-audio バケット
-- 読み取りのみ許可（アップロード・削除はservice_role経由）
DROP POLICY IF EXISTS "Public read access on tts-audio" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload on tts-audio" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_tts_audio" ON storage.objects;
CREATE POLICY "anon_read_tts_audio" ON storage.objects
  FOR SELECT USING (bucket_id = 'tts-audio');
