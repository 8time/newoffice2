export enum RoomType {
  LOBBY = 'lobby',
  PUBLIC = 'skyoffice',
  CUSTOM = 'custom',
  // URLの合言葉(roomKey)で固定入室できるルーム。空室になると一旦破棄されるが、
  // 同じ合言葉でjoinOrCreateすれば作り直されるため、URLは常に同じ部屋を指す。
  KEYED = 'keyed',
}

export interface IRoomData {
  name: string
  description: string
  password: string | null
  autoDispose: boolean
  // KEYEDルームのみ使用。この値でfilterByされ、同じroomKeyのルームに合流する。
  roomKey?: string
}
