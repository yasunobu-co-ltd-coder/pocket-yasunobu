import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createHash } from 'crypto';
import type { ScriptSegment, SpeakerMap } from '@/lib/radio-talk-types';
import { DEFAULT_SPEAKER_MAP } from '@/lib/radio-talk-types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TABLE_NAME = 'pocket-yasunobu';
const LLM_MODEL = 'claude-sonnet-4-20250514';

// ─── ラジオトーク台本生成プロンプト ───

function buildScriptPrompt(summary: string): string {
  return `あなたはビジネス会議の内容をラジオ番組風にわかりやすく解説するプロの台本ライターです。

## 入力
以下は会議の議事録です。

---
${summary}
---

## 指示
上記の議事録をもとに、2人の解説者（AとB）によるラジオトーク番組風の台本を作成してください。

### ルール
1. **必ず JSON 配列** で出力してください。フォーマット:
   [{"speaker":"A","text":"..."},{"speaker":"B","text":"..."},...]

2. 話者の役割:
   - A: メイン解説者。議題の説明、決定事項の解説、背景の補足を担当
   - B: サブ解説者。質問を投げかけたり、ポイントを要約したり、リスナー目線でコメント

3. 台本の構成:
   - 冒頭: 挨拶と今回の会議テーマの紹介（2〜3ターン）
   - 本編: 各議題について交互に解説（議題ごとに3〜6ターン）
   - まとめ: 決定事項・TODO・次回予定の確認（2〜4ターン）
   - 締め: 番組風の締めの挨拶（1〜2ターン）

4. 口調:
   - 敬語ベースだが堅すぎない、ラジオ番組風の自然な話し言葉
   - 「〜ですね」「なるほど」「ここがポイントで」など自然な相槌を含める
   - 議事録の専門用語はそのまま使いつつ、必要に応じて簡単に補足

5. 内容の優先度:
   - 決定事項とその理由・背景を最も重点的に
   - 保留事項や課題があればその論点も触れる
   - 次回アクションは具体的に誰が何をするか明示

6. 長さ: 全体で20〜40セグメント程度（各セグメントは1〜3文）

7. JSON以外のテキスト（マークダウン記法、コードブロック記号、説明文など）は一切出力しないでください。`;
}

// ─── メイン処理 ───

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { minute_id, speaker_map } = body;

    if (!minute_id) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const speakerMapping: SpeakerMap = speaker_map || DEFAULT_SPEAKER_MAP;
    const supabase = getSupabaseAdmin();

    // 1. 議事録テキスト取得
    const { data: record, error: fetchErr } = await supabase
      .from(TABLE_NAME)
      .select('summary')
      .eq('id', minute_id)
      .single();

    if (fetchErr || !record?.summary) {
      return NextResponse.json({ error: '議事録が見つかりません' }, { status: 404 });
    }

    const summary: string = record.summary;

    // 2. LLMで台本生成（Claude）
    const message = await anthropic.messages.create({
      model: LLM_MODEL,
      temperature: 0.7,
      max_tokens: 4000,
      system: buildScriptPrompt(summary),
      messages: [
        { role: 'user', content: '上記の議事録をもとにラジオトーク台本をJSON配列で出力してください。' },
      ],
    });

    const rawContent = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    // JSONパース（コードブロック除去対応）
    let script: ScriptSegment[];
    try {
      const jsonStr = rawContent.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      script = JSON.parse(jsonStr);
      if (!Array.isArray(script) || script.length === 0) throw new Error('Empty script');
      // バリデーション
      for (const seg of script) {
        if (!seg.speaker || !seg.text) throw new Error('Invalid segment');
      }
    } catch (parseErr) {
      console.error('Script parse error:', parseErr, 'Raw:', rawContent.substring(0, 500));
      return NextResponse.json({ error: '台本の生成に失敗しました（JSON解析エラー）' }, { status: 500 });
    }

    // 3. script_hash 計算（キャッシュ判定用）
    const scriptHash = createHash('sha256')
      .update(JSON.stringify(script))
      .digest('hex');

    // 4. 既存キャッシュチェック
    const { data: existingAudio } = await supabase
      .from('radio_talk_audio')
      .select('id, status, audio_url')
      .eq('minute_id', String(minute_id))
      .eq('speaker_mapping', JSON.stringify(speakerMapping))
      .in('status', ['ready', 'generating', 'merging', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 同じspeaker_mapで生成中/完了のジョブがあればそれを返す
    if (existingAudio) {
      // 台本を取得して返す
      const { data: existingScript } = await supabase
        .from('radio_talk_scripts')
        .select('script')
        .eq('id', (await supabase
          .from('radio_talk_audio')
          .select('script_id')
          .eq('id', existingAudio.id)
          .single()
        ).data?.script_id)
        .single();

      return NextResponse.json({
        audio_id: existingAudio.id,
        script_id: null,
        status: existingAudio.status,
        script: existingScript?.script || script,
        cached: true,
      });
    }

    // 5. DB保存: 台本
    const { data: scriptRow, error: scriptErr } = await supabase
      .from('radio_talk_scripts')
      .insert({
        minute_id: String(minute_id),
        script,
        script_hash: scriptHash,
        model: LLM_MODEL,
      })
      .select('id')
      .single();

    if (scriptErr || !scriptRow) {
      console.error('Script insert error:', scriptErr);
      return NextResponse.json({ error: '台本の保存に失敗しました' }, { status: 500 });
    }

    // 6. DB保存: 音声ジョブ
    const { data: audioRow, error: audioErr } = await supabase
      .from('radio_talk_audio')
      .insert({
        minute_id: String(minute_id),
        script_id: scriptRow.id,
        speaker_mapping: speakerMapping,
        status: 'pending',
        total_segments: script.length,
        completed_segments: 0,
        progress_text: `0 / ${script.length}`,
      })
      .select('id')
      .single();

    if (audioErr || !audioRow) {
      console.error('Audio job insert error:', audioErr);
      return NextResponse.json({ error: '音声ジョブの作成に失敗しました' }, { status: 500 });
    }

    // 7. DB保存: セグメント
    const segments = script.map((seg, i) => ({
      audio_id: audioRow.id,
      segment_index: i,
      speaker: seg.speaker,
      segment_text: seg.text,
    }));

    const { error: segErr } = await supabase
      .from('radio_talk_segments')
      .insert(segments);

    if (segErr) {
      console.error('Segments insert error:', segErr);
      // ジョブは作成済みなので失敗ステータスに
      await supabase
        .from('radio_talk_audio')
        .update({ status: 'failed', error_message: 'セグメント保存失敗' })
        .eq('id', audioRow.id);
      return NextResponse.json({ error: 'セグメント保存に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({
      audio_id: audioRow.id,
      script_id: scriptRow.id,
      status: 'pending',
      script,
      cached: false,
    });

  } catch (e: unknown) {
    console.error('Radio talk generate error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
