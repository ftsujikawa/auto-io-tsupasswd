# Chrome Extension Base (MV3)

最小構成のChrome拡張（Manifest V3）。

## 構成
- `manifest.json`: MV3マニフェスト
- `background.js`: Service Worker（イベント処理）
- `content.js`: ページに挿入されるスクリプト
- `popup/`:
  - `popup.html` / `popup.js` / `popup.css`
- `options/`:
  - `options.html` / `options.js`
- `.gitignore`

## ローカル読み込み手順
1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」
4. このディレクトリ `chrome-extension-base/` を選択

## 動作確認
- ツールバーの拡張アイコンから「Popup」を開き「Get Page Title」をクリック
- アクティブタブのタイトルが `popup/popup.html` の `#result` に表示されます
- 「拡張機能のオプション」からサンプル設定を保存可能（`chrome.storage.sync`）

## メモ
- `background` はService Workerのため長時間状態を保持しません。必要に応じて `chrome.storage.*` を使用してください。
- `content_scripts.matches` は現在 `<all_urls>` です。必要なURLパターンに絞ることを推奨します。
