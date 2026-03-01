'use client';

import { useState } from 'react';
import { Mic, LogOut, Home, List } from 'lucide-react';
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
    <div className="min-h-screen flex flex-col font-sans bg-slate-50/50">

      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-[10px] border-b border-black/5">
        <div className="px-6 py-4 flex items-center justify-between">
          <span className="font-extrabold text-[17px] bg-gradient-to-r from-violet-800 to-violet-500 bg-clip-text text-transparent tracking-[-0.5px]">
            Pocket Matip
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
      <main className="flex-1 px-5 pt-8 pb-10">

        {/* ===== HOME TAB ===== */}
        {activeTab === 'home' && mode === 'idle' && (
          <div className="animate-fade-in-up">
            <HistoryList userId={currentUser.id} userName={currentUser.name} refreshTrigger={refreshTrigger} />
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
            <HistoryList userId={currentUser.id} userName={currentUser.name} refreshTrigger={refreshTrigger} />
          </div>
        )}
      </main>

      {/* ===== BOTTOM NAVIGATION ===== */}
      <nav className="sticky bottom-0 z-50 bg-white border-t border-slate-200">
        <div className="flex items-center justify-around px-4 pt-4 pb-[max(20px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => { setActiveTab('home'); setMode('idle'); }}
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
