import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitTextIntoChunks } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1チャンクなので短め

const TABLE_NAME = 'pocket-yasunobu';
// 末尾スラッシュを除去して安全にURL構築
const VOICEVOX_BASE = (process.env.VOICEVOX_API_URL || 'http://localhost:50021').replace(/\/+$/, '');
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
    const preview = chunkText.slice(0, 50).replace(/\n/g, '↵');
    console.log(`[TTS] chunk ${chunkIndex + 1}/${chunks.length} length=${chunkText.length} "${preview}"`);
    console.log(`[TTS] VOICEVOX_BASE: "${VOICEVOX_BASE}", SPEAKER_ID: ${SPEAKER_ID}`);

    // 3. VOICEVOX audio_query（URLSearchParamsで安全に構築）
    const audioQueryUrl = new URL(`${VOICEVOX_BASE}/audio_query`);
    audioQueryUrl.searchParams.set('text', chunkText);
    audioQueryUrl.searchParams.set('speaker', String(SPEAKER_ID));
    console.log(`[TTS] audio_query URL: ${audioQueryUrl.toString()}`);

    let audioQuery;
    try {
      const queryRes = await fetch(audioQueryUrl.toString(), { method: 'POST' });
      if (!queryRes.ok) {
        const errBody = await queryRes.text();
        const errDetail = `audio_query失敗: status=${queryRes.status}, url=${audioQueryUrl.toString()}, body=${errBody.slice(0, 200)}`;
        console.error(`[TTS] ${errDetail}`);
        await markFailed(supabase, audio_id, errDetail);
        return NextResponse.json({ audio_id, status: 'failed', error: errDetail }, { status: 502 });
      }
      audioQuery = await queryRes.json();
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown fetch error';
      const errDetail = `VOICEVOXサーバー接続エラー: ${msg}, url=${audioQueryUrl.toString()}`;
      console.error(`[TTS] ${errDetail}`);
      await markFailed(supabase, audio_id, errDetail);
      return NextResponse.json({ audio_id, status: 'failed', error: errDetail }, { status: 502 });
    }

    // 4. VOICEVOX synthesis
    console.log(`[TTS] audio_query成功 (chunk ${chunkIndex}), synthesis開始...`);
    const synthesisUrl = new URL(`${VOICEVOX_BASE}/synthesis`);
    synthesisUrl.searchParams.set('speaker', String(SPEAKER_ID));
    const synthUrlStr = synthesisUrl.toString();
    const audioQueryBody = JSON.stringify(audioQuery);
    console.log(`[TTS] synthesis URL: ${synthUrlStr}`);
    console.log(`[TTS] synthesis body size: ${audioQueryBody.length} bytes`);

    let synthRes;
    try {
      const synthStartTime = Date.now();
      synthRes = await fetch(synthUrlStr, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: audioQueryBody,
        signal: AbortSignal.timeout(50000), // 50秒タイムアウト
      });
      console.log(`[TTS] synthesis応答: status=${synthRes.status}, ${Date.now() - synthStartTime}ms`);
    } catch (fetchErr: unknown) {
      const errObj = fetchErr instanceof Error ? { name: fetchErr.name, message: fetchErr.message, cause: String(fetchErr.cause ?? '') } : { message: String(fetchErr) };
      const errDetail = `VOICEVOX synthesis接続エラー: ${JSON.stringify(errObj)}, chunk=${chunkIndex}, length=${chunkText.length}, url=${synthUrlStr}`;
      console.error(`[TTS] ${errDetail}`);
      await markFailed(supabase, audio_id, errDetail);
      return NextResponse.json({ audio_id, status: 'failed', error: errDetail, chunk_index: chunkIndex, chunk_length: chunkText.length }, { status: 502 });
    }
    if (!synthRes.ok) {
      const errBody = await synthRes.text();
      const isMemory = errBody.includes('allocate memory') || errBody.includes('out of memory') || errBody.includes('OOM') || synthRes.status === 500;
      const errDetail = isMemory
        ? `音声生成サーバーのメモリ不足の可能性があります（chunk ${chunkIndex}, ${chunkText.length}文字）`
        : `VOICEVOX synthesis失敗: status=${synthRes.status}, chunk=${chunkIndex}, length=${chunkText.length}, url=${synthUrlStr}, body=${errBody.slice(0, 300)}`;
      console.error(`[TTS] ${errDetail}`);
      await markFailed(supabase, audio_id, errDetail);
      return NextResponse.json({ audio_id, status: 'failed', error: errDetail, chunk_index: chunkIndex, chunk_length: chunkText.length }, { status: 502 });
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
