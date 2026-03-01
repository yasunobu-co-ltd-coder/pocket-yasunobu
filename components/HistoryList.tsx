'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, FileText, X, Save, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Filter = '全件' | '自分の作成';

interface HistoryListProps {
    userId: string;
    userName: string;
    refreshTrigger: number;
}

interface MinutesRecord {
    id: number;
    created_at: string;
    client_name: string;
    summary: string;
    user_name: string;
    user_id: string;
    transcript?: string;
    decisions?: string[];
    todos?: string[];
    next_schedule?: string;
    keywords?: string[];
}

export default function HistoryList({ userId, userName, refreshTrigger }: HistoryListProps) {
    const [records, setRecords] = useState<MinutesRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('自分の作成');
    const [selectedRecord, setSelectedRecord] = useState<MinutesRecord | null>(null);

    // Edit state
    const [isEditing, setIsEditing] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editSummary, setEditSummary] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchRecords = async () => {
            setLoading(true);
            setError(null);
            try {
                const { data, error: fetchError } = await supabase
                    .from('pocket-matip')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(50);
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

    const filtered = useMemo(() => {
        if (filter === '自分の作成') {
            return records.filter(r => r.user_id === userId);
        }
        return records;
    }, [records, filter, userId]);

    const formatTimestamp = (dateStr: string) => {
        const d = new Date(dateStr);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${y}/${m}/${day} ${h}:${min}`;
    };

    const formatDateShort = (dateStr: string) => {
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

    const startEdit = (record: MinutesRecord) => {
        setIsEditing(true);
        setEditClientName(record.client_name || '');
        setEditSummary(record.summary || '');
    };

    const cancelEdit = () => {
        setIsEditing(false);
    };

    const saveEdit = async () => {
        if (!selectedRecord) return;
        setIsSaving(true);
        try {
            const { error: updateError } = await supabase
                .from('pocket-matip')
                .update({
                    client_name: editClientName,
                    summary: editSummary,
                })
                .eq('id', selectedRecord.id);

            if (updateError) throw updateError;

            setRecords(records.map(r =>
                r.id === selectedRecord.id
                    ? { ...r, client_name: editClientName, summary: editSummary }
                    : r
            ));
            setSelectedRecord({ ...selectedRecord, client_name: editClientName, summary: editSummary });
            setIsEditing(false);
        } catch (e: unknown) {
            console.error('Save error:', e);
            const msg = e instanceof Error ? e.message : '保存エラー';
            alert('保存失敗: ' + msg);
        } finally {
            setIsSaving(false);
        }
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
        <>
            {/* Filter buttons */}
            <div className="flex gap-2 px-2 pt-2 pb-3">
                {(['全件', '自分の作成'] as Filter[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className="transition-all text-[13px] font-semibold px-3.5 py-1.5 rounded-full"
                        style={{
                            background: filter === f ? '#7c3aed' : '#fff',
                            color: filter === f ? '#fff' : '#64748b',
                            border: filter === f ? 'none' : '1px solid #e2e8f0',
                        }}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {/* Records list */}
            <div>
                {filtered.map((record) => (
                    <div key={record.id}
                        onClick={() => setSelectedRecord(record)}
                        className="rounded-[16px] px-[18px] py-[18px] mb-1 border border-transparent hover:border-slate-100 hover:bg-slate-50/50 transition-all duration-150 cursor-pointer active:scale-[0.99]">
                        <div className="flex items-start gap-3.5">
                            <div className="w-10 h-10 rounded-[10px] bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5 border border-violet-100">
                                <FileText className="w-[18px] h-[18px] text-violet-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3 mb-1">
                                    <span className="text-[15px] font-bold text-slate-800 truncate">{record.client_name || '名称なし'}</span>
                                    <span className="text-[11px] text-slate-400 flex-shrink-0 font-medium bg-slate-50 border border-slate-100 px-2.5 py-0.5 rounded-lg">
                                        {formatDateShort(record.created_at)}
                                    </span>
                                </div>
                                <p className="text-[13px] text-slate-500 line-clamp-2 leading-[1.6]">{record.summary}</p>
                                {/* Creator & timestamp */}
                                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                                    <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                        <span className="w-[6px] h-[6px] rounded-full" style={{ background: record.user_id === userId ? '#7c3aed' : '#cbd5e1' }} />
                                        {record.user_name}
                                    </span>
                                    <span className="text-[11px] text-slate-300">{formatTimestamp(record.created_at)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="text-center py-10">
                        <p className="text-slate-400 text-[13px]">該当する記録がありません</p>
                    </div>
                )}
            </div>

            {/* ===== Detail Modal ===== */}
            {selectedRecord && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
                    onClick={(e) => { if (e.target === e.currentTarget) { setSelectedRecord(null); setIsEditing(false); } }}>
                    <div className="bg-white rounded-[20px] w-full max-w-[400px] max-h-[80vh] overflow-y-auto shadow-xl">
                        {/* Header */}
                        <div className="sticky top-0 bg-white rounded-t-[20px] px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-[18px] font-bold text-slate-800">議事録詳細</h2>
                            <button onClick={() => { setSelectedRecord(null); setIsEditing(false); }}
                                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            {/* Timestamp */}
                            <div className="text-[12px] text-slate-400 font-medium">
                                作成: {formatTimestamp(selectedRecord.created_at)}
                            </div>

                            {isEditing ? (
                                /* ===== Edit Mode ===== */
                                <>
                                    <div>
                                        <label className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">顧客名</label>
                                        <input type="text" value={editClientName} onChange={(e) => setEditClientName(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-[12px] px-4 py-3.5 text-[16px] text-slate-700 focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none transition-all" />
                                    </div>
                                    <div>
                                        <label className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">内容</label>
                                        <textarea value={editSummary} onChange={(e) => setEditSummary(e.target.value)} rows={8}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-[12px] px-4 py-3.5 text-[14px] text-slate-700 leading-[1.6] focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none resize-none transition-all" />
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={cancelEdit}
                                            className="flex-1 bg-slate-100 text-slate-600 font-semibold py-3.5 rounded-[12px] transition-colors hover:bg-slate-200">
                                            キャンセル
                                        </button>
                                        <button onClick={saveEdit} disabled={isSaving}
                                            className="flex-1 text-white font-semibold py-3.5 rounded-[12px] transition-transform active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-50"
                                            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}>
                                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                            保存
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* ===== View Mode ===== */
                                <>
                                    {/* Client name */}
                                    <div>
                                        <label className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-1">顧客名</label>
                                        <p className="text-[17px] font-bold text-slate-800">{selectedRecord.client_name || '名称なし'}</p>
                                    </div>

                                    {/* Creator */}
                                    <div className="flex items-center gap-2">
                                        <User className="w-3.5 h-3.5 text-slate-400" />
                                        <span className="text-[13px] text-slate-500">作成者: {selectedRecord.user_name}</span>
                                    </div>

                                    {/* Summary */}
                                    <div>
                                        <label className="block text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">内容</label>
                                        <p className="text-[14px] text-slate-600 leading-[1.6] whitespace-pre-wrap">{selectedRecord.summary}</p>
                                    </div>

                                    {/* Edit button */}
                                    <button onClick={() => startEdit(selectedRecord)}
                                        className="w-full bg-slate-100 text-slate-600 font-semibold py-3.5 rounded-[12px] text-[14px] hover:bg-slate-200 transition-colors">
                                        編集する
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
