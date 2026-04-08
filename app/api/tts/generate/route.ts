import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitTextIntoChunks, generateTextHash } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';

const ALL_SPEAKER_IDS = [2, 47];
const DEFAULT_SPEAKER_ID = 2;

// VPS保護: キュー内の未処理ジョブがこの数以上なら、選択中の1キャラだけ作成
const QUEUE_THRESHOLD = 4;

/**
 * POST /api/tts/generate
 * 編集時は変更チャンクのみ再生成（未変更チャンクの音声はコピーして流用）
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
    const newChunks = splitTextIntoChunks(summaryText);
    const totalChunks = newChunks.length;

    // 3. キュー深さチェック: VPS が詰まっていないか確認
    const { count: queueDepth } = await supabase
      .from('minutes_audio')
      .select('id', { count: 'exact', head: true })
      .in('status', ['generating', 'processing']);

    const isBusy = (queueDepth ?? 0) >= QUEUE_THRESHOLD;
    const speakersToCreate = isBusy ? [primarySpeaker] : ALL_SPEAKER_IDS;

    if (isBusy) {
      console.log(`[TTS] キュー混雑 (${queueDepth}件) → speaker=${primarySpeaker} のみ作成`);
    }

    // 4. 既存レコードを一括取得（スピーカーごとの個別クエリを排除）
    const { data: existingRecords } = await supabase
      .from('minutes_audio')
      .select('id, status, total_chunks, completed_chunks, text_hash, speaker_id')
      .eq('minute_id', String(minute_id))
      .in('speaker_id', speakersToCreate)
      .order('created_at', { ascending: false });

    const sameHashMap = new Map<number, { id: string; status: string; total_chunks: number; completed_chunks: number }>();
    const oldRecordMap = new Map<number, { id: string; text_hash: string }>();
    for (const r of existingRecords || []) {
      if (r.text_hash === textHash) {
        if (!sameHashMap.has(r.speaker_id)) sameHashMap.set(r.speaker_id, r);
      } else {
        if (!oldRecordMap.has(r.speaker_id)) oldRecordMap.set(r.speaker_id, r);
      }
    }

    let primaryResult: { audio_id: string; status: string; total_chunks: number; completed_chunks: number } | null = null;

    for (const spkId of speakersToCreate) {
      const sameHash = sameHashMap.get(spkId);
      if (sameHash) {
        if (sameHash.status === 'failed') {
          await supabase.from('minutes_audio_chunks').delete().eq('audio_id', sameHash.id);
          await supabase.from('minutes_audio').update({
            status: 'generating',
            total_chunks: totalChunks,
            completed_chunks: 0,
            current_chunk_index: 0,
            progress_text: `0 / ${totalChunks}`,
            error_message: null,
            locked_by: null,
            processing_started_at: null,
          }).eq('id', sameHash.id);
          console.log(`[TTS] 再生成: speaker=${spkId}, ${totalChunks}チャンク (minute_id=${minute_id})`);
        }
        if (spkId === primarySpeaker) {
          primaryResult = {
            audio_id: sameHash.id,
            status: sameHash.status === 'failed' ? 'generating' : sameHash.status,
            total_chunks: sameHash.total_chunks || totalChunks,
            completed_chunks: sameHash.status === 'failed' ? 0 : (sameHash.completed_chunks || 0),
          };
        }
        continue;
      }

      const oldRecord = oldRecordMap.get(spkId) || null;

      // 旧チャンクのテキスト→音声URLマップを構築
      let oldChunkMap = new Map<string, { audio_url: string; duration_sec: number }>();
      if (oldRecord) {
        const { data: oldChunks } = await supabase
          .from('minutes_audio_chunks')
          .select('chunk_text, audio_url, duration_sec')
          .eq('audio_id', oldRecord.id)
          .not('audio_url', 'is', null);

        if (oldChunks) {
          for (const oc of oldChunks) {
            if (oc.chunk_text && oc.audio_url) {
              oldChunkMap.set(oc.chunk_text, {
                audio_url: oc.audio_url,
                duration_sec: oc.duration_sec || 0,
              });
            }
          }
        }
      }

      // 新規ジョブ作成
      const reusedCount = newChunks.filter(ct => oldChunkMap.has(ct)).length;
      const needGenCount = totalChunks - reusedCount;
      console.log(`[TTS] 差分生成: speaker=${spkId}, ${totalChunks}チャンク中 ${reusedCount}件流用, ${needGenCount}件新規生成 (minute_id=${minute_id})`);

      const { data: audioRecord, error: insertError } = await supabase
        .from('minutes_audio')
        .insert({
          minute_id: String(minute_id),
          text_hash: textHash,
          status: needGenCount === 0 ? 'ready' : 'generating',
          total_chunks: totalChunks,
          completed_chunks: reusedCount,
          current_chunk_index: reusedCount,
          progress_text: `${reusedCount} / ${totalChunks}`,
          speaker_id: spkId,
        })
        .select('id')
        .single();

      if (insertError || !audioRecord) {
        console.error(`Insert error (speaker=${spkId}):`, insertError);
        continue;
      }

      // 未変更チャンクの音声をコピー挿入
      const chunkInserts = [];
      for (let i = 0; i < newChunks.length; i++) {
        const old = oldChunkMap.get(newChunks[i]);
        if (old) {
          chunkInserts.push({
            audio_id: audioRecord.id,
            chunk_index: i,
            chunk_text: newChunks[i],
            audio_url: old.audio_url,
            duration_sec: old.duration_sec,
          });
        }
      }
      if (chunkInserts.length > 0) {
        await supabase.from('minutes_audio_chunks').insert(chunkInserts);
      }

      // 全チャンク流用できた場合は即ready
      if (needGenCount === 0) {
        const totalDuration = chunkInserts.reduce((s, c) => s + (c.duration_sec || 0), 0);
        await supabase.from('minutes_audio').update({
          duration_sec: totalDuration,
        }).eq('id', audioRecord.id);
      }

      // 旧レコードを削除（チャンクも CASCADE or 手動削除）
      if (oldRecord) {
        await supabase.from('minutes_audio_chunks').delete().eq('audio_id', oldRecord.id);
        await supabase.from('minutes_audio').delete().eq('id', oldRecord.id);
        console.log(`[TTS] 旧レコード削除: audio_id=${oldRecord.id}`);
      }

      if (spkId === primarySpeaker) {
        primaryResult = {
          audio_id: audioRecord.id,
          status: needGenCount === 0 ? 'ready' : 'generating',
          total_chunks: totalChunks,
          completed_chunks: reusedCount,
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
