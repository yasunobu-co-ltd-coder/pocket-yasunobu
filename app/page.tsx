'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Mic, LogOut, Home, List, Search, ChevronRight, X, User, Download, Loader2, BookOpen, BookMarked, HelpCircle, Play, Pause, Square } from 'lucide-react';
import UserSelect, { UserData } from '@/components/UserSelect';
import HistoryList from '@/components/HistoryList';
import VoiceRecorder from '@/components/VoiceRecorder';
import TermDictionary from '@/components/TermDictionary';
import { supabase } from '@/lib/supabase';
import { generateMinutesPdf } from '@/lib/generate-pdf';
import TTSPlayer, { TTSPlayerHandle } from '@/components/TTSPlayer';
import RadioTalkPlayer, { RadioTalkPlayerHandle } from '@/components/RadioTalkPlayer';

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

  // Term dictionary modal
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [showRulebook, setShowRulebook] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const [isHomeDeleting, setIsHomeDeleting] = useState(false);

  // バックグラウンド再生
  const [isModalVisible, setIsModalVisible] = useState(true);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [bgProgress, setBgProgress] = useState(0);
  const ttsRef = useRef<TTSPlayerHandle>(null);
  const radioTalkRef = useRef<RadioTalkPlayerHandle>(null);

  const handleUserSelect = (user: UserData) => setCurrentUser(user);

  const closeHomeModal = () => {
    ttsRef.current?.stop();
    radioTalkRef.current?.stop();
    setIsAudioPlaying(false);
    setSelectedHomeRecord(null);
    setIsModalVisible(true);
  };

  const openHomeRecord = (record: MinutesRecord) => {
    if (selectedHomeRecord && selectedHomeRecord.id !== record.id && isAudioPlaying) {
      ttsRef.current?.stop();
    }
    setSelectedHomeRecord(record);
    setIsModalVisible(true);
  };

  const stopBgPlayback = () => {
    ttsRef.current?.stop();
    setSelectedHomeRecord(null);
    setIsModalVisible(true);
    setIsAudioPlaying(false);
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

  // ログイン時に既存議事録の音声をバックグラウンド生成
  useEffect(() => {
    if (!currentUser) return;
    fetch('/api/tts/batch-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_size: 5 }),
    }).catch(() => {});
  }, [currentUser]);

  // Fetch records for home dashboard
  useEffect(() => {
    if (!currentUser) return;
    const fetchData = async () => {
      const { data } = await supabase
        .from('pocket-yasunobu')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

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
      setHomeRecords(recordsWithUser as MinutesRecord[]);
    };
    fetchData();
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
            pocket
          </span>
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 rounded-full px-4 py-2">
              <span className="text-[13px] font-semibold text-slate-600">{currentUser.name}</span>
            </div>
            <button onClick={() => setShowRulebook(true)}
              className="text-slate-400 hover:text-violet-600 transition-colors p-2 rounded-lg hover:bg-violet-50"
              title="ルルブ">
              <BookMarked className="w-[16px] h-[16px]" />
            </button>
            <button onClick={() => setShowHelp(true)}
              className="text-slate-400 hover:text-violet-600 transition-colors p-2 rounded-lg hover:bg-violet-50"
              title="ヘルプ">
              <HelpCircle className="w-[16px] h-[16px]" />
            </button>
            <button onClick={() => setIsDictOpen(true)}
              className="text-slate-400 hover:text-violet-600 transition-colors p-2 rounded-lg hover:bg-violet-50"
              title="用語辞書">
              <BookOpen className="w-[16px] h-[16px]" />
            </button>
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
              <label htmlFor="home-search" className="sr-only">検索</label>
              <input
                id="home-search"
                name="home-search"
                type="text"
                value={homeSearch}
                onChange={(e) => setHomeSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleHomeSearch(); }}
                placeholder="検索（会議名・内容）"
                autoComplete="off"
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
                          onClick={() => openHomeRecord(record)}
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
        <div className={`fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5 transition-opacity ${isModalVisible ? '' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => { if (e.target === e.currentTarget) closeHomeModal(); }}>
          <div className="bg-white rounded-[20px] w-full max-w-[440px] max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white rounded-t-[20px] px-7 pt-7 pb-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-[20px] font-bold text-slate-800">議事録詳細</h2>
              <button onClick={closeHomeModal}
                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-7 space-y-7">
              <div className="text-[13px] text-slate-400 font-medium">
                作成: {formatTimestamp(selectedHomeRecord.created_at)}
              </div>

              <div>
                <span className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-2">会議名</span>
                <p className="text-[19px] font-bold text-slate-800">{selectedHomeRecord.client_name || '名称なし'}</p>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <span className="text-[14px] text-slate-500">{selectedHomeRecord.user?.name ?? '不明'}</span>
              </div>
              <div>
                <span className="block text-[13px] font-bold text-slate-400 uppercase tracking-[0.5px] mb-3">内容</span>
                <p className="text-[15px] text-slate-600 leading-[1.8] whitespace-pre-wrap">{selectedHomeRecord.summary}</p>
              </div>

              {/* PDF / TTS buttons */}
              <div className="pt-2 space-y-3">
                <button
                  onClick={() => generateMinutesPdf({
                    meetingName: selectedHomeRecord.client_name || '',
                    createdAt: selectedHomeRecord.created_at,
                    creatorName: selectedHomeRecord.user?.name,
                    summary: selectedHomeRecord.summary,
                  })}
                  className="w-full bg-violet-50 text-violet-600 font-bold py-4 rounded-[14px] text-[15px] hover:bg-violet-100 transition-all active:scale-[0.97] flex items-center justify-center gap-2">
                  <Download className="w-5 h-5" />
                  PDFで出力
                </button>
                {/* TTS Player */}
                <TTSPlayer
                  ref={ttsRef}
                  minuteId={selectedHomeRecord.id}
                  summaryText={selectedHomeRecord.summary}
                  clientName={selectedHomeRecord.client_name}
                  onPlaybackChange={setIsAudioPlaying}
                  onProgressChange={setBgProgress}
                />
                {/* ラジオトーク */}
                <RadioTalkPlayer ref={radioTalkRef} minuteId={selectedHomeRecord.id} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Term Dictionary Modal ===== */}
      <TermDictionary userId={currentUser.id} isOpen={isDictOpen} onClose={() => setIsDictOpen(false)} />

      {/* ===== Rulebook overlay ===== */}
      {showRulebook && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
          onClick={(e) => { if (e.target === e.currentTarget) setShowRulebook(false); }}>
          <div className="bg-white rounded-[20px] w-full max-w-[400px] max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="px-7 pt-7 pb-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-slate-800 flex items-center gap-2">
                <BookMarked className="w-5 h-5 text-violet-500" />ルルブ
              </h2>
              <button onClick={() => setShowRulebook(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-7 space-y-6">
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
              <div>
                <h3 className="text-[14px] font-bold text-slate-700 mb-3">用語辞書</h3>
                <div className="bg-slate-50 rounded-[12px] p-4">
                  <p className="text-[13px] text-slate-600 leading-[1.7]">
                    よく使う顧客名・商品名・専門用語などをあらかじめ登録しておくリストです。
                    ヘッダーの <span className="inline-flex items-center"><BookOpen className="w-3 h-3 mx-0.5" /></span> アイコンから開けます。
                    文字起こし後に不自然な表記があれば、辞書を参照して正しい表記に書き換えてください。
                  </p>
                </div>
              </div>
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
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-5"
          onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
          <div className="bg-white rounded-[20px] w-full max-w-[400px] max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="px-7 pt-7 pb-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-slate-800 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-violet-500" />ヘルプ
              </h2>
              <button onClick={() => setShowHelp(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-7 space-y-5">
              {[
                { q: '録音が途中で止まる', a: 'ブラウザのマイク許可を確認してください。また、画面をロックしたり他のアプリに切り替えると録音が中断されることがあります。録音中は画面を開いたままにしてください。' },
                { q: '議事録の内容がおかしい', a: '音声が小さい・雑音が多いと認識精度が下がります。マイクに近い位置で録音してください。また、用語辞書に固有名詞を登録しておくと、誤変換が減ります。' },
                { q: '音声が再生できない', a: '音声は保存後にサーバーで自動生成されます。「生成中...」の表示が消えるまでお待ちください。長い議事録は数分かかることがあります。' },
                { q: 'キャラクターを変えたら「生成中」になった', a: '初めて選んだキャラクターの音声はその場で生成されます。しばらくお待ちください。一度生成された音声はキャッシュされるので、次回からは即再生できます。' },
                { q: '議事録を編集したら音声はどうなる？', a: '編集後の内容で新しい音声が自動生成されます。編集前の音声は古いテキストに紐づいているため、新しい音声の生成が完了するまでお待ちください。' },
                { q: 'PDFに出力したい', a: '議事録の詳細画面を開き、「PDFで出力」ボタンを押してください。ブラウザのダウンロードフォルダに保存されます。' },
                { q: '担当者を並び替えたい', a: 'ユーザー選択画面で、名前の左にあるグリップ（⋮⋮）を長押ししてドラッグすると並び替えられます。' },
                { q: 'スマホのホーム画面に追加したい', a: 'ブラウザの共有メニュー（iOS: Safari の共有ボタン → ホーム画面に追加 / Android: Chrome のメニュー → ホーム画面に追加）から追加できます。' },
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

      {/* ===== フローティングミニプレイヤー（バックグラウンド再生中） ===== */}
      {selectedHomeRecord && !isModalVisible && (
        <div className="sticky bottom-[72px] z-40 mx-3 mb-1 bg-white rounded-[14px] border border-slate-200 shadow-lg overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setIsModalVisible(true)}>
              <div className="text-[12px] font-bold text-slate-700 truncate mb-1">
                {selectedHomeRecord.client_name || '議事録'}
              </div>
              <div className="w-full h-[4px] bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${bgProgress}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isAudioPlaying ? (
                <button onClick={() => ttsRef.current?.pause()}
                  className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center active:scale-95">
                  <Pause className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={() => ttsRef.current?.play()}
                  className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center active:scale-95">
                  <Play className="w-4 h-4" />
                </button>
              )}
              <button onClick={stopBgPlayback}
                className="w-9 h-9 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center active:scale-95">
                <Square className="w-4 h-4" />
              </button>
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
