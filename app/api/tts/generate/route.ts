import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitTextIntoChunks, generateTextHash } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';

/**
 * POST /api/tts/generate
 * ジョブ作成のみ→即座にレスポンス
 * 実際のチャンク処理は /api/tts/process-next でフロントエンドから駆動
 */
export async function POST(req: NextRequest) {
  try {
    const { minute_id } = await req.json();
    if (!minute_id) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 1. 議事録テキストを取得
    const { data: record, error: fetchError } = await supabase
      .from(TABLE_NAME)
      .select('summary')
      .eq('id', minute_id)
      .single();

    if (fetchError || !record) {
      return NextResponse.json({ error: '議事録が見つかりません' }, { status: 404 });
    }

    const summaryText = record.summary as string;
    if (!summaryText || summaryText.trim().length === 0) {
      return NextResponse.json({ error: '議事録テキストが空です' }, { status: 400 });
    }

    // 2. テキストハッシュ生成
    const textHash = await generateTextHash(summaryText);

    // 3. 既存の音声データを確認（キャッシュ）
    const { data: existing } = await supabase
      .from('minutes_audio')
      .select('id, status, total_chunks, completed_chunks')
      .eq('minute_id', String(minute_id))
      .eq('text_hash', textHash)
      .single();

    if (existing) {
      if (existing.status === 'ready') {
        return NextResponse.json({
          audio_id: existing.id,
          status: 'ready',
          message: '既存の音声データを使用します',
          cached: true,
        });
      }
      if (existing.status === 'generating') {
        return NextResponse.json({
          audio_id: existing.id,
          status: 'generating',
          total_chunks: existing.total_chunks,
          completed_chunks: existing.completed_chunks,
          message: '生成中です',
        });
      }
      // failed → 再生成: チャンク分割してジョブをリセット
      if (existing.status === 'failed') {
        // 古いチャンクを削除
        await supabase
          .from('minutes_audio_chunks')
          .delete()
          .eq('audio_id', existing.id);

        const chunks = splitTextIntoChunks(summaryText);
        const totalChunks = chunks.length;
        console.log(`[TTS] 再生成: ${totalChunks} チャンク (minute_id=${minute_id})`);

        await supabase
          .from('minutes_audio')
          .update({
            status: 'generating',
            total_chunks: totalChunks,
            completed_chunks: 0,
            current_chunk_index: 0,
            progress_text: `0 / ${totalChunks}`,
            error_message: null,
          })
          .eq('id', existing.id);

        return NextResponse.json({
          audio_id: existing.id,
          status: 'generating',
          total_chunks: totalChunks,
          completed_chunks: 0,
        });
      }
    }

    // 4. 新規ジョブ作成
    const chunks = splitTextIntoChunks(summaryText);
    const totalChunks = chunks.length;
    console.log(`[TTS] 新規ジョブ: ${totalChunks} チャンク (minute_id=${minute_id})`);

    const { data: audioRecord, error: insertError } = await supabase
      .from('minutes_audio')
      .insert({
        minute_id: String(minute_id),
        text_hash: textHash,
        status: 'generating',
        total_chunks: totalChunks,
        completed_chunks: 0,
        current_chunk_index: 0,
        progress_text: `0 / ${totalChunks}`,
      })
      .select('id')
      .single();

    if (insertError || !audioRecord) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: '音声レコード作成に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({
      audio_id: audioRecord.id,
      status: 'generating',
      total_chunks: totalChunks,
      completed_chunks: 0,
    });
  } catch (error: unknown) {
    console.error('TTS Generate Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
