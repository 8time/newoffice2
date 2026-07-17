import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { useAppDispatch, useAppSelector } from '../hooks'
import { openStampManager, STAMP_CATEGORIES } from '../stores/StampStore'
import { resolveServerUrl } from '../services/serverUrl'
import { loadFavorites, toggleFavorite } from '../util/stampFavorites'

/**
 * チャットから送るスタンプを選ぶ一覧。
 * 押すとそのまま送信する（LINEと同じで、選んでから送信ボタンは押させない）。
 */
const Wrapper = styled.div`
  position: absolute;
  /* チャットの Wrapper(padding:16px) を基準に、入力欄のすぐ上へ固定表示する。
     以前は ChatBox(スクロール領域)の内側に置いていたため、
     上へスクロールするとピッカーも一緒に流れて見失っていた */
  bottom: 70px;
  right: 16px;
  width: 340px;
  max-height: 320px;
  background: #2a3050;
  border: 1px solid rgba(150, 175, 255, 0.35);
  border-radius: 10px;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  z-index: 20;
`

const Tabs = styled.div`
  display: flex;
  gap: 2px;
  padding: 6px 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
`

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  background: ${(p) => (p.$active ? 'rgba(255,255,255,0.14)' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : '#9aa4c8')};
  border: none;
  border-radius: 6px 6px 0 0;
  padding: 7px 4px;
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 700 : 400)};
  cursor: pointer;
  &:hover { color: #fff; }
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 8px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.25); border-radius: 3px; }
`

const Cell = styled.div`
  position: relative;

  /* お気に入りの印は普段は控えめにし、触ったときだけはっきり見せる */
  .fav {
    position: absolute;
    top: -2px;
    right: -2px;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s;
    padding: 0;
  }
  &:hover .fav { opacity: 1; }
  .fav.on { opacity: 1; }
`

const StampBtn = styled.button`
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 4px;
  cursor: pointer;
  line-height: 0;
  width: 100%;

  img { width: 100%; height: 64px; object-fit: contain; }
  &:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255,255,255,0.25); }
`

const Empty = styled.div`
  padding: 24px 16px;
  text-align: center;
  color: #9aa4c8;
  font-size: 13px;
  line-height: 1.8;

  button {
    margin-top: 10px;
    background: #3ddc97;
    color: #10261c;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 700;
    cursor: pointer;
  }
`

interface Props {
  onPick: (id: string) => void
}

export default function StampPicker({ onPick }: Props) {
  const dispatch = useAppDispatch()
  const stamps = useAppSelector((state) => state.stamp.stamps)
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites())
  // お気に入りがあればそこから開く（自分がよく使うものにすぐ届くように）
  const [tab, setTab] = useState<string>(() => (loadFavorites().length > 0 ? 'お気に入り' : 'よく使う'))

  const tabs = useMemo(() => ['お気に入り', 'よく使う', ...STAMP_CATEGORIES], [])

  const list = useMemo(() => {
    const all = Object.entries(stamps)
    if (tab === 'お気に入り') {
      // 自分が付けた順に出す（並べ替えの意図を保つ）
      return favorites.map((id) => [id, stamps[id]] as const).filter(([, s]) => !!s) as [string, typeof stamps[string]][]
    }
    if (tab === 'よく使う') {
      // 使った回数の多い順。まだ誰も使っていなければ新しい順に出す
      return [...all].sort((a, b) => (b[1].useCount - a[1].useCount) || (b[1].createdAt - a[1].createdAt)).slice(0, 16)
    }
    return all.filter(([, s]) => s.category === tab).sort((a, b) => b[1].createdAt - a[1].createdAt)
  }, [stamps, tab, favorites])

  if (Object.keys(stamps).length === 0) {
    return (
      <Wrapper>
        <Empty>
          まだスタンプがありません。
          <br />
          設定から自分たちのスタンプを登録できます。
          <br />
          <button onClick={() => dispatch(openStampManager())}>スタンプを登録する</button>
        </Empty>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <Tabs>
        {tabs.map((t) => (
          <Tab key={t} $active={tab === t} onClick={() => setTab(t)}>
            {t}
          </Tab>
        ))}
      </Tabs>
      <Grid>
        {list.map(([id, s]) => {
          const fav = favorites.includes(id)
          return (
            <Cell key={id}>
              <StampBtn title={s.name} onClick={() => onPick(id)}>
                <img src={resolveServerUrl(s.url)} alt={s.name} />
              </StampBtn>
              <button
                className={`fav${fav ? ' on' : ''}`}
                title={fav ? 'お気に入りから外す' : 'お気に入りに入れる'}
                aria-label={`favorite-${id}`}
                onClick={(e) => {
                  e.stopPropagation() // 押した拍子にスタンプを送ってしまわないように
                  setFavorites(toggleFavorite(id))
                }}
              >
                {fav ? '⭐' : '☆'}
              </button>
            </Cell>
          )
        })}
      </Grid>
      {tab === 'お気に入り' && list.length === 0 && (
        <Empty>
          お気に入りはまだありません。
          <br />
          スタンプの右上の ☆ を押すとここに集まります。
        </Empty>
      )}
    </Wrapper>
  )
}
