import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitTextIntoChunks } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1チャンクなので短め

const TABLE_NAME = 'pocket-yasunobu';
const VOICEVOX_URL = process.env.VOICEVOX_API_URL || 'http://localhost:50021';
const SPEAKER_ID = parseInt(process.env.VOICEVOX_SPEAKER_ID || '1', 10);

/**
 * POST /api/tts/process-next
 * 1チャンクだけVOICEVOX合成→DB/Storage更新→残りがあるか返却
 */
export async function POST(req: NextRequest) {
  try {
    const { audio_id } = await req.json();
    if (!audio_id) {
      return NextResponse.json({ error: 'audio_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 1. 音声ジョブ情報を取得
    const { data: audio, error: audioError } = await supabase
      .from('minutes_audio')
      .select('*')
      .eq('id', audio_id)
      .single();

    if (audioError || !audio) {
      return NextResponse.json({ error: '音声ジョブが見つかりません' }, { status: 404 });
    }

    if (audio.status === 'ready') {
      return NextResponse.json({
        audio_id,
        status: 'ready',
        completed_chunks: audio.completed_chunks,
        total_chunks: audio.total_chunks,
        has_more: false,
      });
    }

    if (audio.status !== 'generating') {
      return NextResponse.json({ error: `ステータスが不正です: ${audio.status}` }, { status: 400 });
    }

    // 2. 元テキストを取得してチャンク分割
    const { data: record } = await supabase
      .from(TABLE_NAME)
      .select('summary')
      .eq('id', audio.minute_id)
      .single();

    if (!record?.summary) {
      return NextResponse.json({ error: '議事録テキストが見つかりません' }, { status: 404 });
    }

    const chunks = splitTextIntoChunks(record.summary as string);
    const chunkIndex = audio.completed_chunks || 0;

    if (chunkIndex >= chunks.length) {
      // 全チャンク完了済み
      await supabase
        .from('minutes_audio')
        .update({
          status: 'ready',
          progress_text: `${chunks.length} / ${chunks.length}`,
        })
        .eq('id', audio_id);

      return NextResponse.json({
        audio_id,
        status: 'ready',
        completed_chunks: chunks.length,
        total_chunks: chunks.length,
        has_more: false,
      });
    }

    const chunkText = chunks[chunkIndex];
    console.log(`[TTS] process-next: chunk ${chunkIndex}/${chunks.length - 1} (${chunkText.length}文字)`);

    // 3. VOICEVOX audio_query
    const queryRes = await fetch(
      `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(chunkText)}&speaker=${SPEAKER_ID}`,
      { method: 'POST' }
    );
    if (!queryRes.ok) {
      const errBody = await queryRes.text();
      console.error(`[TTS] audio_query failed chunk ${chunkIndex}:`, errBody);
      await markFailed(supabase, audio_id, `VOICEVOX audio_query 失敗 (chunk ${chunkIndex}): ${queryRes.status}`);
      return NextResponse.json({
        audio_id,
        status: 'failed',
        error: `audio_query失敗: ${queryRes.status}`,
      }, { status: 502 });
    }
    const audioQuery = await queryRes.json();

    // 4. VOICEVOX synthesis
    const synthRes = await fetch(
      `${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioQuery),
      }
    );
    if (!synthRes.ok) {
      const errBody = await synthRes.text();
      console.error(`[TTS] synthesis failed chunk ${chunkIndex}:`, errBody);
      const isMemory = errBody.includes('allocate memory') || errBody.includes('out of memory') || errBody.includes('OOM') || synthRes.status === 500;
      const errorMsg = isMemory
        ? `音声生成サーバーのメモリ不足の可能性があります（chunk ${chunkIndex}, ${chunkText.length}文字）`
        : `VOICEVOX synthesis 失敗 (chunk ${chunkIndex}): ${synthRes.status}`;
      await markFailed(supabase, audio_id, errorMsg);
      return NextResponse.json({
        audio_id,
        status: 'failed',
        error: errorMsg,
      }, { status: 502 });
    }

    const wavBuffer = await synthRes.arrayBuffer();
    const durationSec = estimateWavDuration(wavBuffer);

    // 5. Supabase Storage にアップロード
    const filePath = `tts/${audio.minute_id}/chunk_${chunkIndex}.wav`;
    const { error: uploadError } = await supabase.storage
      .from('tts-audio')
      .upload(filePath, wavBuffer, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      await markFailed(supabase, audio_id, `Storage upload failed: ${uploadError.message}`);
      return NextResponse.json({ audio_id, status: 'failed', error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from('tts-audio').getPublicUrl(filePath);

    // 6. チャンクレコード挿入
    await supabase.from('minutes_audio_chunks').insert({
      audio_id,
      chunk_index: chunkIndex,
      chunk_text: chunkText,
      audio_url: urlData.publicUrl,
      duration_sec: Math.round(durationSec),
    });

    // 7. 進捗更新
    const newCompleted = chunkIndex + 1;
    const totalChunks = chunks.length;
    const isComplete = newCompleted >= totalChunks;

    // 合計duration取得
    let totalDuration = 0;
    if (isComplete) {
      const { data: allChunks } = await supabase
        .from('minutes_audio_chunks')
        .select('duration_sec')
        .eq('audio_id', audio_id);
      totalDuration = (allChunks || []).reduce((sum, c) => sum + (c.duration_sec || 0), 0);
    }

    await supabase
      .from('minutes_audio')
      .update({
        status: isComplete ? 'ready' : 'generating',
        completed_chunks: newCompleted,
        current_chunk_index: newCompleted,
        progress_text: `${newCompleted} / ${totalChunks}`,
        ...(isComplete ? { duration_sec: totalDuration } : {}),
      })
      .eq('id', audio_id);

    return NextResponse.json({
      audio_id,
      status: isComplete ? 'ready' : 'generating',
      completed_chunks: newCompleted,
      total_chunks: totalChunks,
      has_more: !isComplete,
    });
  } catch (error: unknown) {
    console.error('TTS process-next Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function markFailed(supabase: ReturnType<typeof getSupabaseAdmin>, audioId: string, errorMessage: string) {
  await supabase
    .from('minutes_audio')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', audioId);
}

function estimateWavDuration(buffer: ArrayBuffer): number {
  try {
    const view = new DataView(buffer);
    const byteRate = view.getUint32(28, true);
    const dataSize = buffer.byteLength - 44;
    if (byteRate > 0) return dataSize / byteRate;
  } catch { /* ignore */ }
  return (buffer.byteLength - 44) / (48000 * 2);
}
