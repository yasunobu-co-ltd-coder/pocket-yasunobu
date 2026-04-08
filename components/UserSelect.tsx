'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, User, RefreshCw, Mic, X, Plus, Trash2, Lock, GripVertical, AlertTriangle, Info, BookMarked, HelpCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const VALID_PIN = '0727';

export interface UserData {
    id: string;
    name: string;
    sort_order?: number;
    [key: string]: unknown;
}

interface UserSelectProps {
    onSelect: (user: UserData) => void;
}

interface RefCounts {
    pocket_yasunobu: number;
    memo_created: number;
    memo_assigned: number;
    memo_unread: number;
    push_subs: number;
    notif_triggered: number;
}

interface DeleteModalState {
    user: UserData;
    loading: boolean;
    error: string | null;
    counts: RefCounts | null;
    canDelete: boolean;
    deleting: boolean;
}

const REF_LABELS: { key: keyof RefCounts; label: string }[] = [
    { key: 'pocket_yasunobu', label: '議事録' },
    { key: 'memo_created', label: 'メモ（作成）' },
    { key: 'memo_assigned', label: 'メモ（担当）' },
    { key: 'memo_unread', label: '未読メモ' },
    { key: 'push_subs', label: '通知購読' },
    { key: 'notif_triggered', label: '通知ログ' },
];

/* ── Sortable user card ── */
function SortableUserCard({
    user,
    deleteMode,
    onSelect,
    onDelete,
}: {
    user: UserData;
    deleteMode: boolean;
    onSelect: (user: UserData) => void;
    onDelete: (user: UserData) => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: user.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : 'auto' as const,
    };

    return (
        <div ref={setNodeRef} style={style} className="relative">
            <button
                tabIndex={0}
                onClick={() => { if (!deleteMode) onSelect(user); }}
                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                className={`w-full rounded-[16px] py-5 px-4 flex items-center justify-center border transition-all duration-200 active:scale-[0.96] group ${
                    deleteMode
                        ? 'bg-red-50 border-red-200'
                        : 'bg-slate-50 hover:bg-violet-50 border-slate-200 hover:border-violet-300 hover:shadow-[0_4px_16px_rgba(124,58,237,0.12)]'
                }`}
            >
                {!deleteMode && (
                    <span
                        {...attributes}
                        {...listeners}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none"
                    >
                        <GripVertical className="w-4 h-4" />
                    </span>
                )}
                <span className={`text-[15px] font-bold ${deleteMode ? 'text-red-400' : 'text-slate-700 group-hover:text-violet-700'}`}>
                    {user.name}
                </span>
            </button>
            {deleteMode && (
                <button
                    onClick={() => onDelete(user)}
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors active:scale-90"
                >
                    <X className="w-4 h-4 text-white" />
                </button>
            )}
        </div>
    );
}

export default function UserSelect({ onSelect }: UserSelectProps) {
    const [isPinVerified, setIsPinVerified] = useState(false);
    const [pin, setPin] = useState('');
    const [pinError, setPinError] = useState('');
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newUserName, setNewUserName] = useState('');
    const [deleteMode, setDeleteMode] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [showCredits, setShowCredits] = useState(false);
    const [showRulebook, setShowRulebook] = useState(false);
    const [showHelp, setShowHelp] = useState(false);

    // Long-press: 250ms delay before drag starts
    const pointerSensor = useSensor(PointerSensor, {
        activationConstraint: { delay: 250, tolerance: 5 },
    });
    const touchSensor = useSensor(TouchSensor, {
        activationConstraint: { delay: 250, tolerance: 5 },
    });
    const sensors = useSensors(pointerSensor, touchSensor);

    useEffect(() => {
        const verified = sessionStorage.getItem('pocket_yasunobu_pin_verified');
        if (verified === 'true') setIsPinVerified(true);
    }, []);

    // PIN認証直後のゴーストクリック防止用タイムスタンプ
    const [pinVerifiedAt, setPinVerifiedAt] = useState(0);

    const handlePinSubmit = () => {
        if (pin === VALID_PIN) {
            setPinVerifiedAt(Date.now());
            setIsPinVerified(true);
            sessionStorage.setItem('pocket_yasunobu_pin_verified', 'true');
            setPinError('');
        } else {
            setPinError('PINコードが正しくありません');
        }
    };

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .from('users')
                .select('id,name,sort_order,created_at')
                .order('sort_order')
                .order('created_at');
            if (fetchError) throw fetchError;
            setUsers(data || []);
        } catch (e: unknown) {
            console.error('Fetch users error:', e);
            const msg = e instanceof Error ? e.message : 'ユーザー取得エラー';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const handleAddUser = async () => {
        const name = newUserName.trim();
        if (!name) return;
        if (users.some(u => u.name === name)) {
            alert('同じ名前のユーザーが既に存在します');
            return;
        }
        setIsAdding(true);
        try {
            const maxOrder = users.reduce((max, u) => Math.max(max, (u.sort_order ?? 0)), -1);
            const { data, error: insertError } = await supabase
                .from('users')
                .insert([{ name, sort_order: maxOrder + 1 }])
                .select('id,name,sort_order,created_at')
                .single();
            if (insertError) throw insertError;
            setUsers(prev => [...prev, data]);
            setNewUserName('');
        } catch (e: unknown) {
            console.error('Add user error:', e);
            const msg = e instanceof Error ? e.message : 'ユーザー追加エラー';
            alert('追加失敗: ' + msg);
        } finally {
            setIsAdding(false);
        }
    };

    const handleDeleteUser = async (user: UserData) => {
        if (users.length <= 1) {
            alert('最低1人のユーザーが必要です');
            return;
        }

        // Open modal and fetch ref counts
        setDeleteModal({ user, loading: true, error: null, counts: null, canDelete: false, deleting: false });

        try {
            const res = await fetch(`/api/users/${user.id}/refs`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setDeleteModal(prev => prev ? {
                ...prev,
                loading: false,
                counts: data.counts,
                canDelete: data.canDelete,
            } : null);
        } catch (e: unknown) {
            console.error('Refs check error:', e);
            const msg = e instanceof Error ? e.message : '参照件数の取得に失敗しました';
            setDeleteModal(prev => prev ? { ...prev, loading: false, error: msg } : null);
        }
    };

    const executeDelete = async () => {
        if (!deleteModal) return;
        setDeleteModal(prev => prev ? { ...prev, deleting: true } : null);
        try {
            const { error: deleteError } = await supabase
                .from('users')
                .delete()
                .eq('id', deleteModal.user.id);
            if (deleteError) throw deleteError;
            setUsers(prev => prev.filter(u => u.id !== deleteModal.user.id));
            setDeleteModal(null);
        } catch (e: unknown) {
            console.error('Delete user error:', e);
            const msg = e instanceof Error ? e.message : 'ユーザー削除エラー';
            setDeleteModal(prev => prev ? { ...prev, deleting: false, error: msg } : null);
        }
    };

    const handleDragStart = () => {
        setIsDragging(true);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        setTimeout(() => setIsDragging(false), 300);

        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = users.findIndex(u => u.id === active.id);
        const newIndex = users.findIndex(u => u.id === over.id);
        const reordered = arrayMove(users, oldIndex, newIndex);

        // Optimistic update
        setUsers(reordered);

        // Persist new order via API
        await fetch('/api/users/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orders: reordered.map((u, i) => ({ id: u.id, sort_order: i })),
            }),
        });
    };

    const handleSafeSelect = (user: UserData) => {
        if (isDragging) return;
        if (pinVerifiedAt > 0 && Date.now() - pinVerifiedAt < 800) return;
        onSelect(user);
    };

    if (!isPinVerified) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center px-8 py-20"
                style={{ background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' }}>
                <div className="mb-12 text-center animate-fade-in-up">
                    <div className="w-20 h-20 bg-gradient-to-br from-violet-600 to-violet-800 rounded-[22px] flex items-center justify-center mx-auto mb-6 shadow-[0_8px_20px_rgba(124,58,237,0.35)]">
                        <Lock className="w-9 h-9 text-white" />
                    </div>
                    <h1 className="font-extrabold text-[26px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px] mb-2">
                        pocket-yasunobu
                    </h1>
                    <p className="text-slate-400 text-[13px]">PINコードを入力してください</p>
                </div>
                <div className="w-full max-w-[360px] bg-white/90 backdrop-blur-[10px] rounded-[24px] p-8 shadow-[0_20px_40px_-10px_rgba(124,58,237,0.15)] border border-white/60 flex flex-col items-center gap-5">
                    <label htmlFor="pin-input" className="sr-only">PINコード</label>
                    <input
                        id="pin-input"
                        name="pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={pin}
                        onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePinSubmit(); } }}
                        placeholder="____"
                        autoComplete="off"
                        className="bg-white border border-slate-200 rounded-[16px] px-6 py-5 text-[28px] font-bold text-slate-700 text-center tracking-[12px] w-[180px] focus:border-violet-300 focus:shadow-[0_0_0_4px_rgba(124,58,237,0.08)] outline-none transition-all"
                    />
                    {pinError && <p className="text-red-500 text-[13px]">{pinError}</p>}
                    <button
                        onClick={handlePinSubmit}
                        disabled={pin.length !== 4}
                        className="bg-violet-600 text-white rounded-[16px] px-8 py-4 font-bold text-[15px] hover:bg-violet-700 transition-colors active:scale-95 disabled:opacity-50 w-[180px]"
                    >
                        確認
                    </button>
                </div>
                <p className="mt-6 text-slate-300 text-[11px] select-all">
                    v0.1.0 / {process.env.NEXT_PUBLIC_GIT_HASH || 'dev'}
                </p>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-8 py-20"
            style={{ background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' }}>

            {/* Brand */}
            <div className="mb-12 text-center animate-fade-in-up">
                <div className="w-20 h-20 bg-gradient-to-br from-violet-600 to-violet-800 rounded-[22px] flex items-center justify-center mx-auto mb-6 shadow-[0_8px_20px_rgba(124,58,237,0.35)]">
                    <Mic className="w-9 h-9 text-white" />
                </div>
                <h1 className="font-extrabold text-[26px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px] mb-1">
                    pocket-yasunobu
                </h1>
                <p className="text-[11px] text-slate-300 font-mono select-all mb-1">v0.1.0 / {process.env.NEXT_PUBLIC_GIT_HASH || 'dev'}</p>
                <p className="text-slate-400 text-[13px]">AI議事録アシスタント</p>
            </div>

            {/* Card */}
            <div className="w-full max-w-[360px] bg-white/90 backdrop-blur-[10px] rounded-[24px] p-8 shadow-[0_20px_40px_-10px_rgba(124,58,237,0.15)] border border-white/60">

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
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setIsDragging(false)}>
                        <SortableContext items={users.map(u => u.id)} strategy={rectSortingStrategy}>
                            <div className="grid grid-cols-2 gap-4">
                                {users.map((user) => (
                                    <SortableUserCard
                                        key={user.id}
                                        user={user}
                                        deleteMode={deleteMode}
                                        onSelect={handleSafeSelect}
                                        onDelete={handleDeleteUser}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}

                {/* Add user form */}
                {!loading && !error && !deleteMode && (
                    <div className="mt-6 flex flex-col gap-3">
                        <label htmlFor="new-user-name" className="sr-only">新しいユーザー名</label>
                        <input
                            id="new-user-name"
                            name="new-user-name"
                            type="text"
                            value={newUserName}
                            onChange={(e) => setNewUserName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddUser(); }}
                            placeholder="新しいユーザー名"
                            autoComplete="off"
                            className="w-full bg-white border border-slate-200 rounded-[16px] px-5 py-4 text-[15px] text-slate-700 placeholder:text-slate-400 focus:border-violet-300 focus:shadow-[0_0_0_4px_rgba(124,58,237,0.08)] outline-none transition-all"
                        />
                        <button
                            onClick={handleAddUser}
                            disabled={isAdding || !newUserName.trim()}
                            className="w-full bg-violet-600 text-white rounded-[16px] px-4 py-4 font-bold text-[15px] hover:bg-violet-700 transition-colors active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            追加
                        </button>
                    </div>
                )}

                {/* Delete mode toggle */}
                {!loading && !error && users.length > 0 && (
                    <button
                        onClick={() => setDeleteMode(!deleteMode)}
                        className={`mt-4 w-full py-3 rounded-[12px] text-[13px] font-semibold transition-all active:scale-[0.97] flex items-center justify-center gap-2 ${
                            deleteMode
                                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                : 'bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-500'
                        }`}
                    >
                        {deleteMode ? (
                            <>完了</>
                        ) : (
                            <><Trash2 className="w-4 h-4" />ユーザーを削除</>
                        )}
                    </button>
                )}
            </div>

            {/* Footer buttons */}
            <div className="mt-4 flex items-center justify-center gap-4">
                <button
                    onClick={() => setShowRulebook(true)}
                    className="text-[11px] text-slate-300 hover:text-slate-500 transition-colors flex items-center gap-1"
                >
                    <BookMarked className="w-3 h-3" />
                    ルルブ
                </button>
                <span className="text-slate-200">|</span>
                <button
                    onClick={() => setShowHelp(true)}
                    className="text-[11px] text-slate-300 hover:text-slate-500 transition-colors flex items-center gap-1"
                >
                    <HelpCircle className="w-3 h-3" />
                    ヘルプ
                </button>
                <span className="text-slate-200">|</span>
                <button
                    onClick={() => setShowCredits(true)}
                    className="text-[11px] text-slate-300 hover:text-slate-500 transition-colors flex items-center gap-1"
                >
                    <Info className="w-3 h-3" />
                    クレジット
                </button>
            </div>

            {/* ===== Credits overlay ===== */}
            {showCredits && (
                <div
                    className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowCredits(false); }}
                >
                    <div className="bg-white rounded-[20px] w-full max-w-[400px] max-h-[80vh] overflow-y-auto shadow-xl">
                        <div className="px-7 pt-7 pb-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-[17px] font-bold text-slate-800">クレジット</h2>
                            <button
                                onClick={() => setShowCredits(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
                            >
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-7 space-y-6">
                            <div>
                                <h3 className="text-[14px] font-bold text-slate-700 mb-3">音声読み上げ</h3>
                                <p className="text-[12px] text-slate-500 mb-4">
                                    本アプリの音声読み上げ機能は VOICEVOX を使用しています。
                                </p>
                                <div className="space-y-3">
                                    {[
                                        { name: '四国めたん', url: 'https://voicevox.hiroshiba.jp/' },
                                    ].map(v => (
                                        <div key={v.name} className="flex items-center justify-between bg-slate-50 rounded-[10px] px-4 py-3">
                                            <span className="text-[13px] font-bold text-slate-700">{v.name}</span>
                                            <span className="text-[11px] text-slate-400">VOICEVOX</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="bg-violet-50 rounded-[12px] p-4">
                                <p className="text-[12px] text-violet-600 leading-[1.7]">
                                    VOICEVOX: ヒホ（ヒロシバ）
                                    <br />
                                    <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer"
                                        className="underline hover:text-violet-800">https://voicevox.hiroshiba.jp/</a>
                                </p>
                            </div>
                            <div>
                                <h3 className="text-[14px] font-bold text-slate-700 mb-3">その他</h3>
                                <div className="space-y-2 text-[12px] text-slate-500 leading-[1.7]">
                                    <p>音声認識: OpenAI Whisper</p>
                                    <p>議事録生成: OpenAI GPT-4o</p>
                                    <p>データベース: Supabase</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== Rulebook overlay ===== */}
            {showRulebook && (
                <div
                    className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowRulebook(false); }}
                >
                    <div className="bg-white rounded-[20px] w-full max-w-[400px] max-h-[80vh] overflow-y-auto shadow-xl">
                        <div className="px-7 pt-7 pb-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-[17px] font-bold text-slate-800 flex items-center gap-2">
                                <BookMarked className="w-5 h-5 text-violet-500" />
                                ルルブ
                            </h2>
                            <button
                                onClick={() => setShowRulebook(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
                            >
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-7 space-y-6">
                            {/* ── 最重要: 顧客名の入力ルール ── */}
                            <div className="bg-red-50 border-2 border-red-500 rounded-[12px] p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                    <span className="bg-red-500 text-white text-[11px] font-extrabold px-2.5 py-0.5 rounded-full">最重要</span>
                                    <span className="text-[15px] font-extrabold text-red-600">顧客名の入力ルール</span>
                                </div>
                                <p className="text-[13px] text-slate-800 leading-[1.8]">
                                    議事録名は、必ず<span className="font-bold">顧客名を先頭</span>に書き、
                                    スペースまたはスラッシュ（/）で区切ってから会議内容や日時を入力してください。
                                </p>
                                <div className="bg-white rounded-[8px] px-4 py-3 text-[13px] text-slate-700 leading-[1.8]">
                                    <p className="text-[12px] font-bold text-slate-500 mb-1">入力例</p>
                                    <p className="text-green-600">○ <span className="font-bold">ABC商事 月次定例会</span></p>
                                    <p className="text-green-600">○ <span className="font-bold">田中建設/現場打合せ 3月</span></p>
                                    <p className="text-green-600">○ <span className="font-bold">社内 営業戦略MTG</span></p>
                                    <p className="text-green-600">○ <span className="font-bold">C工業 見積もり依頼</span></p>
                                    <div className="border-t border-slate-100 mt-2 pt-2 space-y-0.5">
                                        <p className="text-red-500">× 月次定例会（ABC商事）← 顧客名が先頭にない</p>
                                        <p className="text-red-500">× 現場打合せメモ ← 顧客名がない</p>
                                        <p className="text-red-500">× ABC商事 ← 会議内容がない</p>
                                        <p className="text-red-500">× 打合せについてABC商事と確認 ← 顧客名が埋もれている</p>
                                        <p className="text-red-500">× テスト ← 仮名で保存しない</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-[8px] border border-slate-200 px-4 py-3 space-y-1.5">
                                    <p className="text-[12px] text-slate-500 font-bold">ルール詳細:</p>
                                    <ul className="text-[12px] text-slate-600 leading-[1.8] space-y-0.5 list-none">
                                        <li>・顧客名は<span className="font-bold text-slate-800">社内で統一された表記</span>を使用すること</li>
                                        <li>・顧客名の後に<span className="font-bold text-slate-800">スペースまたは /</span> で区切る</li>
                                        <li>・区切りの後に会議の内容・日時などを記載する</li>
                                    </ul>
                                </div>
                                <p className="text-[12px] text-red-600 font-bold leading-[1.6]">
                                    ※ ナレッジデータベースで顧客別に議事録を集約するため、このルールは必ず守ってください。
                                </p>
                            </div>

                            {/* ── 重要: 担当者の確認 ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">重要</span>
                                    <h3 className="text-[14px] font-bold text-slate-700">担当者の確認</h3>
                                </div>
                                <div className="bg-amber-50 border border-amber-200 rounded-[12px] p-4">
                                    <p className="text-[13px] text-amber-700 leading-[1.7]">
                                        録音を開始する前に、<span className="font-bold">自分の名前で選択されているか</span>必ず確認してください。
                                        別の担当者の名前のまま保存すると、その人の議事録一覧に紛れ込みます。
                                        共有端末を使用している場合は特に注意してください。
                                    </p>
                                </div>
                            </div>

                            {/* ── 重要: 録音のバックアップ ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">重要</span>
                                    <h3 className="text-[14px] font-bold text-slate-700">録音のバックアップ</h3>
                                </div>
                                <div className="bg-amber-50 border border-amber-200 rounded-[12px] p-4 space-y-2">
                                    <p className="text-[13px] text-amber-700 leading-[1.7]">
                                        ブラウザでの録音は、端末のスリープ・通知・他アプリへの切り替え・通信状況など
                                        様々な要因で<span className="font-bold">途中で途切れる可能性</span>があります。
                                        特に長時間の会議では注意が必要です。
                                    </p>
                                    <p className="text-[13px] text-amber-700 leading-[1.7] font-bold">
                                        必ずボイスレコーダー等で別途バックアップ録音を取ってください。
                                    </p>
                                    <p className="text-[12px] text-amber-600 leading-[1.6]">
                                        万が一録音が切れた場合でも、音声ファイルを後からアップロードして議事録を生成できます。
                                        バックアップの有無は自己責任となります。
                                    </p>
                                </div>
                            </div>

                            {/* ── 音声生成 ── */}
                            <div>
                                <h3 className="text-[14px] font-bold text-slate-700 mb-3">音声生成について</h3>
                                <div className="bg-slate-50 rounded-[12px] p-4">
                                    <p className="text-[13px] text-slate-600 leading-[1.7]">
                                        議事録を保存すると、読み上げ音声の生成が自動で開始されます。
                                        生成中（「生成中...」表示）は議事録の編集を控えてください。
                                        内容を変更すると音声との整合性がなくなります。
                                    </p>
                                </div>
                            </div>

                            {/* ── 用語辞書 ── */}
                            <div>
                                <h3 className="text-[14px] font-bold text-slate-700 mb-3">用語辞書</h3>
                                <div className="bg-slate-50 rounded-[12px] p-4">
                                    <p className="text-[13px] text-slate-600 leading-[1.7]">
                                        よく使う顧客名・商品名・専門用語などをあらかじめ登録しておくリストです。
                                        ヘッダーの <span className="inline-flex items-center"><BookMarked className="w-3 h-3 mx-0.5" /></span> アイコンから開けます。
                                        文字起こし後に不自然な表記があれば、辞書を参照して正しい表記に書き換えてください。
                                    </p>
                                </div>
                            </div>

                            {/* ── キャラクターボイス ── */}
                            <div>
                                <h3 className="text-[14px] font-bold text-slate-700 mb-3">キャラクターボイス</h3>
                                <div className="bg-slate-50 rounded-[12px] p-4">
                                    <p className="text-[13px] text-slate-600 leading-[1.7]">
                                        読み上げ音声は4種類のキャラクターから選べます。
                                        再生画面の「キャラクターを変更」から切り替えてください。
                                        初回選択時は音声が生成されるまで少し時間がかかります。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== Help overlay ===== */}
            {showHelp && (
                <div
                    className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}
                >
                    <div className="bg-white rounded-[20px] w-full max-w-[400px] max-h-[80vh] overflow-y-auto shadow-xl">
                        <div className="px-7 pt-7 pb-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-[17px] font-bold text-slate-800 flex items-center gap-2">
                                <HelpCircle className="w-5 h-5 text-violet-500" />
                                ヘルプ
                            </h2>
                            <button
                                onClick={() => setShowHelp(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
                            >
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-7 space-y-5">
                            {[
                                {
                                    q: '録音が途中で止まる',
                                    a: 'ブラウザのマイク許可を確認してください。また、画面をロックしたり他のアプリに切り替えると録音が中断されることがあります。録音中は画面を開いたままにしてください。',
                                },
                                {
                                    q: '議事録の内容がおかしい',
                                    a: '音声が小さい・雑音が多いと認識精度が下がります。マイクに近い位置で録音してください。また、用語辞書に固有名詞を登録しておくと、誤変換が減ります。',
                                },
                                {
                                    q: '音声が再生できない',
                                    a: '音声は保存後にサーバーで自動生成されます。「生成中...」の表示が消えるまでお待ちください。長い議事録は数分かかることがあります。',
                                },
                                {
                                    q: 'キャラクターを変えたら「生成中」になった',
                                    a: '初めて選んだキャラクターの音声はその場で生成されます。しばらくお待ちください。一度生成された音声はキャッシュされるので、次回からは即再生できます。',
                                },
                                {
                                    q: '議事録を編集したら音声はどうなる？',
                                    a: '編集後の内容で新しい音声が自動生成されます。編集前の音声は古いテキストに紐づいているため、新しい音声の生成が完了するまでお待ちください。',
                                },
                                {
                                    q: 'PDFに出力したい',
                                    a: '議事録の詳細画面を開き、「PDFで出力」ボタンを押してください。ブラウザのダウンロードフォルダに保存されます。',
                                },
                                {
                                    q: '担当者を並び替えたい',
                                    a: 'ユーザー選択画面で、名前の左にあるグリップ（⋮⋮）を長押ししてドラッグすると並び替えられます。',
                                },
                                {
                                    q: 'スマホのホーム画面に追加したい',
                                    a: 'ブラウザの共有メニュー（iOS: Safari の共有ボタン → ホーム画面に追加 / Android: Chrome のメニュー → ホーム画面に追加）から追加できます。',
                                },
                            ].map((item, i) => (
                                <div key={i} className="bg-slate-50 rounded-[12px] overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-100">
                                        <p className="text-[13px] font-bold text-slate-700">Q. {item.q}</p>
                                    </div>
                                    <div className="px-4 py-3">
                                        <p className="text-[12px] text-slate-600 leading-[1.7]">A. {item.a}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ===== Delete confirmation modal ===== */}
            {deleteModal && (
                <div
                    className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
                    onClick={(e) => { if (e.target === e.currentTarget && !deleteModal.deleting) setDeleteModal(null); }}
                >
                    <div className="bg-white rounded-[20px] w-full max-w-[380px] shadow-xl">
                        {/* Header */}
                        <div className="px-7 pt-7 pb-5 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-[17px] font-bold text-slate-800">ユーザー削除</h2>
                            <button
                                onClick={() => { if (!deleteModal.deleting) setDeleteModal(null); }}
                                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
                            >
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>

                        <div className="p-7">
                            {/* User name */}
                            <div className="flex items-center gap-2 mb-5">
                                <User className="w-5 h-5 text-slate-400" />
                                <span className="text-[16px] font-bold text-slate-800">{deleteModal.user.name}</span>
                            </div>

                            {/* Loading state */}
                            {deleteModal.loading && (
                                <div className="flex flex-col items-center py-8 gap-3">
                                    <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                                    <p className="text-[13px] text-slate-400">参照データを確認中...</p>
                                </div>
                            )}

                            {/* Error state */}
                            {deleteModal.error && (
                                <div className="bg-red-50 border border-red-100 rounded-2xl p-5 text-center">
                                    <p className="text-[13px] text-red-600">{deleteModal.error}</p>
                                </div>
                            )}

                            {/* Counts table */}
                            {deleteModal.counts && (
                                <>
                                    <div className="bg-slate-50 rounded-[14px] border border-slate-200 overflow-hidden mb-5">
                                        {REF_LABELS.map(({ key, label }) => {
                                            const count = deleteModal.counts![key];
                                            return (
                                                <div key={key} className="flex items-center justify-between px-5 py-3 border-b border-slate-100 last:border-b-0">
                                                    <span className="text-[14px] text-slate-600">{label}</span>
                                                    <span className={`text-[14px] font-bold ${count > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                                        {count} 件
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {!deleteModal.canDelete ? (
                                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-3">
                                            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                                            <p className="text-[13px] text-amber-700 leading-[1.6]">
                                                関連データが残っているため削除できません。先にデータを削除・移行してください。
                                            </p>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={executeDelete}
                                            disabled={deleteModal.deleting}
                                            className="w-full bg-red-500 text-white rounded-[14px] py-4 font-bold text-[15px] hover:bg-red-600 transition-colors active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {deleteModal.deleting ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" />削除中...</>
                                            ) : (
                                                <><Trash2 className="w-4 h-4" />削除する</>
                                            )}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
