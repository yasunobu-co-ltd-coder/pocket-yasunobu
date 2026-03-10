import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { splitTextIntoChunks, generateTextHash } from '@/lib/tts-chunk-splitter';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5分タイムアウト

const TABLE_NAME = 'pocket-yasunobu';
const VOICEVOX_URL = process.env.VOICEVOX_API_URL || 'http://localhost:50021';
const SPEAKER_ID = parseInt(process.env.VOICEVOX_SPEAKER_ID || '1', 10);

/**
 * POST /api/tts/generate
 * 議事録テキストをVOICEVOXで音声合成し、Supabase Storageに保存
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
      .select('id, status')
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
          message: '生成中です',
        });
      }
      // failed の場合は再生成 → 既存レコードを再利用
      if (existing.status === 'failed') {
        await supabase
          .from('minutes_audio')
          .update({ status: 'generating' })
          .eq('id', existing.id);

        // 古いチャンクを削除
        await supabase
          .from('minutes_audio_chunks')
          .delete()
          .eq('audio_id', existing.id);

        return await processGeneration(supabase, existing.id, String(minute_id), summaryText);
      }
    }

    // 4. 新規レコード作成
    const { data: audioRecord, error: insertError } = await supabase
      .from('minutes_audio')
      .insert({
        minute_id: String(minute_id),
        text_hash: textHash,
        status: 'generating',
      })
      .select('id')
      .single();

    if (insertError || !audioRecord) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: '音声レコード作成に失敗しました' }, { status: 500 });
    }

    // 5. 音声生成処理
    return await processGeneration(supabase, audioRecord.id, String(minute_id), summaryText);
  } catch (error: unknown) {
    console.error('TTS Generate Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * VOICEVOX音声生成メイン処理
 */
async function processGeneration(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  audioId: string,
  minuteId: string,
  text: string,
) {
  try {
    // テキストをチャンクに分割
    const chunks = splitTextIntoChunks(text);
    let totalDuration = 0;

    console.log(`[TTS] 合計 ${chunks.length} チャンクに分割`);

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      console.log(`[TTS] chunk ${i}/${chunks.length - 1}: ${chunkText.length} 文字`);

      // VOICEVOX: audio_query 作成
      const queryRes = await fetch(
        `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(chunkText)}&speaker=${SPEAKER_ID}`,
        { method: 'POST' }
      );
      if (!queryRes.ok) {
        const errBody = await queryRes.text();
        console.error(`[TTS] audio_query failed for chunk ${i}: ${queryRes.status}`, errBody);
        throw new Error(`VOICEVOX audio_query failed: ${queryRes.status} ${errBody}`);
      }
      const audioQuery = await queryRes.json();

      // VOICEVOX: synthesis（WAV生成）
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
        console.error(`[TTS] synthesis failed for chunk ${i}: ${synthRes.status}`, errBody);
        // メモリ不足の判定
        if (errBody.includes('allocate memory') || errBody.includes('out of memory') || errBody.includes('OOM') || synthRes.status === 500) {
          throw new Error(`音声生成サーバーのメモリ不足の可能性があります（chunk ${i}, ${chunkText.length}文字）`);
        }
        throw new Error(`VOICEVOX synthesis failed: ${synthRes.status} ${errBody}`);
      }

      const wavBuffer = await synthRes.arrayBuffer();

      // WAVファイルの再生時間を概算（WAVヘッダから取得）
      const durationSec = estimateWavDuration(wavBuffer);
      totalDuration += durationSec;

      // Supabase Storageにアップロード
      const filePath = `tts/${minuteId}/chunk_${i}.wav`;
      const { error: uploadError } = await supabase.storage
        .from('tts-audio')
        .upload(filePath, wavBuffer, {
          contentType: 'audio/wav',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      // 公開URLを取得
      const { data: urlData } = supabase.storage
        .from('tts-audio')
        .getPublicUrl(filePath);

      // チャンクレコードを挿入
      const { error: chunkError } = await supabase
        .from('minutes_audio_chunks')
        .insert({
          audio_id: audioId,
          chunk_index: i,
          chunk_text: chunkText,
          audio_url: urlData.publicUrl,
          duration_sec: Math.round(durationSec),
        });

      if (chunkError) {
        throw new Error(`Chunk insert failed: ${chunkError.message}`);
      }
    }

    // ステータスを ready に更新
    await supabase
      .from('minutes_audio')
      .update({
        status: 'ready',
        duration_sec: Math.round(totalDuration),
      })
      .eq('id', audioId);

    return NextResponse.json({
      audio_id: audioId,
      status: 'ready',
      chunk_count: chunks.length,
      duration_sec: Math.round(totalDuration),
    });
  } catch (error: unknown) {
    console.error('Generation process error:', error);

    // ステータスを failed に更新
    await supabase
      .from('minutes_audio')
      .update({ status: 'failed' })
      .eq('id', audioId);

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message, audio_id: audioId, status: 'failed' }, { status: 500 });
  }
}

/**
 * WAVファイルのバッファから再生時間（秒）を概算
 */
function estimateWavDuration(buffer: ArrayBuffer): number {
  try {
    const view = new DataView(buffer);
    // WAV header: byte rate is at offset 28 (4 bytes, little-endian)
    const byteRate = view.getUint32(28, true);
    // Data size: total - 44 (standard WAV header size)
    const dataSize = buffer.byteLength - 44;
    if (byteRate > 0) {
      return dataSize / byteRate;
    }
  } catch {
    // ヘッダ解析失敗時
  }
  // フォールバック: 48kHz, 16bit, mono として概算
  return (buffer.byteLength - 44) / (48000 * 2);
}
