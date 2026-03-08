'use client';

import { useState, useEffect, useMemo } from 'react';
import { Mic, LogOut, Home, List, Search, ChevronRight, FileText, X, User } from 'lucide-react';
import UserSelect, { UserData } from '@/components/UserSelect';
import HistoryList from '@/components/HistoryList';
import VoiceRecorder from '@/components/VoiceRecorder';
import { supabase } from '@/lib/supabase';

type Tab = 'home' | 'history';
type Mode = 'idle' | 'voice';

interface MinutesRecord {
  id: number;
  created_at: string;
  client_name: string;
  summary: string;
  user_id: string;
  user?: { name: string } | null;
  transcript?: string;
}

export default function Page() {
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [mode, setMode] = useState<Mode>('idle');

  // Home data
  const [homeRecords, setHomeRecords] = useState<MinutesRecord[]>([]);
  const [homeSearch, setHomeSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [selectedHomeRecord, setSelectedHomeRecord] = useState<MinutesRecord | null>(null);

  const handleUserSelect = (user: UserData) => setCurrentUser(user);

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveTab('home');
    setMode('idle');
  };

  const handleSaved = () => {
    setRefreshTrigger(prev => prev + 1);
    setMode('idle');
    setActiveTab('home');
  };

  // Fetch records for home dashboard
  useEffect(() => {
    if (!currentUser) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('pocket-yasunobu')
        .select('*, user:users!pocket-yasunobu_user_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(50);
      setHomeRecords((data as unknown as MinutesRecord[]) || []);
    };
    fetch();
  }, [currentUser, refreshTrigger]);

  // Recent 3 records
  const recentRecords = useMemo(() => homeRecords.slice(0, 3), [homeRecords]);

  // Monthly counts
  const monthlyCounts = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const thisMonth = homeRecords.filter(r => {
      const d = new Date(r.created_at);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    return {
      mine: thisMonth.filter(r => r.user_id === currentUser?.id).length,
      total: thisMonth.length,
    };
  }, [homeRecords, currentUser]);

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

  const formatTimestamp = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const handleHomeSearch = () => {
    if (homeSearch.trim()) {
      setHistorySearch(homeSearch.trim());
      setHomeSearch('');
      setActiveTab('history');
    }
  };

  if (!currentUser) {
    return <UserSelect onSelect={handleUserSelect} />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50/50">

      {/* ===== HEADER ===== */}
      <header className="bg-white z-50 border-b border-slate-100">
        <div className="px-6 py-5 flex items-center justify-between">
          <span className="font-extrabold text-[17px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px]">
            Pocket Yasunobu
          </span>
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 rounded-full px-4 py-2">
              <span className="text-[13px] font-semibold text-slate-600">{currentUser.name}</span>
            </div>
            <button onClick={handleLogout}
              className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-lg hover:bg-slate-50"
              title="ユーザー切替">
              <LogOut className="w-[16px] h-[16px]" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 px-6 pt-10 pb-10">

        {/* ===== HOME TAB ===== */}
        {activeTab === 'home' && mode === 'idle' && (
          <div className="animate-fade-in-up space-y-8">

            {/* 1. Search bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
              <input
                type="text"
                value={homeSearch}
                onChange={(e) => setHomeSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleHomeSearch(); }}
                placeholder="検索（会社名・内容）"
                className="w-full bg-white border border-slate-200 rounded-[14px] pl-11 pr-4 py-4 text-[15px] text-slate-700 placeholder:text-slate-400 focus:border-violet-300 focus:shadow-[0_0_0_4px_rgba(124,58,237,0.08)] outline-none transition-all"
              />
            </div>

            {/* 2. Record button */}
            <button
              onClick={() => setMode('voice')}
              className="w-full rounded-[16px] py-5 flex items-center justify-center gap-3 text-white font-bold text-[16px] active:scale-[0.98] transition-transform shadow-[0_4px_16px_rgba(124,58,237,0.35)]"
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}
            >
              <Mic className="w-6 h-6" />
              今すぐ録音
            </button>

            {/* 3. Monthly count */}
            <section>
              <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-4">今月の作成数</h2>
              <div className="bg-white rounded-[16px] border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] px-6 py-6 flex items-center gap-6">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[32px] font-extrabold text-violet-600">{monthlyCounts.mine}</span>
                  <span className="text-[13px] font-semibold text-slate-500">件</span>
                  <span className="text-[12px] text-slate-400 ml-1">自分</span>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[32px] font-extrabold text-slate-400">{monthlyCounts.total}</span>
                  <span className="text-[13px] font-semibold text-slate-500">件</span>
                  <span className="text-[12px] text-slate-400 ml-1">全件</span>
                </div>
                <span className="text-[12px] text-slate-400 ml-auto">{new Date().getMonth() + 1}月</span>
              </div>
            </section>

            {/* 4. Recent records */}
            <section>
              <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-4">前回の続き</h2>
              {recentRecords.length === 0 ? (
                <div className="bg-white rounded-[16px] border border-slate-200 p-8 text-center">
                  <p className="text-slate-400 text-[14px]">まだ議事録がありません</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentRecords.map(record => (
                    <div key={record.id}
                      className="bg-white rounded-[16px] border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all">
                      <div className="px-5 py-5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[15px] font-bold text-slate-800 truncate flex-1 mr-3">{record.client_name || '名称なし'}</span>
                          <span className="text-[12px] text-slate-400 flex-shrink-0">{formatDateShort(record.created_at)}</span>
                        </div>
                        <p className="text-[13px] text-slate-500 line-clamp-1 leading-[1.6] mb-4">{record.summary}</p>
                        <button
                          onClick={() => setSelectedHomeRecord(record)}
                          className="text-[13px] font-semibold text-violet-600 flex items-center gap-1 hover:text-violet-800 transition-colors"
                        >
                          開く
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </div>
        )}

        {/* ===== VOICE/UPLOAD MODE ===== */}
        {mode === 'voice' && (
          <div className="animate-fade-in-up">
            <VoiceRecorder
              userId={currentUser.id}
              userName={currentUser.name}
              onSaved={handleSaved}
              onCancel={() => setMode('idle')}
            />
          </div>
        )}

        {/* ===== HISTORY TAB ===== */}
        {activeTab === 'history' && mode === 'idle' && (
          <div className="animate-fade-in-up">
            <HistoryList
              userId={currentUser.id}
              userName={currentUser.name}
              refreshTrigger={refreshTrigger}
              initialSearch={historySearch}
              onDataChanged={() => setRefreshTrigger(prev => prev + 1)}
            />
          </div>
        )}
      </main>

      {/* ===== Detail Modal (Home) ===== */}
      {selectedHomeRecord && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedHomeRecord(null); }}>
          <div className="bg-white rounded-[20px] w-full max-w-[440px] max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white rounded-t-[20px] px-7 pt-7 pb-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-[20px] font-bold text-slate-800">議事録詳細</h2>
              <button onClick={() => setSelectedHomeRecord(null)}
                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-7 space-y-7">
              <div className="text-[13px] text-slate-400 font-medium">
                作成: {formatTimestamp(selectedHomeRecord.created_at)}
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">顧客名</label>
                <p className="text-[19px] font-bold text-slate-800">{selectedHomeRecord.client_name || '名称なし'}</p>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <span className="text-[14px] text-slate-500">{selectedHomeRecord.user?.name ?? '不明'}</span>
              </div>
              <div>
                <label className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-3">内容</label>
                <p className="text-[15px] text-slate-600 leading-[1.8] whitespace-pre-wrap">{selectedHomeRecord.summary}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== BOTTOM NAVIGATION ===== */}
      <nav className="sticky bottom-0 z-50 bg-white border-t border-slate-200">
        <div className="flex items-center justify-around px-4 pt-4 pb-[max(20px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => { setActiveTab('home'); setMode('idle'); setHistorySearch(''); }}
            className={`flex flex-col items-center gap-1.5 py-1 w-[80px] transition-all ${activeTab === 'home' && mode === 'idle' ? 'text-violet-600 font-semibold' : 'text-slate-400'}`}
          >
            <Home className="w-[24px] h-[24px]" />
            <span className="text-[12px]">ホーム</span>
          </button>

          <button
            onClick={() => setMode('voice')}
            className="relative -top-5 flex flex-col items-center"
          >
            <div className="w-[64px] h-[64px] rounded-full bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center shadow-[0_6px_16px_rgba(124,58,237,0.4)] active:scale-90 transition-transform border-[3px] border-white">
              <Mic className="w-7 h-7 text-white" />
            </div>
            <span className="text-[11px] font-semibold text-slate-400 mt-1.5">録音</span>
          </button>

          <button
            onClick={() => { setActiveTab('history'); setMode('idle'); }}
            className={`flex flex-col items-center gap-1.5 py-1 w-[80px] transition-all ${activeTab === 'history' && mode === 'idle' ? 'text-violet-600 font-semibold' : 'text-slate-400'}`}
          >
            <List className="w-[24px] h-[24px]" />
            <span className="text-[12px]">履歴</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
