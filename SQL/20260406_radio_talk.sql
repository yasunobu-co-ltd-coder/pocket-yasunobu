-- ============================================================
-- ラジオトーク音声解説機能用テーブル
-- 作成日: 2026-04-06
-- ============================================================

-- ■ radio_talk_scripts: LLMが生成した台本を保存
CREATE TABLE IF NOT EXISTS radio_talk_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id TEXT NOT NULL,
  script JSONB NOT NULL,            -- [{speaker:"A", text:"..."}, ...]
  script_hash TEXT NOT NULL,        -- SHA-256 of JSON.stringify(script)
  model TEXT DEFAULT 'gpt-4o',      -- 使用したLLMモデル
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rts_minute_id ON radio_talk_scripts(minute_id);
CREATE INDEX IF NOT EXISTS idx_rts_script_hash ON radio_talk_scripts(script_hash);

-- ■ radio_talk_audio: 音声生成ジョブの管理
CREATE TABLE IF NOT EXISTS radio_talk_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id TEXT NOT NULL,
  script_id UUID NOT NULL REFERENCES radio_talk_scripts(id) ON DELETE CASCADE,
  speaker_mapping JSONB NOT NULL DEFAULT '{"A":3,"B":8}',
  -- A: ずんだもん(3), B: 春日部つむぎ(8) がデフォルト
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending → generating → merging → ready / failed
  total_segments INTEGER NOT NULL DEFAULT 0,
  completed_segments INTEGER NOT NULL DEFAULT 0,
  progress_text TEXT,
  audio_url TEXT,                    -- 結合済み最終音声のStorage URL
  duration_sec INTEGER,
  error_message TEXT,
  locked_by TEXT,                    -- ワーカーID（排他制御用）
  processing_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rta_minute_id ON radio_talk_audio(minute_id);
CREATE INDEX IF NOT EXISTS idx_rta_status ON radio_talk_audio(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rta_script_speaker
  ON radio_talk_audio(script_id, speaker_mapping);

-- ■ radio_talk_segments: セグメント単位の音声チャンク
CREATE TABLE IF NOT EXISTS radio_talk_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_id UUID NOT NULL REFERENCES radio_talk_audio(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  speaker TEXT NOT NULL,             -- "A" or "B"
  segment_text TEXT NOT NULL,
  audio_url TEXT,                    -- 個別セグメントWAV URL（結合前の一時ファイル）
  duration_sec INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rtseg_audio_index
  ON radio_talk_segments(audio_id, segment_index);

-- ■ RLS: anon は SELECT のみ許可
ALTER TABLE radio_talk_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE radio_talk_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE radio_talk_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_only" ON radio_talk_scripts
  FOR SELECT USING (true);
CREATE POLICY "anon_select_only" ON radio_talk_audio
  FOR SELECT USING (true);
CREATE POLICY "anon_select_only" ON radio_talk_segments
  FOR SELECT USING (true);

-- ■ Storage: radio-talk バケットを作成（Supabaseダッシュボードで作成するか、以下SQL）
-- INSERT INTO storage.buckets (id, name, public) VALUES ('radio-talk', 'radio-talk', true)
-- ON CONFLICT (id) DO NOTHING;

-- Storage RLS
-- CREATE POLICY "anon_read_radio_talk" ON storage.objects
--   FOR SELECT USING (bucket_id = 'radio-talk');
