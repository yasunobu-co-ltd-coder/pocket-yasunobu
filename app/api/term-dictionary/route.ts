import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/term-dictionary?user_id=xxx&customer=yyy
 * 指定ユーザー・顧客の用語辞書を取得
 * customer省略時は全件取得
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');
    if (!userId) {
        return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const customer = searchParams.get('customer');
    const supabase = getSupabaseAdmin();

    let query = supabase
        .from('term_dictionary')
        .select('*')
        .eq('user_id', userId)
        .order('customer')
        .order('wrong_term');

    if (customer !== null) {
        // 指定顧客 + 全顧客共通（空文字）の両方を取得
        query = query.in('customer', [customer, '']);
    }

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ terms: data });
}

/**
 * POST /api/term-dictionary
 * 用語を登録（upsert）
 */
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { user_id, customer, wrong_term, correct_term } = body;

    if (!user_id || !wrong_term || !correct_term) {
        return NextResponse.json({ error: 'user_id, wrong_term, correct_term are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('term_dictionary')
        .upsert({
            user_id,
            customer: customer || '',
            wrong_term: wrong_term.trim(),
            correct_term: correct_term.trim(),
        }, {
            onConflict: 'user_id,customer,wrong_term',
        })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ term: data });
}

/**
 * DELETE /api/term-dictionary?id=xxx
 * 用語を削除
 */
export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('term_dictionary')
        .delete()
        .eq('id', id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
