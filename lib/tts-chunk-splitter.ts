/**
 * TTS用テキスト分割ユーティリティ
 *
 * セクション単位で分割し、長いセクションのみ文区切りでサブ分割する。
 * 見出し行は独立チャンクにして「議題→本文」の間に自然な間を作る。
 *
 * ─── チューニング定数 ───
 * TARGET_CHUNK_SIZE: 文区切り探索の目標サイズ（この付近で分割を試みる）
 * HARD_MAX:          1チャンクの絶対上限（これ以下なら分割しない）
 * MIN_CHUNK_SIZE:    文区切り探索の最小範囲（短すぎるチャンクを避ける）
 */

// ── チューニング定数（変更しやすいようにまとめて定義）──
export const TARGET_CHUNK_SIZE = 250;   // 目標チャンクサイズ（日本語文字数）
export const HARD_MAX = 350;            // 1チャンク絶対上限（4GB VPS対応）
export const MIN_CHUNK_SIZE = 20;       // 最小チャンクサイズ（見出しの独立を許可）

// 文の区切りとして認識する文字（優先度順）
// 「、」（読点）では区切らない — 文の途中で切れて不自然になるため
const SENTENCE_DELIMITERS = ['\n\n', '\n', '。', '！', '？'];

// セクション見出しパターン（行頭）
const HEADING_PATTERN = /^(?:#{1,3}\s|■|●|▶|◆|★|【)/;

/**
 * テキストの前処理：不要な記号や連続改行を正規化
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * テキストをセクション（意味ブロック）に分割
 * - 見出し行（■●▶◆★【# ## ###）は独立セクションにする
 * - 空行2行連続でも区切る
 * - 見出し＋本文が別チャンクになり、読み上げ時に自然な間ができる
 */
function splitIntoSections(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  const flushSection = () => {
    const joined = current.join('\n').trim();
    if (joined) sections.push(joined);
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行2連続 → セクション区切り
    if (!trimmed && i + 1 < lines.length && !lines[i + 1].trim()) {
      flushSection();
      i++; // 次の空行もスキップ
      continue;
    }

    // 見出し行 → 前のセクションを確定し、見出しだけで1セクション
    if (trimmed && HEADING_PATTERN.test(trimmed)) {
      flushSection();
      sections.push(trimmed);
      continue;
    }

    current.push(line);
  }
  flushSection();

  return sections;
}

/**
 * 長いセクションを文区切りでサブ分割
 */
function splitLongSection(text: string): string[] {
  if (text.length <= HARD_MAX) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= HARD_MAX) {
      chunks.push(remaining.trim());
      break;
    }

    let splitPos = -1;

    // TARGET_CHUNK_SIZE以内で最も後ろの文区切りを探す
    for (const delimiter of SENTENCE_DELIMITERS) {
      const searchRange = remaining.slice(MIN_CHUNK_SIZE, TARGET_CHUNK_SIZE);
      const lastIndex = searchRange.lastIndexOf(delimiter);
      if (lastIndex !== -1) {
        const pos = MIN_CHUNK_SIZE + lastIndex + delimiter.length;
        if (pos > splitPos) splitPos = pos;
      }
    }

    // MIN_CHUNK_SIZE前でも区切りがあれば（TARGET内で見つからなかった場合）
    if (splitPos === -1) {
      for (const delimiter of SENTENCE_DELIMITERS) {
        const searchRange = remaining.slice(0, TARGET_CHUNK_SIZE);
        const lastIndex = searchRange.lastIndexOf(delimiter);
        if (lastIndex !== -1 && lastIndex > 0) {
          const pos = lastIndex + delimiter.length;
          if (pos > splitPos) splitPos = pos;
        }
      }
    }

    // それでも見つからない場合 → HARD_MAXまで広げて探す
    if (splitPos === -1) {
      for (const delimiter of SENTENCE_DELIMITERS) {
        const searchRange = remaining.slice(TARGET_CHUNK_SIZE, HARD_MAX);
        const lastIndex = searchRange.lastIndexOf(delimiter);
        if (lastIndex !== -1) {
          const pos = TARGET_CHUNK_SIZE + lastIndex + delimiter.length;
          if (pos > splitPos) splitPos = pos;
        }
      }
    }

    // 見つからない場合、TARGET_CHUNK_SIZEで強制分割
    if (splitPos === -1 || splitPos === 0) {
      splitPos = TARGET_CHUNK_SIZE;
    }

    const chunk = remaining.slice(0, splitPos).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitPos);
  }

  return chunks;
}

/**
 * 隣接する短いチャンクを結合（見出し以外同士でHARD_MAX以下なら結合）
 */
function mergeShortChunks(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  const merged: string[] = [];
  let buffer = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const nextIsHeading = HEADING_PATTERN.test(next.trim());
    const bufferIsHeading = HEADING_PATTERN.test(buffer.trim());

    if (nextIsHeading || bufferIsHeading) {
      merged.push(buffer);
      buffer = next;
    } else if (buffer.length + next.length + 1 <= HARD_MAX) {
      buffer = buffer + '\n' + next;
    } else {
      merged.push(buffer);
      buffer = next;
    }
  }
  merged.push(buffer);
  return merged;
}

/**
 * テキストをセクション単位でチャンクに分割する
 *
 * 1. セクション（見出し/空行区切り）に分割 — 見出しは独立チャンク
 * 2. HARD_MAX以下のセクションはそのまま1チャンク
 * 3. 超えるセクションは文区切りでサブ分割
 * 4. 隣接する短い非見出しチャンクを結合
 */
export function splitTextIntoChunks(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= HARD_MAX) return [normalized];

  const sections = splitIntoSections(normalized);
  const rawChunks: string[] = [];

  for (const section of sections) {
    if (section.length <= HARD_MAX) {
      rawChunks.push(section);
    } else {
      const subChunks = splitLongSection(section);
      rawChunks.push(...subChunks);
    }
  }

  return mergeShortChunks(rawChunks);
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
