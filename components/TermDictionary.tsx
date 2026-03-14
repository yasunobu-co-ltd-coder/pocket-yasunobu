'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Loader2, BookOpen } from 'lucide-react';

interface Term {
    id: string;
    user_id: string;
    customer: string;
    wrong_term: string;
    correct_term: string;
}

interface TermDictionaryProps {
    userId: string;
    isOpen: boolean;
    onClose: () => void;
}

export default function TermDictionary({ userId, isOpen, onClose }: TermDictionaryProps) {
    const [terms, setTerms] = useState<Term[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // 新規入力
    const [newCustomer, setNewCustomer] = useState('');
    const [newWrong, setNewWrong] = useState('');
    const [newCorrect, setNewCorrect] = useState('');

    // 顧客フィルター
    const [filterCustomer, setFilterCustomer] = useState('__all__');

    const fetchTerms = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/term-dictionary?user_id=${encodeURIComponent(userId)}`);
            const data = await res.json();
            setTerms(data.terms || []);
        } catch (e) {
            console.error('辞書取得エラー:', e);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (isOpen) fetchTerms();
    }, [isOpen, fetchTerms]);

    // ユニークな顧客リスト
    const customers = Array.from(new Set(terms.map(t => t.customer))).sort();

    // フィルター適用
    const filteredTerms = filterCustomer === '__all__'
        ? terms
        : terms.filter(t => t.customer === filterCustomer);

    const handleAdd = async () => {
        if (!newWrong.trim() || !newCorrect.trim()) {
            alert('誤表記と正しい表記を入力してください');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/term-dictionary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    customer: newCustomer.trim(),
                    wrong_term: newWrong.trim(),
                    correct_term: newCorrect.trim(),
                }),
            });
            if (!res.ok) throw new Error('登録失敗');
            setNewWrong('');
            setNewCorrect('');
            await fetchTerms();
        } catch (e) {
            console.error(e);
            alert('登録に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('この用語を削除しますか？')) return;
        try {
            await fetch(`/api/term-dictionary?id=${id}`, { method: 'DELETE' });
            setTerms(terms.filter(t => t.id !== id));
        } catch (e) {
            console.error(e);
            alert('削除に失敗しました');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-white rounded-[20px] w-full max-w-[480px] max-h-[85vh] overflow-hidden shadow-xl flex flex-col">

                {/* Header */}
                <div className="sticky top-0 bg-white rounded-t-[20px] px-7 pt-7 pb-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-violet-600" />
                        <h2 className="text-[20px] font-bold text-slate-800">用語辞書</h2>
                    </div>
                    <button onClick={onClose}
                        className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-7 space-y-6">

                    {/* 説明 */}
                    <p className="text-[13px] text-slate-500 leading-[1.6]">
                        音声認識で間違いやすい固有名詞を登録すると、議事録生成時に自動で正しい表記に補正します。
                        顧客名を指定すると、その顧客の会議でのみ適用されます。
                    </p>

                    {/* 新規登録 */}
                    <div className="bg-violet-50 rounded-[14px] p-5 space-y-3">
                        <h3 className="text-[14px] font-bold text-violet-700">新規登録</h3>
                        <div>
                            <label htmlFor="dict-customer" className="block text-[12px] font-semibold text-slate-500 mb-1">顧客名（空欄=全顧客共通）</label>
                            <input id="dict-customer" type="text" value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)}
                                placeholder="例: A社"
                                className="w-full bg-white border border-slate-200 rounded-[10px] px-4 py-3 text-[14px] text-slate-700 focus:border-violet-400 outline-none" />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label htmlFor="dict-wrong" className="block text-[12px] font-semibold text-slate-500 mb-1">誤表記</label>
                                <input id="dict-wrong" type="text" value={newWrong} onChange={(e) => setNewWrong(e.target.value)}
                                    placeholder="例: たなか"
                                    className="w-full bg-white border border-slate-200 rounded-[10px] px-4 py-3 text-[14px] text-slate-700 focus:border-violet-400 outline-none" />
                            </div>
                            <div className="flex items-end pb-3 text-slate-400 font-bold">→</div>
                            <div className="flex-1">
                                <label htmlFor="dict-correct" className="block text-[12px] font-semibold text-slate-500 mb-1">正しい表記</label>
                                <input id="dict-correct" type="text" value={newCorrect} onChange={(e) => setNewCorrect(e.target.value)}
                                    placeholder="例: 田中部長"
                                    className="w-full bg-white border border-slate-200 rounded-[10px] px-4 py-3 text-[14px] text-slate-700 focus:border-violet-400 outline-none" />
                            </div>
                        </div>
                        <button onClick={handleAdd} disabled={saving}
                            className="w-full bg-violet-600 text-white font-bold py-3 rounded-[10px] text-[14px] hover:bg-violet-700 transition-colors active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-50">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            登録
                        </button>
                    </div>

                    {/* フィルター */}
                    {customers.length > 0 && (
                        <div>
                            <label htmlFor="dict-filter" className="block text-[12px] font-semibold text-slate-500 mb-1">顧客で絞り込み</label>
                            <select id="dict-filter" value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}
                                className="w-full bg-white border border-slate-200 rounded-[10px] px-4 py-3 text-[14px] text-slate-700 focus:border-violet-400 outline-none">
                                <option value="__all__">すべて</option>
                                {customers.map(c => (
                                    <option key={c} value={c}>{c || '（全顧客共通）'}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* 登録済み一覧 */}
                    <div>
                        <h3 className="text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-3">
                            登録済み（{filteredTerms.length}件）
                        </h3>
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                            </div>
                        ) : filteredTerms.length === 0 ? (
                            <p className="text-[14px] text-slate-400 text-center py-6">登録された用語はありません</p>
                        ) : (
                            <div className="space-y-2">
                                {filteredTerms.map(term => (
                                    <div key={term.id} className="bg-white border border-slate-200 rounded-[12px] px-4 py-3 flex items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            {term.customer && (
                                                <span className="inline-block bg-slate-100 text-slate-500 text-[11px] font-semibold px-2 py-0.5 rounded-full mb-1">{term.customer}</span>
                                            )}
                                            {!term.customer && (
                                                <span className="inline-block bg-violet-100 text-violet-600 text-[11px] font-semibold px-2 py-0.5 rounded-full mb-1">全顧客共通</span>
                                            )}
                                            <div className="flex items-center gap-2 text-[14px]">
                                                <span className="text-red-500 line-through truncate">{term.wrong_term}</span>
                                                <span className="text-slate-400">→</span>
                                                <span className="text-green-700 font-semibold truncate">{term.correct_term}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => handleDelete(term.id)}
                                            className="flex-shrink-0 w-8 h-8 rounded-full hover:bg-red-50 flex items-center justify-center transition-colors">
                                            <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
