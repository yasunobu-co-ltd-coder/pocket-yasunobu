import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const TABLE_NAME = 'pocket-yasunobu';

/**
 * POST /api/minutes
 * 議事録レコードを新規作成（service_role経由）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_id, client_name, transcript, summary, decisions, todos, next_schedule, keywords } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert({
        user_id,
        client_name: client_name || '',
        transcript: transcript || '',
        summary: summary || '',
        decisions: decisions || [],
        todos: todos || [],
        next_schedule: next_schedule || '',
        keywords: keywords || [],
      })
      .select('id')
      .single();

    if (error) {
      console.error('Minutes insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id });
  } catch (e: unknown) {
    console.error('Minutes API error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
