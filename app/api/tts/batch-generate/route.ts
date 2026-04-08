import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateTextHash, splitTextIntoChunks } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';
// NOTE: Storage容量削減のため一時的に四国めたんのみ。復旧時は [2, 3, 8, 47] に戻す
const ALL_SPEAKER_IDS = [2];

/**
 * POST /api/tts/batch-generate
 * 既存の議事録のうち音声未生成のものに対してジョブを作成する
 * VPS負荷を考慮して1回のリクエストで最大 BATCH_SIZE 件まで処理
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(parseInt(body.batch_size, 10) || 5, 20);

    const supabase = getSupabaseAdmin();

    // summaryがある議事録を取得
    const { data: minutes, error: fetchErr } = await supabase
      .from(TABLE_NAME)
      .select('id, summary')
      .not('summary', 'is', null)
      .order('created_at', { ascending: false })
      .limit(batchSize * 3);

    if (fetchErr || !minutes) {
      return NextResponse.json({ error: '議事録の取得に失敗しました' }, { status: 500 });
    }

    let created = 0;
    let skipped = 0;

    for (const minute of minutes) {
      if (created >= batchSize) break;

      const summaryText = minute.summary as string;
      if (!summaryText?.trim()) { skipped++; continue; }

      const textHash = await generateTextHash(summaryText);
      const chunks = splitTextIntoChunks(summaryText);
      const totalChunks = chunks.length;

      // この議事録に対して既にジョブがあるか確認（任意のspeaker_idで）
      const { data: existing } = await supabase
        .from('minutes_audio')
        .select('speaker_id')
        .eq('minute_id', String(minute.id))
        .eq('text_hash', textHash);

      const existingSpeakers = new Set((existing || []).map(e => e.speaker_id));

      // 未生成のスピーカー分だけジョブ作成
      let createdForThis = false;
      for (const spkId of ALL_SPEAKER_IDS) {
        if (existingSpeakers.has(spkId)) continue;

        const { error: insertErr } = await supabase
          .from('minutes_audio')
          .insert({
            minute_id: String(minute.id),
            text_hash: textHash,
            status: 'generating',
            total_chunks: totalChunks,
            completed_chunks: 0,
            current_chunk_index: 0,
            progress_text: `0 / ${totalChunks}`,
            speaker_id: spkId,
          });

        if (insertErr) {
          console.error(`[Batch] Insert error minute=${minute.id} speaker=${spkId}:`, insertErr);
          continue;
        }
        createdForThis = true;
      }

      if (createdForThis) {
        created++;
        console.log(`[Batch] ジョブ作成: minute_id=${minute.id}`);
      } else {
        skipped++;
      }
    }

    return NextResponse.json({
      total_minutes: minutes.length,
      created,
      skipped,
      message: created > 0
        ? `${created}件の議事録に音声ジョブを作成しました`
        : '全ての議事録に音声が生成済みです',
    });
  } catch (error: unknown) {
    console.error('Batch Generate Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
