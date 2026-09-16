/**
 * デバイス種別検出ユーティリティ
 *
 * タッチデバイス（タブレット・スマホ）とPC（マウス操作）を判別する。
 * PC版のUIに影響を与えないよう、タッチデバイスのみを識別して
 * レスポンシブUIやジョイスティックの表示を制御する。
 */

export type DeviceType = 'pc' | 'tablet' | 'phone'

/**
 * ブラウザがタッチ入力をサポートしているかを判定する。
 * pointer: coarse メディアクエリとmaxTouchPointsの両方で確認する。
 */
export function isTouchDevice(): boolean {
  // pointer: coarse はタッチスクリーンの主入力方式を示す
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  // maxTouchPoints はタッチ可能なポイント数（0ならタッチ非対応）
  const hasTouchPoints = navigator.maxTouchPoints > 0
  return coarsePointer || hasTouchPoints
}

/**
 * 現在のデバイス種別を取得する。
 *
 * - pc: マウス操作が主。タッチ非対応、またはタッチ対応でも大画面デスクトップ
 * - tablet: タッチ対応かつ画面幅768px以上
 * - phone: タッチ対応かつ画面幅768px未満
 */
export function getDeviceType(): DeviceType {
  if (!isTouchDevice()) return 'pc'

  // 横向き時の長辺を基準に判定（短辺だけでは横向きタブレットがスマホ扱いになる）
  const longSide = Math.max(window.innerWidth, window.innerHeight)
  // 768px以上ならタブレット、未満ならスマホ
  if (longSide >= 768) return 'tablet'
  return 'phone'
}

/**
 * 現在タブレット横向き表示かどうかを判定する。
 */
export function isTabletLandscape(): boolean {
  return getDeviceType() === 'tablet' && window.innerWidth > window.innerHeight
}

/**
 * タブレットまたはスマホ（=タッチ操作デバイス）かどうかを判定する。
 * PC版のUIを保護するためのガード条件として使用する。
 */
export function isMobileOrTablet(): boolean {
  const type = getDeviceType()
  return type === 'tablet' || type === 'phone'
}
