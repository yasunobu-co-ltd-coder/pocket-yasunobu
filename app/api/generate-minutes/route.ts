import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 180; // 6ステップLLM呼び出しのため延長

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const LLM_MODEL = 'gpt-4o';
const LLM_TEMPERATURE = 0.2;
const TODAY = () => new Date().toLocaleDateString('ja-JP');

// ─── ユーティリティ ───

/** LLM呼び出し共通関数 */
async function callLLM(system: string, user: string, maxTokens = 4000): Promise<string> {
    const completion = await openai.chat.completions.create({
        model: LLM_MODEL,
        temperature: LLM_TEMPERATURE,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
    });
    return completion.choices[0].message.content || '{}';
}

/** JSON安全パース */
function safeParse(text: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

/** 議題タイトルの軽い前処理（LLM補正前） */
function preNormalizeTopicTitle(title: string): string {
    let t = title.trim();
    // 20文字超は末尾を省略候補としてマーク（LLMに判断させる）
    // 「について」「の件」だけで終わる曖昧表現をそのまま渡す（LLMが補正）
    // 前後の余計な記号を除去
    t = t.replace(/^[・\-\s]+/, '').replace(/[\s]+$/, '');
    return t;
}

// ─── 用語辞書取得 ───

interface TermEntry { wrong_term: string; correct_term: string; customer: string }

async function fetchTermDictionary(userId: string, customer: string): Promise<TermEntry[]> {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('term_dictionary')
            .select('wrong_term, correct_term, customer')
            .eq('user_id', userId)
            .in('customer', [customer, ''])
            .order('customer', { ascending: false });

        if (error || !data) return [];
        return data as TermEntry[];
    } catch {
        return [];
    }
}

function buildTermDictionaryPrompt(terms: TermEntry[]): string {
    if (terms.length === 0) return '';
    const lines = terms.map(t => `「${t.wrong_term}」→「${t.correct_term}」`).join('\n');
    return `\n\n■ 用語辞書（以下の表記ルールに従ってください）:\n${lines}\n音声認識で左の表記が出現した場合、右の正しい表記に置き換えてください。`;
}

// ─── STEP1: Topic抽出 ───
// ステップ構成: STEP1→STEP2→STEP3→STEP4→STEP5→STEP6

async function extractTopics(transcription: string, chunkCount: number, termPrompt: string): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP1: Topic抽出 開始');
    const systemPrompt = `あなたは会議分析の専門家です。
以下の会議の文字起こしを読み、会話全体を「議題ごと」に整理してください。
${chunkCount > 1 ? `※この音声は${chunkCount}つのパートに分割されて文字起こしされています。全体を通して分析してください。` : ''}

出力は必ず **有効なJSONのみ** を返してください。

出力形式:
{
  "topics": [
    {
      "topic": "議題タイトル",
      "content": "この議題で話された内容の要約（具体的な数字・名前・日付を含める）"
    }
  ]
}

ルール:
- 会話順ではなく意味で分類
- 類似する話題は統合
- 議題数は3〜6個
- 雑談は除外
- 議題タイトルは簡潔に
- contentは「何が議論されたか」だけでなく「何が決まったか」「何が未決か」も含める
- 具体的な数字、固有名詞、日付、担当者名は必ず保持する
- 情報の捏造は禁止${termPrompt}`;

    const result = await callLLM(systemPrompt, transcription);
    const parsed = safeParse(result, { topics: [] });
    console.log(`[MINUTES] STEP1完了: ${(parsed.topics as Array<unknown>)?.length || 0} 議題抽出`);
    return parsed;
}

// ─── STEP2: 議題タイトル補正 ───

async function normalizeTopicTitles(topicsJson: Record<string, unknown>): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP2: 議題タイトル補正 開始');
    const topics = topicsJson.topics as Array<{ topic: string; content: string }> || [];

    // 軽い前処理
    const preProcessed = topics.map(t => ({
        ...t,
        topic: preNormalizeTopicTitle(t.topic),
    }));

    // 重複タイトルチェック
    const titleCounts = new Map<string, number>();
    for (const t of preProcessed) {
        titleCounts.set(t.topic, (titleCounts.get(t.topic) || 0) + 1);
    }
    const hasDuplicates = Array.from(titleCounts.values()).some(c => c > 1);

    const systemPrompt = `あなたはビジネス会議の編集者です。
以下の議題一覧を読み、各議題タイトルを「議事録の見出しとして自然で分かりやすい表現」に修正してください。

出力は必ず **有効なJSONのみ** を返してください。

出力形式:
{
  "topics": [
    {
      "topic": "修正後の議題タイトル",
      "content": "元のcontent"
    }
  ]
}

ルール:
- タイトルは短く明確に（15文字以内推奨）
- 「その件」「これ」「いろいろ」など曖昧表現は禁止
- 可能なら業務用語に寄せる
- 抽象的すぎるタイトルは禁止
${hasDuplicates ? '- 同じ意味のタイトルが複数あるので、意味で差別化してください' : ''}
- 情報の捏造は禁止
- contentは原則そのまま維持する

良い例: 営業進捗の確認 / アプリ改善方針の整理 / 顧客対応フローの見直し / 次回開発スケジュール
悪い例: いろいろ話したこと / 今後について / 開発の件 / そのへん / 打ち合わせ内容`;

    const result = await callLLM(systemPrompt, JSON.stringify({ topics: preProcessed }), 2000);
    const parsed = safeParse(result, { topics: preProcessed });
    console.log('[MINUTES] STEP2完了: タイトル補正済み');
    return parsed;
}

// ─── STEP3: 要点抽出 ───

async function extractInsights(normalizedTopics: Record<string, unknown>): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP3: 要点抽出 開始');
    const systemPrompt = `あなたは優秀なプロジェクトマネージャーです。
以下の議題一覧から、会議の要点を抽出してください。

出力は必ず **有効なJSONのみ** を返してください。

出力形式:
{
  "decisions": ["決定事項1", "決定事項2"],
  "confirmedTodos": ["明確に述べられたタスク1", "タスク2"],
  "suggestedActions": ["会話の流れ上ほぼ必要な次アクション1", "アクション2"],
  "risks": ["未解決課題1"],
  "importantPoints": ["戦略的に重要な内容1"],
  "nextSchedule": "次回予定（YYYY年MM月DD日 形式。不明なら空文字）",
  "keywords": ["キーワード1", "キーワード2"]
}

抽出ルール:

■ decisions: 会議で明確に「こうする」「これで行く」と決まった事項のみ。最大10件。
  - 「議論されたこと」や「提案されただけのこと」は含めない
  - 「〇〇することに決定した」という形で書く
  悪い例: 「UIの改善が必要」（これは課題であり決定事項ではない）
  良い例: 「通知機能はプッシュ通知ではなくアプリ内通知で実装する方針に決定」

■ confirmedTodos: 会議中で明確に「やる」「対応する」「修正する」等と述べられた作業。最大10件。
  - 必ず「誰が / 何を / 何のために」を可能な限り含める
  - 「確認する」「検討する」だけで終わらせず、対象や目的を明記する
  悪い例: 「UI改善を検討する」
  良い例: 「田中がアプリの通知機能とUI改善案を整理し、次回会議で提示する」
  悪い例: 「テストする」
  良い例: 「音声再生の倍速切替がチャンク遷移後も維持されるか動作確認テストを実施する」

■ suggestedActions: 明言は弱いが、会話の流れ上ほぼ必要と判断できる次アクション。最大10件。
  捏造ではなく、会話内容から自然に導ける範囲に限定する。根拠が弱いものは入れない。
  - 同様に具体的に書く。抽象的な表現は禁止。
  悪い例: 「関係者に共有する」
  良い例: 「営業チームに新機能の操作手順書を作成して共有する」

■ confirmedTodos / suggestedActions 共通の記載ルール:
  - 可能なら「誰が / 何を / 何のために」の形にする
  - 誰が不明でも、やることと対象は具体的に書く
  - 抽象語のみは禁止（「対応する」「進める」「確認する」だけはNG）
  - できるだけ行動単位に分解する
  - confirmedTodosとsuggestedActionsの重複禁止

■ risks: 未解決課題や懸念事項。最大5件。
  - 単に「影響がある可能性」ではなく、何にどう影響するかを書く
  - 可能なら「放置するとどうなるか」も1文で補足する
  悪い例: 「スケジュールに影響する可能性がある」
  良い例: 「VPSメモリが1GBのため、長文の音声合成でOOMが発生する。放置するとTTS機能が本番で使えない」

■ importantPoints: 戦略的に重要な内容。最大5件。
  - 1文で終わらせず、なぜ重要かの理由を補足する
  悪い例: 「営業デモが重要」
  良い例: 「来月の営業デモで議事録品質を見せるため、三段ロケット構成の精度検証を今週中に完了する必要がある」

■ nextSchedule: 次回予定がある場合はYYYY年MM月DD日形式で記載。曜日があれば含める。不明なら空文字。
  - 今日の日付は ${TODAY()} です。「来週」「再来週」「次の木曜」等の相対表現はこの日付を基準に変換すること。

■ risks: 未解決課題や懸念事項
■ importantPoints: 戦略的に重要な内容
■ keywords: 重要テーマ（最大5個）
- 情報の捏造は禁止
- 該当がなければ空配列・空文字`;

    const result = await callLLM(systemPrompt, JSON.stringify(normalizedTopics), 3000);
    const parsed = safeParse(result, {
        decisions: [], confirmedTodos: [], suggestedActions: [],
        risks: [], importantPoints: [], nextSchedule: '', keywords: [],
    });
    console.log(`[MINUTES] STEP3完了: confirmed=${(parsed.confirmedTodos as Array<unknown>)?.length || 0}, suggested=${(parsed.suggestedActions as Array<unknown>)?.length || 0}`);
    return parsed;
}

// ─── STEP4: 議題内容の深堀り展開 ───

async function expandTopics(
    normalizedTopics: Record<string, unknown>,
    transcription: string,
): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP4: 議題内容の深堀り展開 開始');
    const systemPrompt = `あなたは会議分析の専門家です。
以下の「議題一覧」と「元の文字起こし」を照合し、各議題の内容を大幅に詳細化してください。

出力は必ず **有効なJSONのみ** を返してください。

出力形式:
{
  "expandedTopics": [
    {
      "topic": "議題タイトル（そのまま維持）",
      "background": "この議題が上がった背景・経緯（文字起こしから読み取れる範囲で）",
      "discussionDetail": "何が話し合われたかの詳細（発言の要旨を時系列で。200〜400文字）",
      "opinions": ["出された意見・提案1", "意見2"],
      "qAndA": [
        {"q": "質問者名（不明なら「参加者」）: 質問内容", "a": "回答者名（不明なら「回答者」）: 回答内容"},
        {"q": "...", "a": "..."}
      ],
      "comparisons": ["比較検討された選択肢があれば記述（例: A案 vs B案）"],
      "conclusion": "結論（決まった場合）。未決なら「未決」と明記",
      "openIssues": ["この議題に関する未解決事項"]
    }
  ]
}

ルール:
- 元の文字起こしから具体的な発言内容を拾い上げる（要約ではなく詳細化）
- 数字・固有名詞・日付・担当者名は必ず保持
- 「誰が何と言ったか」を可能な限り含める
- 情報の捏造は禁止
- 文字起こしに含まれない情報は書かない
- discussionDetailは200〜400文字で詳細に書く
- opinionsは発言ベースで具体的に
- qAndAは結論に至った背景や懸念・論点が分かるやりとりを抽出する。該当するQ&Aが複数あれば件数制限なく全て記録する。以下のみ除外すること:
  - 雑談・確認程度の軽いやりとり
  - 単なる相槌や同意（「そうですね」「はい」等）
  - すでに決定事項(conclusion)と完全に同じ内容の繰り返し
  該当がなければ空配列
- comparisonsは選択肢の比較があった場合のみ記載`;

    const userContent = JSON.stringify({
        topics: normalizedTopics,
        transcription: transcription.slice(0, 12000), // トークン制限対策
    });

    const result = await callLLM(systemPrompt, userContent, 6000);
    const parsed = safeParse(result, { expandedTopics: [] });
    console.log(`[MINUTES] STEP4完了: ${(parsed.expandedTopics as Array<unknown>)?.length || 0} 議題展開`);
    return parsed;
}

// ─── STEP5: 論点構造抽出 ───

async function extractDiscussionStructure(
    expandedTopics: Record<string, unknown>,
    insights: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP5: 論点構造抽出 開始');
    const systemPrompt = `あなたは論理的な議事録構造化の専門家です。
以下の「展開済み議題」と「要点分析結果」をもとに、各議題の論点構造を整理してください。

出力は必ず **有効なJSONのみ** を返してください。

出力形式:
{
  "discussionStructures": [
    {
      "topic": "議題タイトル",
      "mainPoints": [
        {
          "point": "論点（何が問題・テーマだったか）",
          "arguments": ["この論点に対して出された意見・根拠1", "意見2"],
          "counterArguments": ["反対意見・懸念があれば"],
          "resolution": "この論点の結論（未決なら「未決」）"
        }
      ],
      "decisionRationale": "最終的な決定の根拠・理由（なぜそう決まったか）",
      "remainingQuestions": ["残された疑問・次回持ち越し事項"]
    }
  ]
}

ルール:
- 各議題について1〜3個の論点(mainPoints)を抽出する
- 論点は「何が問題だったか」「何を決める必要があったか」の形で記述
- arguments/counterArgumentsは具体的な発言・根拠ベースで書く
- 情報の捏造は禁止
- 文字起こしに含まれない議論は書かない
- decisionRationaleは「なぜそう決まったか」を明確に
- 該当がなければ空配列`;

    const userContent = JSON.stringify({
        expandedTopics,
        insights,
    });

    const result = await callLLM(systemPrompt, userContent, 5000);
    const parsed = safeParse(result, { discussionStructures: [] });
    console.log(`[MINUTES] STEP5完了: ${(parsed.discussionStructures as Array<unknown>)?.length || 0} 議題の論点構造抽出`);
    return parsed;
}

// ─── STEP6: 議事録生成 ───

async function generateFinalMinutes(
    normalizedTopics: Record<string, unknown>,
    insights: Record<string, unknown>,
    expandedTopics: Record<string, unknown>,
    discussionStructures: Record<string, unknown>,
    termPrompt: string,
): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP6: 議事録生成 開始');
    const systemPrompt = `あなたはプロフェッショナルな議事録作成者です。
以下の情報をもとに会議議事録を作成してください。

入力データには以下が含まれます:
- topics: 議題一覧（STEP2で補正済み）
- analysis: 要点分析結果（STEP3）
  - analysis.confirmedTodos: 会議で明確に述べられたタスク
  - analysis.suggestedActions: 会話の流れ上必要と判断される次アクション
- expandedTopics: 各議題の深堀り展開（STEP4）
  - 背景、議論詳細、出された意見、比較検討、結論、未解決事項
- discussionStructures: 各議題の論点構造（STEP5）
  - 論点、賛成意見/反対意見、結論の根拠、残された疑問

出力は **有効なJSONのみ** を返してください。

出力形式:
{
  "customer": "会議名（不明な場合は空文字）",
  "project": "案件名・用件（推測できる場合）",
  "summary": "議事録の本文（以下の構造で記述）",
  "decisions": ["決定事項1", "決定事項2"],
  "todos": ["タスク1", "タスク2", ... 最大8〜10件],
  "nextSchedule": "YYYY年MM月DD日（曜日）形式。不明なら空文字",
  "keywords": ["タグ1", "タグ2"]
}

■ todos の統合ルール（重要）:
1. まず confirmedTodos を優先して todos に入れる
2. その上で不足している場合、suggestedActions から重要度の高いものを追加し、最大8〜10件まで補完する
3. 以下の優先順で並べる:
   - 明確に指示された作業
   - 締切や担当が見える作業
   - 次回までに必要な準備
   - 推定アクション
4. 記載ルール:
   - 可能なら「誰が / 何を」の形にする
   - 抽象語のみは禁止（「対応する」「進める」だけはNG）
   - 行動単位に分解する
   - 重複禁止

■ summaryは以下の構造で記述してください（4000〜7000文字の詳細な議事録）:

■会議概要
会議の背景・目的を2〜3文で記述（expandedTopicsのbackgroundを活用）

■主な議題

●議題1のタイトル
・背景: なぜこの議題が上がったか（expandedTopicsのbackgroundから）
・議論内容: 何が話し合われたか（expandedTopicsのdiscussionDetailを活用し、300〜500文字で詳細に記述）
・質疑応答: 会議中の質問と回答のやりとりを時系列で残す（以下の形式）
  Q: ○○「質問内容」
  A: △△「回答内容」
  ※発言者名が不明な場合は「参加者」「回答者」等で代替可
  ※結論の背景・懸念・論点が分かるQ&Aは複数あれば全て記載する（件数制限なし）
  ※以下のみ除外: 雑談・相槌レベルのやりとり / 決定事項と完全に同じ内容の繰り返し
・論点: 何が問題・テーマだったか（discussionStructuresのmainPointsから）
・出された意見: 参加者から出された意見・提案（expandedTopicsのopinions + discussionStructuresのarguments/counterArguments）
・比較検討: 選択肢の比較があれば（expandedTopicsのcomparisons）
・結論: 何が決まったか（決まっていなければ「未決」と明記。決定の根拠も記載）
・残課題: この議題に残る未解決事項（expandedTopicsのopenIssues + discussionStructuresのremainingQuestions）
・次アクション: この議題から派生する次のアクション（あれば）

（議題ごとに●で区切る。各議題は上記の項目を含めること。該当がない項目は省略可。質疑応答は結論の背景が分かるものを複数件でも残し、雑談・相槌レベルのもののみ省く）

■重要ポイント
戦略的に重要な内容をまとめる（なぜ重要かの理由も補足する）

■課題・リスク
未解決課題や懸念事項（何にどう影響するかを明記する）

ルール:
- summaryは4000〜7000文字の詳細な議事録（A4用紙4〜6枚分）
- expandedTopicsとdiscussionStructuresの情報を最大限活用して密度の高い記述にする
- 会話順ではなく意味で整理
- 冗長な繰り返しは避けるが、具体的な議論内容は省略しない
- 数字・固有名詞・日付・担当者名は保持
- 決まっていないことを決定事項にしない（「未決」と明記する）
- 情報の捏造禁止（ただし会話の流れ上自然な具体化は許容）
- 該当情報がない項目は空配列・空文字
- nextScheduleは日付がわかる場合はYYYY年MM月DD日形式で記載
- 目的は「読みやすい要約」ではなく「後から読んだ人がそのまま動ける議事録」にすること
- 各議題の議論内容は必ず300文字以上書くこと
- 質疑応答は結論の背景・経緯・懸念が分かるものを複数件でも残す。雑談・相槌レベルのやりとりのみ除外する
- expandedTopicsのqAndAデータを活用し、結論に至った経緯や懸念が伝わるやりとりは省略せず記載する

今日の日付は ${TODAY()} です。${termPrompt}`;

    const userContent = JSON.stringify({
        topics: normalizedTopics,
        analysis: insights,
        expandedTopics,
        discussionStructures,
    });

    const result = await callLLM(systemPrompt, userContent, 12000);
    const parsed = safeParse(result, {
        customer: '', project: '', summary: '',
        decisions: [], todos: [], nextSchedule: '', keywords: [],
    });
    console.log('[MINUTES] STEP6完了: 議事録生成済み');
    return parsed;
}

// ─── メインAPI ───

export async function POST(req: NextRequest) {
    try {
        const contentType = req.headers.get('content-type') || '';
        let transcript: string;
        let chunkCount: number;
        let userId = '';
        let customer = '';

        if (contentType.includes('application/json')) {
            const body = await req.json();
            transcript = body.transcript;
            chunkCount = body.chunkCount;
            userId = body.user_id || '';
            customer = body.customer || '';
        } else {
            const text = await req.text();
            try {
                const body = JSON.parse(text);
                transcript = body.transcript;
                chunkCount = body.chunkCount;
                userId = body.user_id || '';
                customer = body.customer || '';
            } catch {
                return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
            }
        }

        if (!transcript || transcript.trim() === '') {
            return NextResponse.json({
                result: {
                    customer: '', project: '',
                    summary: '音声が認識できませんでした',
                    decisions: [], todos: [],
                    nextSchedule: '', keywords: []
                }
            });
        }

        // 用語辞書を取得
        const terms = userId ? await fetchTermDictionary(userId, customer) : [];
        const termPrompt = buildTermDictionaryPrompt(terms);
        if (terms.length > 0) {
            console.log(`[MINUTES] 用語辞書: ${terms.length}件 (user=${userId}, customer=${customer})`);
        }

        console.log(`[MINUTES] 六段ロケット開始: 文字起こし ${transcript.length}文字, ${chunkCount || 1}チャンク`);

        // STEP1: Topic抽出
        const topicsJson = await extractTopics(transcript, chunkCount || 1, termPrompt);

        // STEP2: 議題タイトル補正
        const normalizedTopics = await normalizeTopicTitles(topicsJson);

        // STEP3: 要点抽出
        const insights = await extractInsights(normalizedTopics);

        // STEP4: 議題内容の深堀り展開
        const expanded = await expandTopics(normalizedTopics, transcript);

        // STEP5: 論点構造抽出
        const structures = await extractDiscussionStructure(expanded, insights);

        // STEP6: 議事録生成
        const minutesResult = await generateFinalMinutes(normalizedTopics, insights, expanded, structures, termPrompt);

        console.log('[MINUTES] 六段ロケット完了');

        return NextResponse.json({
            result: minutesResult,
            transcriptLength: transcript.length,
            chunkCount: chunkCount || 1,
            // デバッグ用（本番では除去可）
            _debug: {
                topicCount: (normalizedTopics.topics as Array<unknown>)?.length || 0,
                decisionsCount: (insights.decisions as Array<unknown>)?.length || 0,
                confirmedTodosCount: (insights.confirmedTodos as Array<unknown>)?.length || 0,
                suggestedActionsCount: (insights.suggestedActions as Array<unknown>)?.length || 0,
                expandedTopicCount: (expanded.expandedTopics as Array<unknown>)?.length || 0,
                discussionStructureCount: (structures.discussionStructures as Array<unknown>)?.length || 0,
                finalTodosCount: ((minutesResult as Record<string, unknown>).todos as Array<unknown>)?.length || 0,
                summaryLength: ((minutesResult as Record<string, unknown>).summary as string)?.length || 0,
            },
        });

    } catch (error: unknown) {
        console.error('Minutes Generation Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
