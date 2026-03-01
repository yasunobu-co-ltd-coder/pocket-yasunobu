'use client';

import { useState, useEffect } from 'react';
import { Loader2, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface HistoryListProps {
    userId: number;
    refreshTrigger: number;
}

interface MinutesRecord {
    id: number;
    created_at: string;
    client_name: string;
    summary: string;
    user_name: string;
}

export default function HistoryList({ userId, refreshTrigger }: HistoryListProps) {
    const [records, setRecords] = useState<MinutesRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchRecords = async () => {
            setLoading(true);
            setError(null);
            try {
                const { data, error: fetchError } = await supabase
                    .from('pocket-matip')
                    .select('id, created_at, client_name, summary, user_name')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(30);

                if (fetchError) throw fetchError;
                setRecords(data || []);
            } catch (e: unknown) {
                console.error('Fetch records error:', e);
                const msg = e instanceof Error ? e.message : 'データ取得エラー';
                setError(msg);
            } finally {
                setLoading(false);
            }
        };

        fetchRecords();
    }, [userId, refreshTrigger]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-6">
                <p className="text-xs text-red-400">{error}</p>
            </div>
        );
    }

    if (records.length === 0) {
        return (
            <div className="text-center py-8">
                <p className="text-slate-500 text-sm">まだ記録がありません</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {records.map((record) => (
                <div key={record.id} className="bg-black/30 rounded-xl p-3 border border-violet-500/10 hover:border-violet-500/20 transition-colors">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <FileText className="w-4 h-4 text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold text-white truncate">{record.client_name || '名称なし'}</span>
                                <span className="text-[10px] text-violet-400/50">
                                    {new Date(record.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 line-clamp-2">{record.summary}</p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
