import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 120; // 4ステップLLM呼び出しのため延長

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

// ─── STEP1: Topic抽出 ───

async function extractTopics(transcription: string, chunkCount: number): Promise<Record<string, unknown>> {
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
      "content": "この議題で話された内容の要約"
    }
  ]
}

ルール:
- 会話順ではなく意味で分類
- 類似する話題は統合
- 議題数は3〜6個
- 雑談は除外
- 議題タイトルは簡潔に
- 情報の捏造は禁止`;

    const result = await callLLM(systemPrompt, transcription);
    const parsed = safeParse(result, { topics: [] });
    console.log(`[MINUTES] STEP1完了: ${(parsed.topics as Array<unknown>)?.length || 0} 議題抽出`);
    return parsed;
}

// ─── STEP1.5: 議題タイトル補正 ───

async function normalizeTopicTitles(topicsJson: Record<string, unknown>): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP1.5: 議題タイトル補正 開始');
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
    console.log('[MINUTES] STEP1.5完了: タイトル補正済み');
    return parsed;
}

// ─── STEP2: 要点抽出 ───

async function extractInsights(normalizedTopics: Record<string, unknown>): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP2: 要点抽出 開始');
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

■ decisions: 会議で明確に決まった事項のみ。決まっていないことは含めない。最大5件。

■ confirmedTodos: 会議中で明確に「やる」「対応する」「修正する」等と述べられた作業。最大10件。
  例: 「〇〇を修正する」「来週までに資料を送る」「APIを差し替える」「テストを実施する」

■ suggestedActions: 明言は弱いが、会話の流れ上ほぼ必要と判断できる次アクション。最大10件。
  捏造ではなく、会話内容から自然に導ける範囲に限定する。根拠が弱いものは入れない。
  例: 「要件整理が必要」「UI文言の確認が必要」「実装後の動作確認が必要」「関係者への共有が必要」

■ confirmedTodos / suggestedActions の記載ルール:
  - 可能なら「誰が / 何を」の形にする
  - 誰が不明でも、やることは具体的に書く
  - 抽象語のみは禁止（「対応する」「進める」だけはNG）
  - できるだけ行動単位に分解する
    悪い例: 「アプリ改善」
    良い例: 「音声再生の倍速設定をチャンク切替後も維持するよう修正する」
  - confirmedTodosとsuggestedActionsの重複禁止

■ nextSchedule: 次回予定がある場合はYYYY年MM月DD日形式で記載。曜日があれば含める。不明なら空文字。

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
    console.log(`[MINUTES] STEP2完了: confirmed=${(parsed.confirmedTodos as Array<unknown>)?.length || 0}, suggested=${(parsed.suggestedActions as Array<unknown>)?.length || 0}`);
    return parsed;
}

// ─── STEP3: 議事録生成 ───

async function generateFinalMinutes(
    normalizedTopics: Record<string, unknown>,
    insights: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    console.log('[MINUTES] STEP3: 議事録生成 開始');
    const systemPrompt = `あなたはプロフェッショナルな議事録作成者です。
以下の情報をもとに会議議事録を作成してください。

入力データには以下が含まれます:
- topics: 議題一覧
- analysis: 要点分析結果
  - analysis.confirmedTodos: 会議で明確に述べられたタスク
  - analysis.suggestedActions: 会話の流れ上必要と判断される次アクション

出力は **有効なJSONのみ** を返してください。

出力形式:
{
  "customer": "顧客名・会社名（不明な場合は空文字）",
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

■ summaryは以下の構造で記述してください:

■会議概要
会議の背景・目的を1〜2文で記述

■主な議題

●議題1のタイトル
・議論内容を詳細に記述
・結論や方針

●議題2のタイトル
・議論内容を詳細に記述
・結論や方針

（議題ごとに●で区切る）

■重要ポイント
戦略的に重要な内容をまとめる

■課題・リスク
未解決課題や懸念事項

ルール:
- summaryはA4用紙2〜3枚分（2000〜3000文字程度）の詳細な内容
- 会話順ではなく意味で整理
- 冗長な会話は削除し、要点を残す
- 数字・固有名詞・日付は保持
- 決まっていないことを決定事項にしない
- 情報の捏造禁止
- 該当情報がない項目は空配列・空文字
- nextScheduleは日付がわかる場合はYYYY年MM月DD日形式で記載

今日の日付は ${TODAY()} です。`;

    const userContent = JSON.stringify({
        topics: normalizedTopics,
        analysis: insights,
    });

    const result = await callLLM(systemPrompt, userContent, 8000);
    const parsed = safeParse(result, {
        customer: '', project: '', summary: '',
        decisions: [], todos: [], nextSchedule: '', keywords: [],
    });
    console.log('[MINUTES] STEP3完了: 議事録生成済み');
    return parsed;
}

// ─── メインAPI ───

export async function POST(req: NextRequest) {
    try {
        const contentType = req.headers.get('content-type') || '';
        let transcript: string;
        let chunkCount: number;

        if (contentType.includes('application/json')) {
            const body = await req.json();
            transcript = body.transcript;
            chunkCount = body.chunkCount;
        } else {
            const text = await req.text();
            try {
                const body = JSON.parse(text);
                transcript = body.transcript;
                chunkCount = body.chunkCount;
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

        console.log(`[MINUTES] 三段ロケット開始: 文字起こし ${transcript.length}文字, ${chunkCount || 1}チャンク`);

        // STEP1: Topic抽出
        const topicsJson = await extractTopics(transcript, chunkCount || 1);

        // STEP1.5: 議題タイトル補正
        const normalizedTopics = await normalizeTopicTitles(topicsJson);

        // STEP2: 要点抽出
        const insights = await extractInsights(normalizedTopics);

        // STEP3: 議事録生成
        const minutesResult = await generateFinalMinutes(normalizedTopics, insights);

        console.log('[MINUTES] 三段ロケット完了');

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
                finalTodosCount: ((minutesResult as Record<string, unknown>).todos as Array<unknown>)?.length || 0,
            },
        });

    } catch (error: unknown) {
        console.error('Minutes Generation Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
