import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set!');
      return NextResponse.json(
        { error: 'サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY が未設定です' },
        { status: 500 }
      );
    }

    const queryDefs = [
      { key: 'pocket_yasunobu', table: 'pocket-yasunobu', col: 'user_id' },
      { key: 'memo_created', table: 'yasunobu-memo', col: 'created_by' },
      { key: 'memo_assigned', table: 'yasunobu-memo', col: 'assignee' },
      { key: 'memo_unread', table: 'yasunobu-memo-unread', col: 'user_id' },
      { key: 'push_subs', table: 'push_subscriptions', col: 'user_id' },
      { key: 'notif_triggered', table: 'notification_logs', col: 'triggered_by_user_id' },
    ] as const;

    const results = await Promise.all(
      queryDefs.map(q =>
        getSupabaseAdmin().from(q.table).select('*', { count: 'exact', head: true }).eq(q.col, userId)
      )
    );

    // Check for query errors — don't silently return 0
    const errors: string[] = [];
    const counts: Record<string, number> = {};
    for (let i = 0; i < queryDefs.length; i++) {
      const { key, table } = queryDefs[i];
      const r = results[i];
      if (r.error) {
        console.error(`Query error for ${table}:`, r.error.message);
        errors.push(`${table}: ${r.error.message}`);
        counts[key] = 0;
      } else {
        counts[key] = r.count ?? 0;
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: `一部テーブルの参照チェックに失敗しました: ${errors.join(', ')}`, counts, userId },
        { status: 500 }
      );
    }

    const canDelete = Object.values(counts).every(c => c === 0);

    return NextResponse.json({ userId, counts, canDelete });
  } catch (e: unknown) {
    console.error('User refs check error:', e);
    const message = e instanceof Error ? e.message : '参照件数の取得に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
