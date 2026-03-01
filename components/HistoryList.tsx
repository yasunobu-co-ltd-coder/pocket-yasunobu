'use client';

import { useState, useEffect } from 'react';
import { Loader2, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface HistoryListProps {
    userId: string;
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

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'たった今';
        if (diffMins < 60) return `${diffMins}分前`;
        if (diffHours < 24) return `${diffHours}時間前`;
        if (diffDays < 7) return `${diffDays}日前`;
        return `${d.getMonth() + 1}/${d.getDate()}`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-8 px-2">
                <p className="text-[13px] text-red-600 bg-red-50 rounded-xl py-3 px-4 border border-red-100 text-center">{error}</p>
            </div>
        );
    }

    if (records.length === 0) {
        return (
            <div className="text-center py-16">
                <div className="w-14 h-14 bg-slate-50 rounded-[14px] flex items-center justify-center mx-auto mb-4 border border-slate-100">
                    <FileText className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-500 text-[14px] font-medium">まだ記録がありません</p>
                <p className="text-slate-300 text-[12px] mt-2">議事録を作成すると表示されます</p>
            </div>
        );
    }

    return (
        <div>
            {records.map((record) => (
                <div key={record.id}
                    className="rounded-[16px] px-[18px] py-[18px] mb-1 border border-transparent hover:border-slate-100 hover:bg-slate-50/50 transition-all duration-150">
                    <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-[10px] bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5 border border-violet-100">
                            <FileText className="w-[18px] h-[18px] text-violet-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3 mb-1">
                                <span className="text-[15px] font-bold text-slate-800 truncate">{record.client_name || '名称なし'}</span>
                                <span className="text-[11px] text-slate-400 flex-shrink-0 font-medium bg-slate-50 border border-slate-100 px-2.5 py-0.5 rounded-lg">
                                    {formatDate(record.created_at)}
                                </span>
                            </div>
                            <p className="text-[13px] text-slate-500 line-clamp-2 leading-[1.6]">{record.summary}</p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
