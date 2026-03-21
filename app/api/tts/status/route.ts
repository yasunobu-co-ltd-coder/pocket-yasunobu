import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/tts/status?minute_id=xxx&speaker_id=3
 * 議事録の音声生成状態・進捗・チャンク情報を返す
 * speaker_id 指定時はそのスピーカーのレコードを返す
 */
export async function GET(req: NextRequest) {
  try {
    const minuteId = req.nextUrl.searchParams.get('minute_id');
    if (!minuteId) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const speakerIdParam = req.nextUrl.searchParams.get('speaker_id');
    const supabase = getSupabaseAdmin();

    // 音声レコードを取得（speaker_id指定時はフィルタ）
    let query = supabase
      .from('minutes_audio')
      .select('id, status, duration_sec, text_hash, total_chunks, completed_chunks, current_chunk_index, progress_text, error_message, speaker_id, created_at, updated_at')
      .eq('minute_id', minuteId);

    if (speakerIdParam) {
      query = query.eq('speaker_id', parseInt(speakerIdParam, 10));
    }

    const { data: audio, error: audioError } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (audioError || !audio) {
      return NextResponse.json({ status: 'not_generated', message: '音声データがありません' });
    }

    const { data: chunks } = await supabase
      .from('minutes_audio_chunks')
      .select('id, chunk_index, chunk_text, audio_url, duration_sec')
      .eq('audio_id', audio.id)
      .order('chunk_index', { ascending: true });

    return NextResponse.json({
      audio_id: audio.id,
      status: audio.status,
      duration_sec: audio.duration_sec,
      text_hash: audio.text_hash,
      total_chunks: audio.total_chunks || 0,
      completed_chunks: audio.completed_chunks || 0,
      current_chunk_index: audio.current_chunk_index || 0,
      progress_text: audio.progress_text || '',
      error_message: audio.error_message || null,
      speaker_id: audio.speaker_id ?? 3,
      chunks: chunks || [],
      created_at: audio.created_at,
      updated_at: audio.updated_at,
    });
  } catch (error: unknown) {
    console.error('TTS Status Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
