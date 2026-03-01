'use client';

import { useState, useEffect } from 'react';
import { Loader2, User, RefreshCw, Mic, X, Plus, Trash2, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const VALID_PIN = '8004';

export interface UserData {
    id: string;
    name: string;
    [key: string]: unknown;
}

interface UserSelectProps {
    onSelect: (user: UserData) => void;
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

    useEffect(() => {
        const verified = sessionStorage.getItem('pocket_matip_pin_verified');
        if (verified === 'true') setIsPinVerified(true);
    }, []);

    const handlePinSubmit = () => {
        if (pin === VALID_PIN) {
            setIsPinVerified(true);
            sessionStorage.setItem('pocket_matip_pin_verified', 'true');
            setPinError('');
        } else {
            setPinError('PINコードが正しくありません');
        }
    };

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

    const handleAddUser = async () => {
        const name = newUserName.trim();
        if (!name) return;
        if (users.some(u => u.name === name)) {
            alert('同じ名前のユーザーが既に存在します');
            return;
        }
        setIsAdding(true);
        try {
            const { data, error: insertError } = await supabase
                .from('user')
                .insert([{ name }])
                .select()
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
        // Check all related tables for user data
        const tables = [
            { name: 'pocket-matip', column: 'user_id', value: user.id, label: 'Pocket Matip議事録' },
            { name: 'matip-memo', column: 'created_by', value: user.name, label: 'Matip Memo' },
            { name: 'matip-memo-unread', column: 'user_name', value: user.name, label: 'Matip Memo未読' },
        ];
        for (const table of tables) {
            const { count } = await supabase
                .from(table.name)
                .select('*', { count: 'exact', head: true })
                .eq(table.column, table.value);
            if (count && count > 0) {
                alert(`${user.name} さんには ${table.label} に ${count} 件のデータがあるため削除できません`);
                return;
            }
        }
        if (!confirm(`${user.name} さんを削除しますか？`)) return;
        try {
            const { error: deleteError } = await supabase
                .from('user')
                .delete()
                .eq('id', user.id);
            if (deleteError) throw deleteError;
            setUsers(prev => prev.filter(u => u.id !== user.id));
        } catch (e: unknown) {
            console.error('Delete user error:', e);
            const msg = e instanceof Error ? e.message : 'ユーザー削除エラー';
            alert('削除失敗: ' + msg);
        }
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
                        Pocket Matip
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
                        Pocket Matip
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
                    <div className="grid grid-cols-2 gap-4">
                        {users.map((user) => (
                            <div key={user.id} className="relative">
                                <button
                                    onClick={() => { if (!deleteMode) onSelect(user); }}
                                    className={`w-full rounded-[16px] py-5 px-4 flex items-center justify-center border transition-all duration-200 active:scale-[0.96] group ${
                                        deleteMode
                                            ? 'bg-red-50 border-red-200'
                                            : 'bg-slate-50 hover:bg-violet-50 border-slate-200 hover:border-violet-300 hover:shadow-[0_4px_16px_rgba(124,58,237,0.12)]'
                                    }`}
                                >
                                    <span className={`text-[15px] font-bold ${deleteMode ? 'text-red-400' : 'text-slate-700 group-hover:text-violet-700'}`}>
                                        {user.name}
                                    </span>
                                </button>
                                {deleteMode && (
                                    <button
                                        onClick={() => handleDeleteUser(user)}
                                        className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors active:scale-90"
                                    >
                                        <X className="w-4 h-4 text-white" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
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

        </div>
    );
}
