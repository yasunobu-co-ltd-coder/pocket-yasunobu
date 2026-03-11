import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/tts/status?minute_id=xxx
 * 議事録の音声生成状態・進捗・チャンク情報を返す
 */
export async function GET(req: NextRequest) {
  try {
    const minuteId = req.nextUrl.searchParams.get('minute_id');
    if (!minuteId) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 最新の音声レコードを取得
    const { data: audio, error: audioError } = await supabase
      .from('minutes_audio')
      .select('*')
      .eq('minute_id', minuteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (audioError || !audio) {
      return NextResponse.json({
        status: 'not_generated',
        message: '音声データがありません',
      });
    }

    // チャンク情報を取得
    const { data: chunks } = await supabase
      .from('minutes_audio_chunks')
      .select('*')
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
