import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type CleanupFormat = 'structured' | 'summary' | 'verbatim';

const SYSTEM_PROMPT = `あなたは音声文字起こしテキストを整形する専門家です。
音声認識による誤変換・脱落・繰り返しを含む生テキストを受け取り、
指定された出力形式に従って、読みやすく整理されたテキストを生成してください。

## 基本ルール（全形式共通）

1. **原文尊重**: 話者の意図・語り口調・内容の流れをできるだけ維持する。情報を追加したり、意見を変えたりしない。
2. **誤認識修正**: 音声認識による明らかな誤変換（例: 固有名詞の誤り、同音異義語の取り違い）を文脈から推測して修正する。
3. **繰り返し除去**: 言い直し・フィラー（「えーと」「あのー」）・無意味な繰り返しを除去する。
4. **文の接続**: 途切れた文を前後の文脈からつなぎ、自然な日本語にする。意味が取れない箇所は無理に補わず省略する。
5. **句読点・改行**: 適切に句読点を打ち、話題の切れ目で改行を入れて読みやすくする。
6. **推測補完の透明性**: 文脈から大きく推測して補った箇所は、末尾の注記で簡潔に示す。
7. **マークダウン禁止**: 出力テキストに **太字** や # 見出し などのマークダウン記法は一切使わないこと。▶ や【】などの記号で構造化する。

## 出力形式（output_format）

ユーザーから以下のいずれかが指定されます。

---

### "structured"（見出し付き整形）
講演・セミナー・勉強会など、一人の話者が長く話す内容向け。

- テーマごとに「▶ 見出し」で区切る
- 話者の語り口調を活かしつつ、文章として読めるレベルに整える
- 見出しは内容から自然につける（5〜15文字程度）

出力例:
▶ 最初のテーマ
整理された本文...

▶ 次のテーマ
整理された本文...

---

### "summary"（要約）
長い文字起こしをコンパクトにまとめたい場合。

- 全体を元の1/5〜1/3程度に圧縮
- 要点を箇条書き or 短い段落で整理
- 冒頭に1〜2文の概要を付ける
- 詳細な表現や具体例は省略してよい

出力例:
【概要】
〇〇についての内容。△△と■■が主なテーマ。

▶ ポイント
- ...
- ...

---

### "verbatim"（ほぼ原文）
できるだけ原文に忠実に、最低限の整形だけ行う。

- フィラー・言い直し・無意味な繰り返しのみ除去
- 文の構造はほぼそのまま
- 誤変換の修正は行う
- 見出しは付けない
- 改行は話題の大きな切れ目のみ

---

## 言語

入力テキストの言語に合わせて出力する。日本語の文字起こしなら日本語で出力。`;

export async function POST(req: NextRequest) {
    try {
        const { transcript, format } = await req.json() as {
            transcript: string;
            format: CleanupFormat;
        };

        if (!transcript?.trim()) {
            return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
        }
        if (!['structured', 'summary', 'verbatim'].includes(format)) {
            return NextResponse.json({ error: 'invalid format' }, { status: 400 });
        }

        const userMessage = `output_format: ${format}

以下の文字起こしテキストを整形してください。

---
${transcript}
---`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            temperature: 0.2,
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: userMessage },
            ],
        });

        const cleaned = response.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('') || transcript;
        return NextResponse.json({ text: cleaned });

    } catch (error: unknown) {
        console.error('Cleanup transcript error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
