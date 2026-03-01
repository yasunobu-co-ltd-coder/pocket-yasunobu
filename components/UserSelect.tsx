'use client';

import { useState, useEffect } from 'react';
import { Loader2, User, RefreshCw, Mic } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface UserData {
    id: string;
    name: string;
    [key: string]: unknown;
}

interface UserSelectProps {
    onSelect: (user: UserData) => void;
}

export default function UserSelect({ onSelect }: UserSelectProps) {
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchUsers = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .from('user')
                .select('*')
                .order('id', { ascending: true });
            if (fetchError) throw fetchError;
            setUsers(data || []);
        } catch (e: unknown) {
            console.error('Fetch users error:', e);
            const msg = e instanceof Error ? e.message : 'ユーザー取得エラー';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-10 py-16"
            style={{ background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' }}>

            {/* Brand */}
            <div className="mb-10 text-center animate-fade-in-up">
                <div className="w-16 h-16 bg-gradient-to-br from-violet-600 to-violet-800 rounded-[18px] flex items-center justify-center mx-auto mb-5 shadow-[0_4px_12px_rgba(124,58,237,0.3)]">
                    <Mic className="w-7 h-7 text-white" />
                </div>
                <h1 className="font-extrabold text-[22px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px] mb-1">
                    Pocket Matip
                </h1>
                <p className="text-slate-400 text-[13px]">AI議事録アシスタント</p>
            </div>

            {/* Card */}
            <div className="w-full max-w-[340px] bg-white/90 backdrop-blur-[10px] rounded-[24px] p-8 shadow-[0_20px_40px_-10px_rgba(124,58,237,0.15)] border border-white/60">
                <p className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-5 text-center">ユーザーを選択</p>

                {loading && (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                        <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                        <p className="text-[12px] text-slate-400">読み込み中...</p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-5 text-center">
                        <p className="text-[13px] text-red-600 mb-4">{error}</p>
                        <button onClick={fetchUsers}
                            className="text-[12px] text-slate-500 hover:text-slate-700 flex items-center gap-1.5 mx-auto bg-white px-4 py-2 rounded-lg border border-slate-200 transition-all active:scale-95">
                            <RefreshCw className="w-3.5 h-3.5" />
                            再読み込み
                        </button>
                    </div>
                )}

                {!loading && !error && users.length === 0 && (
                    <div className="text-center py-10">
                        <User className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-400 text-[13px]">ユーザーが登録されていません</p>
                    </div>
                )}

                {!loading && !error && users.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                        {users.map((user) => (
                            <button
                                key={user.id}
                                onClick={() => onSelect(user)}
                                className="rounded-[14px] py-4 px-3 flex flex-col items-center gap-2 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 transition-all duration-150 active:scale-[0.97] group"
                            >
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-sm">
                                    <span className="text-[14px] font-bold text-white">{user.name.charAt(0)}</span>
                                </div>
                                <span className="text-[13px] font-semibold text-slate-700 group-hover:text-violet-700">{user.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <p className="text-[10px] text-slate-300 font-mono mt-10">v9.0</p>
        </div>
    );
}
