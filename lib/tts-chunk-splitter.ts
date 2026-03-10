/**
 * TTS用テキスト分割ユーティリティ
 * 議事録テキストを800〜1200文字のチャンクに分割する
 * 文の区切り（。！？\n）を優先して自然な位置で分割
 */

const MIN_CHUNK_SIZE = 800;
const MAX_CHUNK_SIZE = 1200;

// 文の区切りとして認識する文字
const SENTENCE_DELIMITERS = ['。', '！', '？', '!\n', '?\n', '\n\n'];

/**
 * テキストを自然な文の区切りでチャンクに分割する
 */
export function splitTextIntoChunks(text: string): string[] {
  // 空白・改行を正規化
  const normalized = text.replace(/\r\n/g, '\n').trim();

  if (!normalized) return [];
  if (normalized.length <= MAX_CHUNK_SIZE) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
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
