import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * POST /api/users/reorder
 * ユーザーの並び順を更新（service_role経由）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orders } = body;

    if (!Array.isArray(orders)) {
      return NextResponse.json({ error: 'orders array is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const updates = orders.map((item: { id: string; sort_order: number }) =>
      supabase.from('users').update({ sort_order: item.sort_order }).eq('id', item.id)
    );
    await Promise.all(updates);

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error('Users reorder API error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
