// このモジュールだけが emoji-mart(＋そのCSS)を静的importする。
// Chat.tsx から React.lazy(() => import('./EmojiPickerInner')) で読み込むことで、
// emoji-mart は「絵文字ピッカーを開いたとき」だけダウンロードされる（初回ロードを軽くする）。
import 'emoji-mart/css/emoji-mart.css'
import { Picker } from 'emoji-mart'

export default Picker
