'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, User, RefreshCw, Mic, X, Plus, Trash2, Lock, GripVertical, AlertTriangle } from 'lucide-react';
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
                onClick={() => { if (!deleteMode) onSelect(user); }}
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

    const handlePinSubmit = () => {
        if (pin === VALID_PIN) {
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

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = users.findIndex(u => u.id === active.id);
        const newIndex = users.findIndex(u => u.id === over.id);
        const reordered = arrayMove(users, oldIndex, newIndex);

        // Optimistic update
        setUsers(reordered);

        // Persist new order to Supabase
        const updates = reordered.map((u, i) =>
            supabase.from('users').update({ sort_order: i }).eq('id', u.id)
        );
        await Promise.all(updates);
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
                        Pocket Yasunobu
                    </h1>
                    <p className="text-slate-400 text-[13px]">PINコードを入力してください</p>
                </div>
                <div className="w-full max-w-[360px] bg-white/90 backdrop-blur-[10px] rounded-[24px] p-8 shadow-[0_20px_40px_-10px_rgba(124,58,237,0.15)] border border-white/60 flex flex-col items-center gap-5">
                    <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={pin}
                        onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        onKeyDown={e => { if (e.key === 'Enter') handlePinSubmit(); }}
                        placeholder="____"
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
                <div className="flex items-center justify-center gap-3 mb-2">
                    <h1 className="font-extrabold text-[26px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px]">
                        Pocket Yasunobu
                    </h1>
                    <span className="text-[11px] text-slate-400 font-mono">v1.12.5</span>
                </div>
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
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={users.map(u => u.id)} strategy={rectSortingStrategy}>
                            <div className="grid grid-cols-2 gap-4">
                                {users.map((user) => (
                                    <SortableUserCard
                                        key={user.id}
                                        user={user}
                                        deleteMode={deleteMode}
                                        onSelect={onSelect}
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
                        <input
                            type="text"
                            value={newUserName}
                            onChange={(e) => setNewUserName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddUser(); }}
                            placeholder="新しいユーザー名"
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
