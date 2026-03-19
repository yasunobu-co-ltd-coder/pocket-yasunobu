'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, FileText, X, Save, User, Search, Trash2, Download, Plus, ArrowRightLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { generateMinutesPdf } from '@/lib/generate-pdf';
import TTSPlayer from './TTSPlayer';

type Filter = '全件' | '自分の作成';

interface HistoryListProps {
    userId: string;
    userName: string;
    refreshTrigger: number;
    initialSearch?: string;
    onDataChanged?: () => void;
}

interface MinutesRecord {
    id: number;
    created_at: string;
    client_name: string;
    summary: string;
    user_id: string;
    user?: { name: string } | null;
    transcript?: string;
    decisions?: string[];
    todos?: string[];
    next_schedule?: string;
    keywords?: string[];
}

export default function HistoryList({ userId, userName, refreshTrigger, initialSearch, onDataChanged }: HistoryListProps) {
    const [records, setRecords] = useState<MinutesRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('自分の作成');
    const [searchQuery, setSearchQuery] = useState(initialSearch || '');
    const [selectedRecord, setSelectedRecord] = useState<MinutesRecord | null>(null);

    // Edit state
    const [isEditing, setIsEditing] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editSummary, setEditSummary] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // 一括置換
    const [showReplace, setShowReplace] = useState(false);
    const [replaceRules, setReplaceRules] = useState<{ from: string; to: string }[]>([{ from: '', to: '' }]);

    useEffect(() => {
        const fetchRecords = async () => {
            setLoading(true);
            setError(null);
            try {
                const { data, error: fetchError } = await supabase
                    .from('pocket-yasunobu')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(50);
                if (fetchError) throw fetchError;

                // ユーザー名を別途取得してマッピング
                const userIds = [...new Set((data || []).map((r: MinutesRecord) => r.user_id).filter(Boolean))];
                let userMap: Record<string, string> = {};
                if (userIds.length > 0) {
                    const { data: usersData } = await supabase
                        .from('users')
                        .select('id, name')
                        .in('id', userIds);
                    if (usersData) {
                        userMap = Object.fromEntries(usersData.map((u: { id: string; name: string }) => [u.id, u.name]));
                    }
                }
                const recordsWithUser = (data || []).map((r: MinutesRecord) => ({
                    ...r,
                    user: r.user_id && userMap[r.user_id] ? { name: userMap[r.user_id] } : null,
                }));
                setRecords(recordsWithUser as MinutesRecord[]);
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
        let result = records;
        if (filter === '自分の作成') {
            result = result.filter(r => r.user_id === userId);
        }
        if (searchQuery.trim()) {
            const terms = searchQuery.trim().toLowerCase().split(/\s+/);
            result = result.filter(r => {
                const text = [
                    r.client_name,
                    r.summary,
                    r.transcript,
                    r.user?.name,
                    r.next_schedule,
                    ...(r.decisions || []),
                    ...(r.todos || []),
                    ...(r.keywords || []),
                ].filter(Boolean).join(' ').toLowerCase();
                return terms.every(t => text.includes(t));
            });
        }
        return result;
    }, [records, filter, userId, searchQuery]);

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
        setShowReplace(false);
        setReplaceRules([{ from: '', to: '' }]);
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setShowReplace(false);
    };

    const addReplaceRule = () => {
        setReplaceRules([...replaceRules, { from: '', to: '' }]);
    };

    const removeReplaceRule = (index: number) => {
        setReplaceRules(replaceRules.filter((_, i) => i !== index));
    };

    const updateReplaceRule = (index: number, field: 'from' | 'to', value: string) => {
        setReplaceRules(replaceRules.map((r, i) => i === index ? { ...r, [field]: value } : r));
    };

    const applyReplaceRules = () => {
        const validRules = replaceRules.filter(r => r.from.trim());
        if (validRules.length === 0) return;
        let text = editSummary;
        let totalCount = 0;
        for (const rule of validRules) {
            const count = text.split(rule.from).length - 1;
            totalCount += count;
            text = text.split(rule.from).join(rule.to);
        }
        if (totalCount === 0) {
            alert('該当する単語が見つかりませんでした');
            return;
        }
        setEditSummary(text);
        alert(`${totalCount}箇所を置換しました`);
    };

    const saveEdit = async () => {
        if (!selectedRecord) return;
        setIsSaving(true);
        try {
            const { error: updateError } = await supabase
                .from('pocket-yasunobu')
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
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-8">
                <p className="text-[14px] text-red-600 bg-red-50 rounded-xl py-4 px-5 border border-red-100 text-center">{error}</p>
            </div>
        );
    }

    if (records.length === 0) {
        return (
            <div className="text-center py-20">
                <div className="w-16 h-16 bg-slate-50 rounded-[16px] flex items-center justify-center mx-auto mb-4 border border-slate-100">
                    <FileText className="w-7 h-7 text-slate-300" />
                </div>
                <p className="text-slate-500 text-[16px] font-medium">まだ記録がありません</p>
                <p className="text-slate-300 text-[13px] mt-2">議事録を作成すると表示されます</p>
            </div>
        );
    }

    return (
        <>
            {/* Search bar */}
            <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                <label htmlFor="history-search" className="sr-only">検索</label>
                <input
                    id="history-search"
                    name="search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="検索（会議名・内容）"
                    autoComplete="off"
                    className="w-full bg-white border border-slate-200 rounded-[14px] pl-11 pr-4 py-4 text-[15px] text-slate-700 placeholder:text-slate-400 focus:border-violet-300 focus:shadow-[0_0_0_4px_rgba(124,58,237,0.08)] outline-none transition-all"
                />
            </div>

            {/* Filter buttons */}
            <div className="flex gap-3 mb-6">
                {(['全件', '自分の作成'] as Filter[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className="transition-all text-[14px] font-semibold px-6 py-3 rounded-full hover:shadow-[0_2px_8px_rgba(124,58,237,0.15)]"
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

            {/* Records - each as independent card */}
            <div className="space-y-4">
                {filtered.map((record) => (
                    <div key={record.id}
                        onClick={() => setSelectedRecord(record)}
                        className="bg-white rounded-[16px] border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(124,58,237,0.1)] hover:border-violet-200 transition-all duration-150 cursor-pointer active:scale-[0.99]">

                        {/* Card header */}
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[17px] font-bold text-slate-800 truncate flex-1 mr-3">{record.client_name || '名称なし'}</span>
                                <span className="text-[12px] text-slate-400 flex-shrink-0 font-medium bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">
                                    {formatDateShort(record.created_at)}
                                </span>
                            </div>
                            <p className="text-[14px] text-slate-500 line-clamp-2 leading-[1.8]">{record.summary}</p>
                        </div>

                        {/* Card footer */}
                        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                            <span className="flex items-center gap-2 text-[13px] text-slate-400">
                                <span className="w-[7px] h-[7px] rounded-full" style={{ background: record.user_id === userId ? '#7c3aed' : '#cbd5e1' }} />
                                {record.user?.name ?? '不明'}
                            </span>
                            <span className="text-[12px] text-slate-300">{formatTimestamp(record.created_at)}</span>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="text-center py-16">
                        <p className="text-slate-400 text-[14px]">該当する記録がありません</p>
                    </div>
                )}
            </div>

            {/* ===== Detail Modal ===== */}
            {selectedRecord && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
                    onClick={(e) => { if (e.target === e.currentTarget) { setSelectedRecord(null); setIsEditing(false); } }}>
                    <div className="bg-white rounded-[20px] w-full max-w-[440px] max-h-[80vh] overflow-y-auto shadow-xl">
                        {/* Header */}
                        <div className="sticky top-0 bg-white rounded-t-[20px] px-7 pt-7 pb-5 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-[20px] font-bold text-slate-800">議事録詳細</h2>
                            <button onClick={() => { setSelectedRecord(null); setIsEditing(false); }}
                                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        <div className="p-7 space-y-7">
                            {/* Timestamp */}
                            <div className="text-[13px] text-slate-400 font-medium">
                                作成: {formatTimestamp(selectedRecord.created_at)}
                            </div>

                            {isEditing ? (
                                /* ===== Edit Mode ===== */
                                <>
                                    <div>
                                        <label htmlFor="edit-client-name" className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-3">会議名</label>
                                        <input id="edit-client-name" name="client-name" type="text" value={editClientName} onChange={(e) => setEditClientName(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-[12px] px-5 py-4 text-[16px] text-slate-700 focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none transition-all" />
                                    </div>
                                    <div>
                                        <label htmlFor="edit-summary" className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-3">内容</label>
                                        <textarea id="edit-summary" name="summary" value={editSummary} onChange={(e) => setEditSummary(e.target.value)} rows={8}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-[12px] px-5 py-4 text-[15px] text-slate-700 leading-[1.7] focus:border-violet-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(124,58,237,0.1)] outline-none resize-none transition-all" />
                                    </div>

                                    {/* 一括置換 */}
                                    <div>
                                        <button onClick={() => setShowReplace(!showReplace)}
                                            className="flex items-center gap-2 text-[13px] font-bold text-amber-600 hover:text-amber-700 transition-colors">
                                            <ArrowRightLeft className="w-4 h-4" />
                                            一括置換 {showReplace ? '▲' : '▼'}
                                        </button>
                                        {showReplace && (
                                            <div className="mt-3 bg-amber-50 rounded-[12px] p-4 space-y-3">
                                                <p className="text-[12px] text-amber-600">指定した単語を一括で置き換えます</p>
                                                {replaceRules.map((rule, i) => (
                                                    <div key={i} className="bg-white border border-amber-200 rounded-[10px] p-3 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11px] font-bold text-amber-500 w-8 flex-shrink-0">前</span>
                                                            <input type="text" value={rule.from} onChange={(e) => updateReplaceRule(i, 'from', e.target.value)}
                                                                placeholder="置換前の単語"
                                                                className="flex-1 bg-amber-50 border border-amber-100 rounded-[6px] px-3 py-1.5 text-[13px] text-slate-700 focus:border-amber-400 outline-none" />
                                                            {replaceRules.length > 1 && (
                                                                <button onClick={() => removeReplaceRule(i)}
                                                                    className="w-7 h-7 rounded-full hover:bg-red-100 flex items-center justify-center transition-colors flex-shrink-0">
                                                                    <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11px] font-bold text-emerald-500 w-8 flex-shrink-0">後</span>
                                                            <input type="text" value={rule.to} onChange={(e) => updateReplaceRule(i, 'to', e.target.value)}
                                                                placeholder="置換後の単語"
                                                                className="flex-1 bg-emerald-50 border border-emerald-100 rounded-[6px] px-3 py-1.5 text-[13px] text-slate-700 focus:border-emerald-400 outline-none" />
                                                            {replaceRules.length > 1 && <div className="w-7 flex-shrink-0" />}
                                                        </div>
                                                    </div>
                                                ))}
                                                <div className="flex gap-2">
                                                    <button onClick={addReplaceRule}
                                                        className="flex-1 bg-white border border-amber-200 text-amber-600 font-bold py-2 rounded-[8px] text-[12px] hover:bg-amber-100 transition-colors flex items-center justify-center gap-1">
                                                        <Plus className="w-3.5 h-3.5" />
                                                        ルール追加
                                                    </button>
                                                    <button onClick={applyReplaceRules}
                                                        className="flex-1 bg-amber-500 text-white font-bold py-2 rounded-[8px] text-[12px] hover:bg-amber-600 transition-colors active:scale-[0.97]">
                                                        置換を適用
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-3 pt-2">
                                        <button onClick={cancelEdit}
                                            className="flex-1 bg-slate-100 text-slate-600 font-bold py-4 rounded-[14px] text-[15px] transition-colors hover:bg-slate-200">
                                            キャンセル
                                        </button>
                                        <button onClick={saveEdit} disabled={isSaving}
                                            className="flex-1 text-white font-bold py-4 rounded-[14px] text-[15px] transition-transform active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-50"
                                            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}>
                                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                            保存
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* ===== View Mode ===== */
                                <>
                                    {/* Client name */}
                                    <div>
                                        <span className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">会議名</span>
                                        <p className="text-[19px] font-bold text-slate-800">{selectedRecord.client_name || '名称なし'}</p>
                                    </div>

                                    {/* Creator */}
                                    <div className="flex items-center gap-2">
                                        <User className="w-4 h-4 text-slate-400" />
                                        <span className="text-[14px] text-slate-500">{selectedRecord.user?.name ?? '不明'}</span>
                                    </div>

                                    {/* Summary */}
                                    <div>
                                        <span className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-3">内容</span>
                                        <p className="text-[15px] text-slate-600 leading-[1.8] whitespace-pre-wrap">{selectedRecord.summary}</p>
                                    </div>

                                    {/* PDF / Edit / Delete buttons */}
                                    <div className="pt-2 space-y-3">
                                        <button
                                            onClick={() => generateMinutesPdf({
                                                meetingName: selectedRecord.client_name || '',
                                                createdAt: selectedRecord.created_at,
                                                creatorName: selectedRecord.user?.name,
                                                summary: selectedRecord.summary,
                                            })}
                                            className="w-full bg-violet-50 text-violet-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-violet-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
                                            <Download className="w-5 h-5" />
                                            PDFで出力
                                        </button>
                                        {/* TTS Player */}
                                        <TTSPlayer minuteId={selectedRecord.id} summaryText={selectedRecord.summary} />

                                        <button
                                            onClick={async () => {
                                                if (!confirm('この議事録をデータベースから完全に削除します。\n関連する音声データも削除されます。\nこの操作は取り消せません。\n\n本当に削除しますか？')) return;
                                                setIsDeleting(true);
                                                try {
                                                    const minuteId = selectedRecord.id;

                                                    // 1. 音声ジョブを取得
                                                    const { data: audioJobs } = await supabase
                                                        .from('minutes_audio')
                                                        .select('id')
                                                        .eq('minute_id', minuteId);

                                                    if (audioJobs && audioJobs.length > 0) {
                                                        const audioIds = audioJobs.map(a => a.id);

                                                        // 2. 音声チャンクレコードを削除
                                                        await supabase
                                                            .from('minutes_audio_chunks')
                                                            .delete()
                                                            .in('audio_id', audioIds);

                                                        // 3. 音声ジョブレコードを削除
                                                        await supabase
                                                            .from('minutes_audio')
                                                            .delete()
                                                            .eq('minute_id', minuteId);
                                                    }

                                                    // 4. Storageの音声ファイルを削除（audio_idサブフォルダ対応）
                                                    if (audioJobs && audioJobs.length > 0) {
                                                        for (const job of audioJobs) {
                                                            const prefix = `tts/${minuteId}/${job.id}`;
                                                            const { data: files } = await supabase.storage
                                                                .from('tts-audio')
                                                                .list(prefix);
                                                            if (files && files.length > 0) {
                                                                await supabase.storage
                                                                    .from('tts-audio')
                                                                    .remove(files.map(f => `${prefix}/${f.name}`));
                                                            }
                                                        }
                                                    }
                                                    // 旧パス（audio_idなし）のファイルも削除
                                                    const { data: legacyFiles } = await supabase.storage
                                                        .from('tts-audio')
                                                        .list(`tts/${minuteId}`);
                                                    if (legacyFiles && legacyFiles.length > 0) {
                                                        const filesToDelete = legacyFiles.filter(f => f.name.endsWith('.wav'));
                                                        if (filesToDelete.length > 0) {
                                                            await supabase.storage
                                                                .from('tts-audio')
                                                                .remove(filesToDelete.map(f => `tts/${minuteId}/${f.name}`));
                                                        }
                                                    }

                                                    // 5. 議事録レコードを削除
                                                    const { error: deleteError } = await supabase
                                                        .from('pocket-yasunobu')
                                                        .delete()
                                                        .eq('id', minuteId);
                                                    if (deleteError) throw deleteError;
                                                    setRecords(records.filter(r => r.id !== minuteId));
                                                    setSelectedRecord(null);
                                                    onDataChanged?.();
                                                } catch (e: unknown) {
                                                    console.error('Delete error:', e);
                                                    const msg = e instanceof Error ? e.message : '削除エラー';
                                                    alert('削除失敗: ' + msg);
                                                } finally {
                                                    setIsDeleting(false);
                                                }
                                            }}
                                            disabled={isDeleting}
                                            className="w-full bg-red-50 text-red-500 font-bold py-4 rounded-[14px] text-[15px] hover:bg-red-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-50 border border-red-100">
                                            {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                                            削除する
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
