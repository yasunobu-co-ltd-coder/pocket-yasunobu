import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitTextIntoChunks, generateTextHash } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';

const ALL_SPEAKER_IDS = [2, 3, 8, 47];
const DEFAULT_SPEAKER_ID = 3;

// VPS保護: キュー内の未処理ジョブがこの数以上なら、選択中の1キャラだけ作成
const QUEUE_THRESHOLD = 4;

/**
 * POST /api/tts/generate
 * キューが空いていれば4キャラ一括、混んでいれば選択中の1キャラだけ作成
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { minute_id } = body;
    if (!minute_id) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    let primarySpeaker = DEFAULT_SPEAKER_ID;
    if (body.speaker_id !== undefined) {
      const parsed = parseInt(body.speaker_id, 10);
      if (ALL_SPEAKER_IDS.includes(parsed)) {
        primarySpeaker = parsed;
      }
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

    // 2. テキストハッシュ・チャンク分割
    const textHash = await generateTextHash(summaryText);
    const chunks = splitTextIntoChunks(summaryText);
    const totalChunks = chunks.length;

    // 3. キュー深さチェック: VPS が詰まっていないか確認
    const { count: queueDepth } = await supabase
      .from('minutes_audio')
      .select('id', { count: 'exact', head: true })
      .in('status', ['generating', 'processing']);

    const isBusy = (queueDepth ?? 0) >= QUEUE_THRESHOLD;
    // 混んでいたら primary のみ、空いていたら全キャラ
    const speakersToCreate = isBusy ? [primarySpeaker] : ALL_SPEAKER_IDS;

    if (isBusy) {
      console.log(`[TTS] キュー混雑 (${queueDepth}件) → speaker=${primarySpeaker} のみ作成`);
    }

    // 4. 対象スピーカーについてジョブを作成/確認
    let primaryResult: { audio_id: string; status: string; total_chunks: number; completed_chunks: number } | null = null;

    for (const spkId of speakersToCreate) {
      // 既存レコード確認
      const { data: existing } = await supabase
        .from('minutes_audio')
        .select('id, status, total_chunks, completed_chunks, speaker_id')
        .eq('minute_id', String(minute_id))
        .eq('text_hash', textHash)
        .eq('speaker_id', spkId)
        .single();

      if (existing) {
        // failed → リセットして再生成
        if (existing.status === 'failed') {
          await supabase
            .from('minutes_audio_chunks')
            .delete()
            .eq('audio_id', existing.id);

          await supabase
            .from('minutes_audio')
            .update({
              status: 'generating',
              total_chunks: totalChunks,
              completed_chunks: 0,
              current_chunk_index: 0,
              progress_text: `0 / ${totalChunks}`,
              error_message: null,
              locked_by: null,
              processing_started_at: null,
            })
            .eq('id', existing.id);

          console.log(`[TTS] 再生成: speaker=${spkId}, ${totalChunks}チャンク (minute_id=${minute_id})`);
        }

        if (spkId === primarySpeaker) {
          primaryResult = {
            audio_id: existing.id,
            status: existing.status === 'failed' ? 'generating' : existing.status,
            total_chunks: existing.total_chunks || totalChunks,
            completed_chunks: existing.status === 'failed' ? 0 : (existing.completed_chunks || 0),
          };
        }
        continue;
      }

      // 新規ジョブ作成
      console.log(`[TTS] 新規ジョブ: speaker=${spkId}, ${totalChunks}チャンク (minute_id=${minute_id})`);

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
          speaker_id: spkId,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error(`Insert error (speaker=${spkId}):`, insertError);
        continue;
      }

      if (spkId === primarySpeaker && audioRecord) {
        primaryResult = {
          audio_id: audioRecord.id,
          status: 'generating',
          total_chunks: totalChunks,
          completed_chunks: 0,
        };
      }
    }

    if (!primaryResult) {
      return NextResponse.json({ error: '音声レコード作成に失敗しました' }, { status: 500 });
    }

    return NextResponse.json(primaryResult);
  } catch (error: unknown) {
    console.error('TTS Generate Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
