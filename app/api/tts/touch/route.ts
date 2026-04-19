import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * POST /api/tts/touch
 * Body: { minute_id: string, speaker_id: number }
 * TTS音声の last_played_at を更新する（3日ルールの基準）
 * 再生開始時に呼ばれる。失敗しても再生は続行する前提なので軽量に作る。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { minute_id, speaker_id } = body;

    if (!minute_id) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const query = supabase
      .from('minutes_audio')
      .update({ last_played_at: new Date().toISOString() })
      .eq('minute_id', String(minute_id));

    if (speaker_id != null) {
      query.eq('speaker_id', speaker_id);
    }

    const { error } = await query;
    if (error) {
      console.error('TTS Touch Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
