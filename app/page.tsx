'use client';

import { useState } from 'react';
import { Clock, Mic, Upload, LogOut } from 'lucide-react';
import UserSelect, { UserData } from '@/components/UserSelect';
import HistoryList from '@/components/HistoryList';
import VoiceRecorder from '@/components/VoiceRecorder';

type Tab = 'home' | 'history';
type Mode = 'idle' | 'voice';

export default function Home() {
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [mode, setMode] = useState<Mode>('idle');

  const handleUserSelect = (user: UserData) => {
    setCurrentUser(user);
  };

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

  // ユーザー未選択 → 選択画面
  if (!currentUser) {
    return <UserSelect onSelect={handleUserSelect} />;
  }

  return (
    <div className="min-h-screen pb-20 font-sans text-slate-200">

      {/* Header */}
      <header className="relative overflow-hidden bg-gradient-to-br from-violet-700 via-purple-700 to-violet-900 px-6 pt-8 pb-16 rounded-b-[40px] shadow-2xl">
        <div className="absolute top-0 right-0 p-4">
          <button onClick={handleLogout} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors flex items-center gap-1.5"
            title="ユーザー切替">
            <LogOut className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-white/15 backdrop-blur-md rounded-2xl flex items-center justify-center text-2xl shadow-inner border border-white/10">
              📱
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Pocket Matip</h1>
              <p className="text-violet-200 text-xs font-medium">{currentUser.name} さん</p>
            </div>
          </div>
        </div>

        <div className="absolute -top-20 -right-20 w-60 h-60 bg-purple-400/15 rounded-full blur-3xl animate-[pulse_6s_infinite]" />
        <div className="absolute top-20 -left-20 w-40 h-40 bg-violet-400/15 rounded-full blur-2xl animate-[pulse_4s_infinite]" />
      </header>

      {/* Main Content */}
      <main className="px-5 -mt-8 relative z-20 space-y-6">

        {/* Tab Navigation */}
        <div className="flex bg-[#0f0a1a] p-1.5 rounded-2xl shadow-lg border border-violet-500/20 mb-6">
          <button
            onClick={() => { setActiveTab('home'); setMode('idle'); }}
            className={`flex-1 flex flex-col items-center py-2 rounded-xl text-xs font-semibold transition-all ${activeTab === 'home' ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-md' : 'text-slate-500 hover:bg-white/5'}`}
          >
            <span className="text-lg mb-0.5">🏠</span>
            ホーム
          </button>
          <button
            onClick={() => { setActiveTab('history'); setMode('idle'); }}
            className={`flex-1 flex flex-col items-center py-2 rounded-xl text-xs font-semibold transition-all ${activeTab === 'history' ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-md' : 'text-slate-500 hover:bg-white/5'}`}
          >
            <span className="text-lg mb-0.5">📋</span>
            履歴一覧
          </button>
        </div>

        {/* Home Tab - Idle */}
        {activeTab === 'home' && mode === 'idle' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <button
              onClick={() => setMode('voice')}
              className="w-full bg-[#0f0a1a] p-8 rounded-2xl border border-violet-500/20 shadow-[0_0_40px_rgba(139,92,246,0.08)] hover:border-violet-500/40 hover:shadow-[0_0_60px_rgba(139,92,246,0.15)] transition-all active:scale-95 flex flex-col items-center text-center gap-4 group"
            >
              <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-400 group-hover:bg-violet-600 group-hover:text-white transition-all shadow-[0_0_30px_rgba(139,92,246,0.2)]">
                <Mic className="w-10 h-10" />
              </div>
              <div>
                <div className="text-xl font-bold text-white mb-2">議事録を作成</div>
                <div className="text-sm text-slate-400">
                  録音またはファイルアップロードで作成<br />
                  <span className="text-violet-400/60 text-xs flex items-center justify-center gap-1 mt-1">
                    <Upload className="w-3 h-3" />
                    ボイスメモの共有にも対応
                  </span>
                </div>
              </div>
            </button>

            <div className="bg-[#0f0a1a] rounded-2xl p-5 border border-violet-500/20 shadow-lg">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-violet-400" />
                最近の記録
              </h3>
              <div className="max-h-[300px] overflow-y-auto pr-1">
                <HistoryList userId={currentUser.id} refreshTrigger={refreshTrigger} />
              </div>
              <div className="mt-4 text-center">
                <button onClick={() => setActiveTab('history')} className="text-xs text-violet-400 font-medium hover:text-violet-300 transition-colors">
                  すべての履歴を見る →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Voice/Upload Mode */}
        {mode === 'voice' && (
          <VoiceRecorder
            userId={currentUser.id}
            userName={currentUser.name}
            onSaved={handleSaved}
            onCancel={() => setMode('idle')}
          />
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="bg-[#0f0a1a] rounded-2xl p-5 border border-violet-500/20 shadow-lg min-h-[500px]">
            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <span className="text-2xl">📋</span> 全履歴一覧
            </h3>
            <HistoryList userId={currentUser.id} refreshTrigger={refreshTrigger} />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="text-center py-4 mt-8">
        <p className="text-[10px] text-violet-500/30 font-mono">Pocket Matip v8.0</p>
      </footer>
    </div>
  );
}
