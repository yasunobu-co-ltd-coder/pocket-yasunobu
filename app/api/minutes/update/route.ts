import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';

/**
 * POST /api/minutes/update
 * 議事録レコードを更新（service_role経由）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, client_name, summary } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from(TABLE_NAME)
      .update({ client_name, summary })
      .eq('id', id);

    if (error) {
      console.error('Minutes update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error('Minutes update API error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
