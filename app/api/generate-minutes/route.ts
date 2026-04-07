import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LLM_MODEL = 'claude-sonnet-4-20250514';
const LLM_TEMPERATURE = 0.2;
const TODAY = () => new Date().toLocaleDateString('ja-JP');

// ─── 用語辞書 ───

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

// ─── CALL1: 議事録テキスト生成 ───

const MINUTES_SYSTEM_PROMPT = `あなたは音声文字起こしテキストを整形する専門家です。
音声認識による誤変換・脱落・繰り返しを含む生テキストを受け取り、
会議議事録として読みやすく整理されたテキストを生成してください。

## 基本ルール

1. **原文尊重**: 話者の意図・語り口調・内容の流れをできるだけ維持する。情報を追加したり、意見を変えたりしない。
2. **誤認識修正**: 音声認識による明らかな誤変換（固有名詞の誤り、同音異義語の取り違い）を文脈から推測して修正する。
3. **繰り返し除去**: 言い直し・フィラー（「えーと」「あのー」）・無意味な繰り返しを除去する。
4. **文の接続**: 途切れた文を前後の文脈からつなぎ、自然な日本語にする。意味が取れない箇所は無理に補わず省略する。
5. **句読点・改行**: 適切に句読点を打ち、話題の切れ目で改行を入れて読みやすくする。
6. **推測補完の透明性**: 文脈から大きく推測して補った箇所は、末尾の注記で簡潔に示す。

## 出力形式（会議議事録）

複数人の会議・ミーティング向け。

- 冒頭に日時・参加者・議題（文字起こしから読み取れる範囲で）を記載。読み取れない項目は「不明」と記載。
- 本文は議題ごとにセクション分けする。
- 各セクション末尾に「決定事項」「TODO」があれば箇条書きで抽出する。
- 末尾に全体の「決定事項まとめ」「TODOまとめ」を付ける。
- 質疑応答のやりとりが含まれる場合、結論の背景・経緯・懸念が分かるものを Q: / A: 形式で残す。雑談・相槌レベルは除外する。
- TODOは「誰が / 何を / 何のために」を可能な限り含める。

- 3人以上の意見の相違がある場合、ステークホルダー整理を表形式で記載する:
  | 氏名・役職 | スタンス（推進派/懐疑派/中立） | 主な意見・懸念 |
- 会議の流れ上確認・合意されたステップがある場合、末尾に「次回に向けたアクションプラン」を追記する:
  ステップ1: 〇〇（目的・内容）
  ステップ2: 〇〇（目的・内容）

出力形式の例:
【会議議事録】
日時: YYYY年MM月DD日
参加者: ○○、△△（不明な場合は「不明」）
議題: ○○について

▶ 議題1: タイトル
整理された議論内容...
（Q&Aがある場合）
Q: ○○「質問内容」
A: △△「回答内容」
【決定事項】
- ...
【TODO】
- 担当: ○○ / 内容: ...

---
▶ 全体まとめ
【決定事項】
- ...
【TODO】
- ...
【次回予定】
YYYY年MM月DD日（不明なら記載なし）

【次回に向けたアクションプラン】（該当する場合のみ）
ステップ1: ...
ステップ2: ...`;

async function generateMinutesSummary(transcript: string, termPrompt: string): Promise<string> {
    console.log('[MINUTES] CALL1: 議事録テキスト生成 開始 (Claude)');
    const userMessage = `output_format: minutes

以下の文字起こしテキストを整形して会議議事録を作成してください。
今日の日付は ${TODAY()} です。${termPrompt}

---
${transcript}
---`;

    const message = await anthropic.messages.create({
        model: LLM_MODEL,
        temperature: LLM_TEMPERATURE,
        max_tokens: 8192,
        system: MINUTES_SYSTEM_PROMPT,
        messages: [
            { role: 'user', content: userMessage },
        ],
    });

    const text = message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
    console.log(`[MINUTES] CALL1完了: ${text.length}文字`);
    return text;
}

// ─── CALL2: 構造化データ抽出 ───

async function extractStructuredData(minutesText: string): Promise<Record<string, unknown>> {
    console.log('[MINUTES] CALL2: 構造化データ抽出 開始 (Claude)');
    const systemPrompt = `以下の会議議事録テキストから構造化データをJSONで抽出してください。
出力は有効なJSONのみを返してください。マークダウンのコードブロックは使わず、JSONテキストだけを出力してください。

出力形式:
{
  "customer": "会議名・顧客名（不明なら空文字）",
  "project": "案件名・用件（推測できる場合。不明なら空文字）",
  "decisions": ["決定事項1", "決定事項2"],
  "todos": ["誰が / 何を のタスク1", "タスク2"],
  "nextSchedule": "YYYY年MM月DD日（曜日）形式。不明なら空文字",
  "keywords": ["キーワード1", "キーワード2"]
}

ルール:
- decisions: 「決定事項」セクションの内容をそのまま抽出（最大10件）
- todos: 「TODO」セクションの内容をそのまま抽出（最大10件）
- nextSchedule: 「次回予定」の日付をYYYY年MM月DD日形式に変換
- keywords: 議題・テーマから重要なキーワードを5個以内で抽出
- 該当がない項目は空配列・空文字`;

    const message = await anthropic.messages.create({
        model: LLM_MODEL,
        temperature: 0,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
            { role: 'user', content: minutesText },
        ],
    });

    const rawText = message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

    // JSONパース（コードブロック除去対応）
    const jsonStr = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = (() => { try { return JSON.parse(jsonStr); } catch { return {}; } })();
    console.log('[MINUTES] CALL2完了');
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
            const bodyText = await req.text();
            try {
                const body = JSON.parse(bodyText);
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

        const terms = userId ? await fetchTermDictionary(userId, customer) : [];
        const termPrompt = buildTermDictionaryPrompt(terms);
        if (terms.length > 0) {
            console.log(`[MINUTES] 用語辞書: ${terms.length}件 (user=${userId}, customer=${customer})`);
        }

        console.log(`[MINUTES] 開始: 文字起こし ${transcript.length}文字, ${chunkCount || 1}チャンク`);

        // CALL1: 議事録テキスト生成（Claude）
        const summary = await generateMinutesSummary(transcript, termPrompt);

        // CALL2: 構造化データ抽出（Claude）
        const structured = await extractStructuredData(summary);

        const result = {
            customer: (structured.customer as string) || customer || '',
            project: (structured.project as string) || '',
            summary,
            decisions: (structured.decisions as string[]) || [],
            todos: (structured.todos as string[]) || [],
            nextSchedule: (structured.nextSchedule as string) || '',
            keywords: (structured.keywords as string[]) || [],
        };

        console.log('[MINUTES] 完了');

        return NextResponse.json({
            result,
            transcriptLength: transcript.length,
            chunkCount: chunkCount || 1,
        });

    } catch (error: unknown) {
        console.error('Minutes Generation Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
