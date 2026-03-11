/**
 * TTS用テキスト分割ユーティリティ
 * 議事録テキストを30〜60文字のチャンクに分割する（上限80文字）
 * 1GB VPSでのVOICEVOX推論メモリ不足を回避するため極小チャンクサイズ
 * 文の区切り（。！？\n）や見出し記号を優先して自然な位置で分割
 */

const MIN_CHUNK_SIZE = 30;
const MAX_CHUNK_SIZE = 60;
const HARD_MAX = 80;

// 文の区切りとして認識する文字（優先度順）
const SENTENCE_DELIMITERS = ['\n\n', '\n', '。', '！', '？', '、'];

/**
 * テキストの前処理：不要な記号や連続改行を正規化
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    // 連続改行を最大2つに
    .replace(/\n{3,}/g, '\n\n')
    // 連続スペース・タブを1つに
    .replace(/[ \t]+/g, ' ')
    // 見出し記号の前に改行を確保（■●▶ など）
    .replace(/([^\n])(■|●|▶|◆|★|【)/g, '$1\n$2')
    .trim();
}

/**
 * テキストを自然な文の区切りでチャンクに分割する
 */
export function splitTextIntoChunks(text: string): string[] {
  // 前処理：不要な記号・連続改行を正規化
  const normalized = normalizeText(text);

  if (!normalized) return [];
  if (normalized.length <= HARD_MAX) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > 0) {
    if (remaining.length <= HARD_MAX) {
      chunks.push(remaining.trim());
      break;
    }

    // MAX_CHUNK_SIZE以内で最も後ろの文区切りを探す
    let splitPos = -1;

    for (const delimiter of SENTENCE_DELIMITERS) {
      const searchRange = remaining.slice(MIN_CHUNK_SIZE, MAX_CHUNK_SIZE);
      const lastIndex = searchRange.lastIndexOf(delimiter);
      if (lastIndex !== -1) {
        const pos = MIN_CHUNK_SIZE + lastIndex + delimiter.length;
        if (pos > splitPos) {
          splitPos = pos;
        }
      }
    }

    // MIN_CHUNK_SIZE より前にも区切りがあれば探す（MAX内で見つからなかった場合）
    if (splitPos === -1) {
      for (const delimiter of SENTENCE_DELIMITERS) {
        const searchRange = remaining.slice(0, MAX_CHUNK_SIZE);
        const lastIndex = searchRange.lastIndexOf(delimiter);
        if (lastIndex !== -1 && lastIndex > 0) {
          const pos = lastIndex + delimiter.length;
          if (pos > splitPos) {
            splitPos = pos;
          }
        }
      }
    }

    // それでも見つからない場合、MAX_CHUNK_SIZEで強制分割
    if (splitPos === -1 || splitPos === 0) {
      splitPos = MAX_CHUNK_SIZE;
    }

    const chunk = remaining.slice(0, splitPos).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitPos);
  }

  return chunks;
}

/**
 * テキストのSHA-256ハッシュを生成する（ブラウザ/Node.js両対応）
 */
export async function generateTextHash(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Node.js fallback
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text).digest('hex');
}
