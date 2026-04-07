import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/radio-talk/status?minute_id=xxx
 * ラジオトーク音声の生成状況と再生URLを返す
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const minuteId = searchParams.get('minute_id');

    if (!minuteId) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 最新の音声ジョブを取得
    const { data: audio, error: audioErr } = await supabase
      .from('radio_talk_audio')
      .select(`
        id,
        status,
        total_segments,
        completed_segments,
        progress_text,
        audio_url,
        duration_sec,
        error_message,
        speaker_mapping,
        script_id,
        created_at,
        updated_at
      `)
      .eq('minute_id', minuteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (audioErr) {
      console.error('Radio talk status fetch error:', audioErr);
      return NextResponse.json({ error: audioErr.message }, { status: 500 });
    }

    if (!audio) {
      return NextResponse.json({
        status: 'not_generated',
        audio_id: null,
        audio_url: null,
        script: null,
      });
    }

    // 台本取得
    let script = null;
    if (audio.script_id) {
      const { data: scriptRow } = await supabase
        .from('radio_talk_scripts')
        .select('script')
        .eq('id', audio.script_id)
        .single();
      script = scriptRow?.script || null;
    }

    return NextResponse.json({
      audio_id: audio.id,
      status: audio.status,
      total_segments: audio.total_segments,
      completed_segments: audio.completed_segments,
      progress_text: audio.progress_text || `${audio.completed_segments} / ${audio.total_segments}`,
      audio_url: audio.audio_url,
      duration_sec: audio.duration_sec,
      error_message: audio.error_message,
      script,
      speaker_mapping: audio.speaker_mapping,
      created_at: audio.created_at,
      updated_at: audio.updated_at,
    });

  } catch (e: unknown) {
    console.error('Radio talk status error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
