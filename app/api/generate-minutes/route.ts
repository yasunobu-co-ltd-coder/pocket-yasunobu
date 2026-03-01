import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

        const systemPrompt = `
あなたは優秀な現場秘書です。以下の音声認識テキストから「議事録」を作成してください。
${chunkCount > 1 ? `※この音声は${chunkCount}つのパートに分割されて文字起こしされています。全体を通して一貫した議事録を作成してください。` : ''}

以下のJSON形式で出力してください（必ず有効なJSONのみを返してください）。

{
  "customer": "顧客名・会社名（不明な場合は空文字）",
  "project": "案件名・用件（推測できる場合）",
  "summary": "議事録の概要（簡潔に）",
  "decisions": ["決定事項1", "決定事項2"],
  "todos": ["タスク1", "タスク2"],
  "nextSchedule": "次回予定（日時など）",
  "keywords": ["タグ1", "タグ2"]
}

【重要な指示】
- decisions: 決定事項を最大5個まで抽出。なければ空配列。
- todos: やるべきことを最大5個まで抽出。なければ空配列。
- keywords: キーワードを最大5個まで。なければ空配列。
- 情報の捏造はせず、話されている内容に基づいて抽出してください。
- 該当する情報がない項目は空配列や空文字で返してください。

今日の日付は ${new Date().toLocaleDateString('ja-JP')} です。
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: transcript }
            ],
            response_format: { type: "json_object" },
            max_tokens: 4000
        });

        let resultJson = {};
        try {
            resultJson = JSON.parse(completion.choices[0].message.content || '{}');
        } catch {
            resultJson = {
                customer: '', project: '',
                summary: completion.choices[0].message.content || '',
                decisions: [], todos: [],
                nextSchedule: '', keywords: []
            };
        }

        return NextResponse.json({
            result: resultJson,
            transcriptLength: transcript.length,
            chunkCount: chunkCount || 1
        });

    } catch (error: unknown) {
        console.error('Minutes Generation Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
