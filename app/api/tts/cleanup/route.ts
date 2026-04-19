import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/tts/cleanup
 * 3日以上再生されていないTTS音声（Storage + DB）を削除する
 * Vercel Cronで毎日実行される
 *
 * 認証: Vercel Cronは CRON_SECRET 環境変数をAuthorizationヘッダで送る
 */
export async function GET(req: NextRequest) {
  // Vercel Cronからの呼び出しを検証
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // 期限切れレコード（3日以上再生なし）を取得
    // SQLビュー expired_tts_audio が audio_id, minute_id, last_played_at, audio_url を返す
    const { data: expired, error: viewError } = await supabase
      .from('expired_tts_audio')
      .select('audio_id, audio_url');

    if (viewError) {
      console.error('expired_tts_audio query error:', viewError);
      return NextResponse.json({ error: viewError.message }, { status: 500 });
    }

    if (!expired || expired.length === 0) {
      return NextResponse.json({ deleted_audio_count: 0, deleted_files: 0 });
    }

    // 1. 削除対象のStorageパスを抽出
    // audio_url は "https://<proj>.supabase.co/storage/v1/object/public/tts-audio/<path>" 形式
    const storagePaths = new Set<string>();
    for (const row of expired) {
      if (!row.audio_url) continue;
      const match = row.audio_url.match(/\/tts-audio\/(.+?)(?:\?|$)/);
      if (match?.[1]) {
        storagePaths.add(decodeURIComponent(match[1]));
      }
    }

    // 2. Storageから削除（100件ずつバッチ）
    let deletedFiles = 0;
    const pathsArr = Array.from(storagePaths);
    for (let i = 0; i < pathsArr.length; i += 100) {
      const batch = pathsArr.slice(i, i + 100);
      const { error: storageError } = await supabase.storage.from('tts-audio').remove(batch);
      if (storageError) {
        console.error('Storage remove error:', storageError);
        // Storage削除失敗時もDB削除は続行（孤立ファイルは次回クリーンアップで拾う）
      } else {
        deletedFiles += batch.length;
      }
    }

    // 3. DBから削除（minutes_audio 削除でチャンクはCASCADE）
    const audioIds = Array.from(new Set(expired.map(r => r.audio_id).filter(Boolean)));
    const { error: deleteError } = await supabase
      .from('minutes_audio')
      .delete()
      .in('id', audioIds);

    if (deleteError) {
      console.error('DB delete error:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({
      deleted_audio_count: audioIds.length,
      deleted_files: deletedFiles,
    });
  } catch (error: unknown) {
    console.error('TTS Cleanup Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
