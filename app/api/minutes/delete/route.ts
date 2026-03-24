import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';

/**
 * POST /api/minutes/delete
 * 議事録レコードとその関連データ（音声ジョブ・チャンク・Storage）を一括削除
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { minute_id } = body;

    if (!minute_id) {
      return NextResponse.json({ error: 'minute_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 1. 関連する音声ジョブを取得
    const { data: audioJobs } = await supabase
      .from('minutes_audio')
      .select('id')
      .eq('minute_id', minute_id);

    if (audioJobs && audioJobs.length > 0) {
      const audioIds = audioJobs.map(a => a.id);

      // 2. 音声チャンクレコードを削除
      await supabase
        .from('minutes_audio_chunks')
        .delete()
        .in('audio_id', audioIds);

      // 3. 音声ジョブレコードを削除
      await supabase
        .from('minutes_audio')
        .delete()
        .eq('minute_id', minute_id);

      // 4. Storageの音声ファイルを削除
      for (const job of audioJobs) {
        const prefix = `tts/${minute_id}/${job.id}`;
        const { data: files } = await supabase.storage
          .from('tts-audio')
          .list(prefix);
        if (files && files.length > 0) {
          await supabase.storage
            .from('tts-audio')
            .remove(files.map(f => `${prefix}/${f.name}`));
        }
      }
    }

    // 旧パス（audio_idなし）のファイルも削除
    const { data: legacyFiles } = await supabase.storage
      .from('tts-audio')
      .list(`tts/${minute_id}`);
    if (legacyFiles && legacyFiles.length > 0) {
      const filesToDelete = legacyFiles.filter(f => f.name.endsWith('.wav'));
      if (filesToDelete.length > 0) {
        await supabase.storage
          .from('tts-audio')
          .remove(filesToDelete.map(f => `tts/${minute_id}/${f.name}`));
      }
    }

    // 5. 議事録レコードを削除
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('id', minute_id);

    if (error) {
      console.error('Minutes delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error('Minutes delete API error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
