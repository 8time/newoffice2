/**
 * チャットの本文が「スタンプとして大きく見せるべきもの」かを判定する。
 *
 * LINEやDiscordと同じで、絵文字だけを送ったときは吹き出しの中の小さな文字ではなく、
 * 背景なしで大きく見せた方が気持ちが伝わる。一方で文中の絵文字（「了解👍」）は
 * これまでどおり文字の大きさで出す。
 *
 * 判定を1か所にまとめておき、フェーズ3のスタンプ（[stamp:xxx]）も
 * 同じ入口で扱えるようにする。
 */

// 絵文字本体（Extended_Pictographic）に加えて、絵文字を組み立てる部品も許す：
//  ZWJ(U+200D)      … 👨‍👩‍👧 のように複数の絵文字を1つに繋ぐ
//  異体字セレクタ(FE0F/FE0E) … ❤️ のように絵文字表示を指定する
//  肌色修飾(1F3FB-1F3FF)     … 👍🏽 の肌の色
//  Regional Indicator        … 🇯🇵 の国旗
//  keycap(U+20E3)と、その土台になる 0-9 * #  … 1️⃣
const EMOJI_PART = /[\p{Extended_Pictographic}‍️︎\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}⃣]/u
const EMOJI_ONLY = /^[\p{Extended_Pictographic}‍️︎\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}⃣0-9*#\s]+$/u

// 大きく出すのはこの数まで。これ以上並べているのは「文章のような使い方」なので
// 通常表示に戻す（Discordと同じ感覚）
const MAX_EMOJI_FOR_STAMP = 3

/**
 * 見た目の上での絵文字の個数を数える。
 * 👨‍👩‍👧 は3文字に見えるが人間には1個なので、書記素単位で数える。
 */
function countEmoji(text: string): number {
  // Intl.Segmenterがあれば、絵文字の合字を1個として正しく数えられる
  const Segmenter = (Intl as any).Segmenter
  if (Segmenter) {
    const seg = new Segmenter('ja', { granularity: 'grapheme' })
    let n = 0
    for (const { segment } of seg.segment(text)) {
      if (segment.trim() === '') continue
      n++
    }
    return n
  }
  // Segmenterが無い環境向けの控え。ZWJで繋がった塊を1個として数える
  return text.trim().split(/\s+/).join('').split(/(?<!‍)(?=[\p{Extended_Pictographic}])/u).filter(Boolean).length
}

/**
 * 登録スタンプの送信は、本文に "[stamp:stp_xxx]" という印を入れた
 * 普通のチャットとして送る。専用のメッセージ種別を作らないことで、
 * 履歴の保存・日付区切り・既読・送信取消がそのまま効く。
 */
const STAMP_MARKER = /^\[stamp:([a-zA-Z0-9_]+)\]$/

export const buildStampMessage = (id: string) => `[stamp:${id}]`

/** 本文が登録スタンプ1個だけなら、そのIDを返す */
export function parseStampMessage(content: string): string | null {
  const m = STAMP_MARKER.exec((content || '').trim())
  return m ? m[1] : null
}

/**
 * この本文をスタンプとして大きく表示すべきか。
 * 文字が1文字でも混ざっていれば false（通常の吹き出し）。
 */
export function isEmojiOnlyMessage(content: string): boolean {
  const text = (content || '').trim()
  if (!text) return false
  // 絵文字が1つも無いなら対象外（数字や記号だけの「123」を大きくしないため）
  if (!EMOJI_PART.test(text)) return false
  if (!EMOJI_ONLY.test(text)) return false
  return countEmoji(text) <= MAX_EMOJI_FOR_STAMP
}
