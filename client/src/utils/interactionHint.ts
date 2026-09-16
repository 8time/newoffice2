import { isMobileOrTablet } from './deviceDetect'

/**
 * オブジェクト近接時の操作案内テキストを、入力デバイスに合わせて整形する。
 * PC: キーボード表記（⌨️ [ R ] 等）
 * タブレット/スマホ: タップ案内
 */
export function formatInteractionHint(text: string): string {
  if (!isMobileOrTablet()) {
    let displayHtml = text
    if (displayHtml.includes('Press R')) {
      displayHtml = displayHtml.replace('Press R', '⌨️ [ R ]')
    } else if (displayHtml.includes('Press E')) {
      displayHtml = displayHtml.replace('Press E', '⌨️ [ E ]')
    }
    return displayHtml
  }

  return text
    .replace(/Press R[^\n]*/gi, '👆 タップして操作')
    .replace(/Press E[^\n]*/gi, '👆 タップして操作')
    .replace(/⌨️ \[ R \][^\n]*/g, '👆 タップして操作')
    .replace(/⌨️ \[ E \][^\n]*/g, '👆 タップして操作')
}
