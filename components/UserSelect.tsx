'use client';

import { useState, useEffect } from 'react';
import { Loader2, User, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface UserData {
    id: number;
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

    useEffect(() => {
        fetchUsers();
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6">
            {/* Logo */}
            <div className="mb-10 text-center">
                <div className="w-20 h-20 bg-violet-500/15 backdrop-blur-md rounded-3xl flex items-center justify-center text-4xl mx-auto mb-4 border border-violet-500/20 shadow-[0_0_40px_rgba(139,92,246,0.15)]">
                    📱
                </div>
                <h1 className="text-3xl font-extrabold text-white tracking-tight">Pocket Matip</h1>
                <p className="text-violet-300/60 text-sm mt-1">営業活動アシスタント</p>
            </div>

            {/* User Selection */}
            <div className="w-full max-w-sm">
                <h2 className="text-sm font-bold text-slate-400 mb-4 text-center">ユーザーを選択してください</h2>

                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                    </div>
                )}

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center">
                        <p className="text-sm text-red-400 mb-3">{error}</p>
                        <button
                            onClick={fetchUsers}
                            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 mx-auto"
                        >
                            <RefreshCw className="w-3 h-3" />
                            再読み込み
                        </button>
                    </div>
                )}

                {!loading && !error && users.length === 0 && (
                    <div className="text-center py-8">
                        <p className="text-slate-500 text-sm">ユーザーが登録されていません</p>
                    </div>
                )}

                {!loading && !error && users.length > 0 && (
                    <div className="space-y-3">
                        {users.map((user) => (
                            <button
                                key={user.id}
                                onClick={() => onSelect(user)}
                                className="w-full bg-[#0f0a1a] border border-violet-500/20 rounded-2xl p-4 flex items-center gap-4 hover:border-violet-500/50 hover:bg-violet-500/5 hover:shadow-[0_0_30px_rgba(139,92,246,0.1)] transition-all active:scale-[0.98] group"
                            >
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:scale-110 transition-transform">
                                    <User className="w-6 h-6 text-white" />
                                </div>
                                <div className="text-left">
                                    <div className="text-base font-bold text-white">{user.name}</div>
                                    <div className="text-xs text-violet-300/40">タップしてログイン</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <p className="text-[10px] text-violet-500/30 font-mono mt-12">Pocket Matip v8.0</p>
        </div>
    );
}
