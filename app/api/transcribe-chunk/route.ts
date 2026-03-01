import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const chunkIndex = formData.get('chunkIndex') as string;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        console.log(`Chunk ${chunkIndex} info:`, {
            name: file.name,
            type: file.type,
            size: file.size
        });

        const MAX_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            return NextResponse.json({
                error: `ファイルサイズが大きすぎます (${(file.size / 1024 / 1024).toFixed(1)}MB > 25MB)`
            }, { status: 400 });
        }

        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: 'whisper-1',
            language: 'ja',
        });

        console.log(`Chunk ${chunkIndex} transcribed: ${transcription.text.substring(0, 100)}...`);

        return NextResponse.json({
            chunkIndex: parseInt(chunkIndex || '0'),
            text: transcription.text
        });

    } catch (error: unknown) {
        console.error('Chunk Transcription Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
