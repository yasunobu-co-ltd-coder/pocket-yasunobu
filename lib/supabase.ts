import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// クライアント用シングルトン（ブラウザ・サーバー共通）
export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseKey)
  : (null as unknown as SupabaseClient);

// サーバー用adminクライアント（API routeでのみ使用、遅延生成）
let _supabaseAdmin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      supabaseUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
  }
  return _supabaseAdmin;
}
