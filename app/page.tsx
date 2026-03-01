'use client';

import { useState } from 'react';
import { Clock, Mic, LogOut, ChevronRight, Home, List, Plus } from 'lucide-react';
import UserSelect, { UserData } from '@/components/UserSelect';
import HistoryList from '@/components/HistoryList';
import VoiceRecorder from '@/components/VoiceRecorder';

type Tab = 'home' | 'history';
type Mode = 'idle' | 'voice';

export default function Page() {
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [mode, setMode] = useState<Mode>('idle');

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

  if (!currentUser) {
    return <UserSelect onSelect={handleUserSelect} />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">

      {/* ===== HEADER (topbar style) ===== */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-[10px] border-b border-black/5">
        <div className="px-5 py-4 flex items-center justify-between">
          <span className="font-extrabold text-[18px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px]">
            Pocket Matip
          </span>
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 rounded-full px-3 py-1.5">
              <span className="text-[13px] font-semibold text-slate-600">{currentUser.name}</span>
            </div>
            <button onClick={handleLogout}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-lg hover:bg-slate-50"
              title="ユーザー切替">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 px-5 pt-5 pb-4">

        {/* ===== HOME TAB ===== */}
        {activeTab === 'home' && mode === 'idle' && (
          <div className="space-y-6 animate-fade-in-up">

            {/* Hero CTA */}
            <button
              onClick={() => setMode('voice')}
              className="w-full bg-white rounded-[20px] p-6 border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] hover:shadow-[0_10px_25px_-5px_rgba(124,58,237,0.12)] hover:border-violet-200 transition-all duration-200 active:scale-[0.98] group"
            >
              <div className="flex items-center gap-5">
                <div className="w-[60px] h-[60px] rounded-[16px] bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center shadow-[0_4px_12px_rgba(124,58,237,0.3)] group-hover:scale-105 transition-transform flex-shrink-0">
                  <Plus className="w-7 h-7 text-white" />
                </div>
                <div className="text-left flex-1">
                  <div className="text-[17px] font-bold text-slate-800">新しい議事録を作成</div>
                  <div className="text-[13px] text-slate-400 mt-1">録音 or ファイルアップロード</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-violet-400 group-hover:translate-x-1 transition-all flex-shrink-0" />
              </div>
            </button>

            {/* Recent Records Section */}
            <section>
              <div className="flex items-center justify-between mb-4 px-1">
                <h2 className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px] flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  最近の記録
                </h2>
                <button onClick={() => setActiveTab('history')}
                  className="text-[12px] text-violet-500 hover:text-violet-700 transition-colors flex items-center gap-0.5 font-semibold">
                  すべて見る
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="bg-white rounded-[20px] border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)]">
                <div className="max-h-[420px] overflow-y-auto p-2">
                  <HistoryList userId={currentUser.id} refreshTrigger={refreshTrigger} />
                </div>
              </div>
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
          <div className="space-y-4 animate-fade-in-up">
            <div className="px-1">
              <h2 className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px]">全履歴</h2>
            </div>
            <div className="bg-white rounded-[20px] border border-slate-200 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] min-h-[400px]">
              <div className="p-2">
                <HistoryList userId={currentUser.id} refreshTrigger={refreshTrigger} />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ===== BOTTOM NAVIGATION ===== */}
      <nav className="sticky bottom-0 z-50 bg-white border-t border-slate-200">
        <div className="flex items-center justify-around px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => { setActiveTab('home'); setMode('idle'); }}
            className={`flex flex-col items-center gap-1.5 py-1 w-[80px] transition-all ${activeTab === 'home' && mode === 'idle' ? 'text-violet-600 font-semibold' : 'text-slate-400'}`}
          >
            <Home className="w-[22px] h-[22px]" />
            <span className="text-[11px]">ホーム</span>
          </button>

          <button
            onClick={() => setMode('voice')}
            className="relative -top-5 flex flex-col items-center"
          >
            <div className="w-[56px] h-[56px] rounded-full bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center shadow-[0_4px_12px_rgba(124,58,237,0.4)] active:scale-90 transition-transform border-[3px] border-white">
              <Mic className="w-6 h-6 text-white" />
            </div>
            <span className="text-[10px] font-semibold text-slate-400 mt-1.5">録音</span>
          </button>

          <button
            onClick={() => { setActiveTab('history'); setMode('idle'); }}
            className={`flex flex-col items-center gap-1.5 py-1 w-[80px] transition-all ${activeTab === 'history' && mode === 'idle' ? 'text-violet-600 font-semibold' : 'text-slate-400'}`}
          >
            <List className="w-[22px] h-[22px]" />
            <span className="text-[11px]">履歴</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
