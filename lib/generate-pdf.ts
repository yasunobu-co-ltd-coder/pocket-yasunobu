import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface PdfMinutesData {
    customerName: string;
    createdAt?: string;
    creatorName?: string;
    summary: string;
    decisions?: string[];
    todos?: string[];
    nextSchedule?: string;
    keywords?: string[];
}

export async function generateMinutesPdf(data: PdfMinutesData): Promise<void> {
    const dateStr = data.createdAt
        ? new Date(data.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });

    // Create a hidden container for rendering
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '794px'; // A4 width at 96dpi
    container.style.background = '#fff';
    container.style.padding = '60px 50px';
    container.style.fontFamily = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
    container.style.color = '#1e293b';
    container.style.lineHeight = '1.8';
    container.style.boxSizing = 'border-box';

    // Build HTML content
    let html = `
        <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 28px; font-weight: 800; letter-spacing: 8px; margin: 0 0 8px 0; color: #1e293b;">議 事 録</h1>
            <div style="width: 60px; height: 3px; background: #7c3aed; margin: 0 auto;"></div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px; font-size: 14px;">
            <tr>
                <td style="padding: 10px 16px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 700; width: 100px; color: #64748b;">顧客名</td>
                <td style="padding: 10px 16px; border: 1px solid #e2e8f0;">${escapeHtml(data.customerName || '名称なし')}</td>
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
    `;

    // Summary section
    html += `
        <div style="margin-bottom: 24px;">
            <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">内容</div>
            <div style="font-size: 14px; white-space: pre-wrap; line-height: 1.9;">${escapeHtml(data.summary)}</div>
        </div>
    `;

    // Decisions
    if (data.decisions && data.decisions.length > 0) {
        html += `
            <div style="margin-bottom: 24px;">
                <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">決定事項</div>
                <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
                    ${data.decisions.map(d => `<li style="margin-bottom: 6px;">${escapeHtml(d)}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // TODOs
    if (data.todos && data.todos.length > 0) {
        html += `
            <div style="margin-bottom: 24px;">
                <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">TODO</div>
                <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
                    ${data.todos.map(t => `<li style="margin-bottom: 6px;">${escapeHtml(t)}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // Next schedule
    if (data.nextSchedule) {
        html += `
            <div style="margin-bottom: 24px;">
                <div style="font-size: 15px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe;">次回予定</div>
                <div style="font-size: 14px;">${escapeHtml(data.nextSchedule)}</div>
            </div>
        `;
    }

    // Keywords
    if (data.keywords && data.keywords.length > 0) {
        html += `
            <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                <span style="font-size: 12px; color: #94a3b8;">
                    ${data.keywords.map(k => `<span style="display: inline-block; background: #f1f5f9; padding: 3px 10px; border-radius: 12px; margin-right: 6px; margin-bottom: 4px;">#${escapeHtml(k)}</span>`).join('')}
                </span>
            </div>
        `;
    }

    container.innerHTML = html;
    document.body.appendChild(container);

    try {
        const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
        });

        const imgWidth = 210; // A4 width in mm
        const pageHeight = 297; // A4 height in mm
        const margin = 10;
        const contentWidth = imgWidth - margin * 2;
        const imgHeight = (canvas.height * contentWidth) / canvas.width;

        const pdf = new jsPDF('p', 'mm', 'a4');
        let heightLeft = imgHeight;
        let position = margin;

        // First page
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, position, contentWidth, imgHeight);
        heightLeft -= (pageHeight - margin * 2);

        // Additional pages if content overflows
        while (heightLeft > 0) {
            position = -(pageHeight - margin * 2) + margin + (imgHeight - heightLeft - (pageHeight - margin * 2));
            pdf.addPage();
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin - (imgHeight - heightLeft), contentWidth, imgHeight);
            heightLeft -= (pageHeight - margin * 2);
        }

        const fileName = `議事録_${data.customerName || '名称なし'}_${dateStr.replace(/\//g, '')}.pdf`;
        pdf.save(fileName);
    } finally {
        document.body.removeChild(container);
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
