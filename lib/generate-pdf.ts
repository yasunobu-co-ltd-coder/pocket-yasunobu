import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface PdfMinutesData {
    meetingName: string;
    createdAt?: string;
    creatorName?: string;
    summary: string;
    decisions?: string[];
    todos?: string[];
    nextSchedule?: string;
    keywords?: string[];
}

// A4 レイアウト定数 (mm)
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 24;
const MARGIN_LEFT = 14;
const MARGIN_RIGHT = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
const PAGE_NUMBER_Y = PAGE_HEIGHT - 12;

// レンダリング用の幅 (px) — A4 96dpi相当
const RENDER_WIDTH = 794;
const RENDER_PADDING = 50; // 左右パディング (px)
const RENDER_INNER_WIDTH = RENDER_WIDTH - RENDER_PADDING * 2;

// px → mm 変換係数（レンダリング内部幅 → PDF内容幅）
const PX_TO_MM = CONTENT_WIDTH / RENDER_INNER_WIDTH;

// html2canvas スケール
const CANVAS_SCALE = 2;

// 共通フォントファミリー
const FONT_FAMILY = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';

// 共通スタイル（各ブロックに適用）
const BASE_STYLES = `
    font-family: ${FONT_FAMILY};
    color: #1e293b;
    line-height: 1.8;
    box-sizing: border-box;
    word-break: break-word;
    overflow-wrap: break-word;
`;

/**
 * summary テキストを構造化 HTML ブロック配列に変換
 * ■セクション / ●議題 / ・項目 を認識してブロック分割
 */
function parseSummaryToBlocks(summary: string): string[] {
    const blocks: string[] = [];
    const lines = summary.split('\n');
    let currentBlock = '';
    let currentType: 'section' | 'topic' | 'paragraph' = 'paragraph';

    const flushBlock = () => {
        const trimmed = currentBlock.trim();
        if (!trimmed) return;

        if (currentType === 'section') {
            blocks.push(`<div class="section-block" style="margin-bottom: 20px;">
                <div style="font-size: 16px; font-weight: 800; color: #1e293b; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">${escapeHtml(trimmed)}</div>
            </div>`);
        } else if (currentType === 'topic') {
            // 議題ブロック: タイトル行と内容を分離
            const topicLines = trimmed.split('\n');
            const title = topicLines[0];
            const content = topicLines.slice(1).join('\n').trim();
            let contentHtml = '';
            if (content) {
                // ・項目ごとに段落分割
                contentHtml = formatTopicContent(content);
            }
            blocks.push(`<div class="topic-block" style="margin-bottom: 18px; padding-left: 4px;">
                <div style="font-size: 15px; font-weight: 700; color: #4c1d95; margin-bottom: 8px;">${escapeHtml(title)}</div>
                ${contentHtml}
            </div>`);
        } else {
            // 通常段落: 句点で2〜4文ごとに分割
            const paragraphs = splitIntoParagraphs(trimmed);
            for (const p of paragraphs) {
                blocks.push(`<div class="para-block" style="margin-bottom: 10px;">
                    <div style="font-size: 14px; line-height: 1.9;">${escapeHtml(p)}</div>
                </div>`);
            }
        }
        currentBlock = '';
    };

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
            // 空行 → 現在のブロックをフラッシュ
            flushBlock();
            continue;
        }

        // ■セクション見出し
        if (trimmedLine.startsWith('■')) {
            flushBlock();
            currentType = 'section';
            currentBlock = trimmedLine;
            flushBlock();
            continue;
        }

        // ●議題見出し
        if (trimmedLine.startsWith('●')) {
            flushBlock();
            currentType = 'topic';
            currentBlock = trimmedLine;
            continue;
        }

        // 議題ブロック内の継続行
        if (currentType === 'topic') {
            currentBlock += '\n' + trimmedLine;
            continue;
        }

        // 通常段落
        if (currentType !== 'paragraph') {
            flushBlock();
            currentType = 'paragraph';
        }
        currentBlock += (currentBlock ? '\n' : '') + trimmedLine;
    }
    flushBlock();

    return blocks;
}

/**
 * 議題内容をフォーマット
 * ・項目を認識して構造化
 */
function formatTopicContent(content: string): string {
    const lines = content.split('\n');
    let html = '';
    let currentItemLabel = '';
    let currentItemContent = '';

    const flushItem = () => {
        if (!currentItemLabel && !currentItemContent) return;
        if (currentItemLabel) {
            html += `<div style="margin-bottom: 6px; font-size: 14px; line-height: 1.9;">
                <span style="font-weight: 600; color: #6d28d9;">${escapeHtml(currentItemLabel)}</span>
                ${escapeHtml(currentItemContent)}
            </div>`;
        } else {
            html += `<div style="margin-bottom: 6px; font-size: 14px; line-height: 1.9;">${escapeHtml(currentItemContent)}</div>`;
        }
        currentItemLabel = '';
        currentItemContent = '';
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // ・項目: ラベルを検出
        const itemMatch = trimmed.match(/^[・\-]\s*(.+?)[:：]\s*(.*)$/);
        if (itemMatch) {
            flushItem();
            currentItemLabel = `・${itemMatch[1]}: `;
            currentItemContent = itemMatch[2];
        } else if (trimmed.startsWith('・') || trimmed.startsWith('-')) {
            flushItem();
            currentItemLabel = '';
            currentItemContent = trimmed;
        } else {
            // 継続行
            currentItemContent += currentItemContent ? ' ' + trimmed : trimmed;
        }
    }
    flushItem();

    return html;
}

/**
 * 長文を句点・改行で2〜4文ごとに段落分割
 */
function splitIntoParagraphs(text: string): string[] {
    // 改行で分割してから、各行を句点で再分割
    const sentences: string[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // 句点で分割（句点は残す）
        const parts = trimmed.split(/(?<=[。！？])\s*/);
        sentences.push(...parts.filter(p => p.trim()));
    }

    if (sentences.length <= 3) {
        return [sentences.join('')];
    }

    // 2〜3文ごとにグループ化
    const paragraphs: string[] = [];
    let current = '';
    let count = 0;
    for (const s of sentences) {
        current += s;
        count++;
        if (count >= 3) {
            paragraphs.push(current);
            current = '';
            count = 0;
        }
    }
    if (current) paragraphs.push(current);
    return paragraphs;
}

/**
 * HTML ブロックを1つレンダリングしてキャンバスを返す
 */
async function renderBlock(html: string, containerWidth: number): Promise<HTMLCanvasElement> {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.left = '-9999px';
    div.style.top = '0';
    div.style.width = `${containerWidth}px`;
    div.style.background = '#fff';
    div.style.padding = '0';
    div.style.cssText += BASE_STYLES;
    div.innerHTML = html;
    document.body.appendChild(div);

    try {
        const canvas = await html2canvas(div, {
            scale: CANVAS_SCALE,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: containerWidth,
        });
        return canvas;
    } finally {
        document.body.removeChild(div);
    }
}

/**
 * ブロックのキャンバスの高さ (mm)
 */
function canvasHeightMm(canvas: HTMLCanvasElement): number {
    return (canvas.height / CANVAS_SCALE) * PX_TO_MM;
}

export async function generateMinutesPdf(data: PdfMinutesData): Promise<void> {
    const dateStr = data.createdAt
        ? new Date(data.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });

    // ─── ブロック生成 ───

    const allBlocks: string[] = [];

    // ヘッダー（タイトル + メタ情報テーブル）
    allBlocks.push(`
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="font-size: 28px; font-weight: 800; letter-spacing: 8px; color: #1e293b;">議 事 録</div>
            <div style="width: 60px; height: 3px; background: #7c3aed; margin: 8px auto 0;"></div>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <tr>
                <td style="padding: 10px 16px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 700; width: 100px; color: #64748b;">会議名</td>
                <td style="padding: 10px 16px; border: 1px solid #e2e8f0;">${escapeHtml(data.meetingName || '名称なし')}</td>
            </tr>
            <tr>
                <td style="padding: 10px 16px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 700; color: #64748b;">作成日</td>
                <td style="padding: 10px 16px; border: 1px solid #e2e8f0;">${dateStr}</td>
            </tr>
            ${data.creatorName ? `
            <tr>
                <td style="padding: 10px 16px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 700; color: #64748b;">作成者</td>
                <td style="padding: 10px 16px; border: 1px solid #e2e8f0;">${escapeHtml(data.creatorName)}</td>
            </tr>
            ` : ''}
        </table>
    `);

    // 「内容」セクション見出し
    allBlocks.push(`
        <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">内容</div>
    `);

    // Summary を構造化ブロックに分割
    if (data.summary) {
        const summaryBlocks = parseSummaryToBlocks(data.summary);
        allBlocks.push(...summaryBlocks);
    }

    // 決定事項
    if (data.decisions && data.decisions.length > 0) {
        allBlocks.push(`
            <div class="decision-block" style="margin-top: 16px; margin-bottom: 16px;">
                <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">決定事項</div>
                <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
                    ${data.decisions.map(d => `<li style="margin-bottom: 6px; line-height: 1.8;">${escapeHtml(d)}</li>`).join('')}
                </ul>
            </div>
        `);
    }

    // TODO
    if (data.todos && data.todos.length > 0) {
        allBlocks.push(`
            <div class="todo-block" style="margin-top: 16px; margin-bottom: 16px;">
                <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">TODO</div>
                <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
                    ${data.todos.map(t => `<li style="margin-bottom: 6px; line-height: 1.8;">${escapeHtml(t)}</li>`).join('')}
                </ul>
            </div>
        `);
    }

    // 次回予定
    if (data.nextSchedule) {
        allBlocks.push(`
            <div style="margin-top: 16px; margin-bottom: 16px;">
                <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">次回予定</div>
                <div style="font-size: 14px; line-height: 1.8;">${escapeHtml(data.nextSchedule)}</div>
            </div>
        `);
    }

    // キーワード
    if (data.keywords && data.keywords.length > 0) {
        allBlocks.push(`
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                <span style="font-size: 12px; color: #94a3b8;">
                    ${data.keywords.map(k => `<span style="display: inline-block; background: #f1f5f9; padding: 3px 10px; border-radius: 12px; margin-right: 6px; margin-bottom: 4px;">#${escapeHtml(k)}</span>`).join('')}
                </span>
            </div>
        `);
    }

    // ─── 各ブロックをレンダリング ───

    const renderedBlocks: { canvas: HTMLCanvasElement; heightMm: number }[] = [];
    for (const blockHtml of allBlocks) {
        const canvas = await renderBlock(blockHtml, RENDER_INNER_WIDTH);
        renderedBlocks.push({
            canvas,
            heightMm: canvasHeightMm(canvas),
        });
    }

    // ─── PDF に配置（ブロック単位で改ページ判定）───

    const pdf = new jsPDF('p', 'mm', 'a4');
    let currentY = MARGIN_TOP;
    let pageNum = 1;

    for (const block of renderedBlocks) {
        const blockH = block.heightMm;

        // ブロックが残りスペースに収まらない場合 → 改ページ
        // ただしブロックがページ全体より大きい場合は現在位置から開始（分割許容）
        if (currentY + blockH > MARGIN_TOP + CONTENT_HEIGHT && currentY > MARGIN_TOP) {
            pdf.addPage();
            pageNum++;
            currentY = MARGIN_TOP;
        }

        // ブロックが1ページに収まる場合
        if (blockH <= CONTENT_HEIGHT) {
            const imgW = CONTENT_WIDTH;
            const imgH = (block.canvas.height * imgW) / block.canvas.width;
            pdf.addImage(
                block.canvas.toDataURL('image/png'), 'PNG',
                MARGIN_LEFT, currentY,
                imgW, imgH,
            );
            currentY += blockH;
        } else {
            // 巨大ブロック: ページをまたいで描画（画像クリッピング方式）
            const imgW = CONTENT_WIDTH;
            const imgH = (block.canvas.height * imgW) / block.canvas.width;
            let remainH = blockH;
            let offsetY = 0;

            while (remainH > 0) {
                const spaceLeft = MARGIN_TOP + CONTENT_HEIGHT - currentY;
                const drawH = Math.min(remainH, spaceLeft);

                // キャンバスから該当部分を切り出し
                const srcYPx = Math.round(offsetY / PX_TO_MM * CANVAS_SCALE);
                const srcHPx = Math.round(drawH / PX_TO_MM * CANVAS_SCALE);
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = block.canvas.width;
                sliceCanvas.height = srcHPx;
                const ctx = sliceCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(
                        block.canvas,
                        0, srcYPx, block.canvas.width, srcHPx,
                        0, 0, block.canvas.width, srcHPx,
                    );
                }

                const sliceImgH = (sliceCanvas.height * imgW) / sliceCanvas.width;
                pdf.addImage(
                    sliceCanvas.toDataURL('image/png'), 'PNG',
                    MARGIN_LEFT, currentY,
                    imgW, sliceImgH,
                );

                remainH -= drawH;
                offsetY += drawH;
                currentY += drawH;

                if (remainH > 0) {
                    pdf.addPage();
                    pageNum++;
                    currentY = MARGIN_TOP;
                }
            }
        }
    }

    // ─── ページ番号 ───

    const totalPages = pageNum;
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`${i}`, PAGE_WIDTH / 2, PAGE_NUMBER_Y, { align: 'center' });
    }

    const fileName = `議事録_${data.meetingName || '名称なし'}_${dateStr.replace(/\//g, '')}.pdf`;
    pdf.save(fileName);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
