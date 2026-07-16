import React, { useEffect, useState } from 'react'
import Phaser from 'phaser'
import styled from 'styled-components'
import phaserGame from '../PhaserGame'

/**
 * PhaserがWebGLを取得できずCanvas描画に降格したことを知らせる。
 *
 * 降格するとPhaserは色の加工にgetImageDataを多用し、GPUからの読み戻しが
 * 毎フレーム走るため数FPSまで落ちる。見た目はマップが表示されるので、
 * ユーザーからは「入室したのに動けない・固まった」としか分からなかった。
 * 原因と直し方（再読み込み／ハードウェアアクセラレーション）を出しておく。
 *
 * WebGLの取得はブラウザ側の都合（タブの開きすぎでコンテキスト上限に当たる等）で
 * たまに失敗するため、アプリ側から強制はできない。
 */
const Banner = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 525px;
  z-index: 10000;
  background: #b3541e;
  color: #fff;
  padding: 10px 16px;
  font-size: 14px;
  font-family: 'Roboto', sans-serif;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);

  .body {
    flex: 1;
    line-height: 1.5;
  }
  .title {
    font-weight: 700;
    margin-bottom: 2px;
  }
  button {
    flex-shrink: 0;
    background: #fff;
    color: #b3541e;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-weight: 700;
    cursor: pointer;
    &:hover { background: #ffe9dc; }
  }
  .close {
    background: none;
    color: #fff;
    font-size: 18px;
    padding: 0 4px;
    &:hover { background: none; color: #ffd9c4; }
  }
`

export default function RendererWarning() {
  const [isCanvas, setIsCanvas] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // rendererはゲームの準備完了後に決まる
    const check = () => setIsCanvas(phaserGame.renderer?.type === Phaser.CANVAS)
    if (phaserGame.isRunning) check()
    else phaserGame.events.once('ready', check)
  }, [])

  if (!isCanvas || dismissed) return null

  return (
    <Banner>
      <div className="body">
        <div className="title">⚠️ 描画が低速モードになっています（このままだと重くて動けません）</div>
        ブラウザがWebGLを使えなかったため、Canvas描画に切り替わりました。
        まず再読み込みをお試しください。直らない場合はChromeの設定 →
        システム →「グラフィック アクセラレーションが使用可能な場合は使用する」をONにしてください。
        タブを開きすぎているときにも起きます。
      </div>
      <button onClick={() => window.location.reload()}>再読み込み</button>
      <button className="close" onClick={() => setDismissed(true)}>×</button>
    </Banner>
  )
}
