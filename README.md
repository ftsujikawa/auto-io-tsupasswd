# auto-io-tsupasswd (MV3)

ネイティブアプリ（tsupasswd）から資格情報を取得し、Webページのフォームに入力するChrome拡張（Manifest V3）。

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
4. このディレクトリ `auto-io-tsupasswd/` を選択

## 動作確認 / 使い方
- **ページ読み込み時に自動実行**: ページが`http`/`https`/`file`の場合、読み込み後に資格情報を取得し、ユーザID/パスワード欄を検出・バインドします（SPAにも追従）。
- **インラインポップの表示**: フォーム検出後、入力欄近傍に「ユーザID（平文）/パスワード（伏せ字）」のポップが固定表示されます。入力欄にフォーカスしても表示されます。
- **クリックで入力**: インラインポップをクリックすると、検出されたフォームのユーザID/パスワード欄へ一括入力されます。
- **拡張ポップアップからの起動**: 必要に応じて拡張ポップアップのボタン（`Get Page Title`）をクリックすると、アクティブタブへ実行メッセージを送って同処理を開始できます。

## 仕様概要
- **資格情報取得**: `background.js` がネイティブメッセージングでホスト `com.tsu.tsupasswd` に `{ args: [<url>, ...] }` を送信し、`{ username, password }` を受領します。
- **フィールド検出**: `content.js` が以下に対応して入力欄を検出します。
  - 深い探索（Shadow DOM・同一オリジン iframe）
  - 複数フォームの近傍ペアリング（同一`form`優先→親近傍→距離スコア）
- **表示/入力**:
  - 固定配置のインラインポップ（`position: fixed`）をページ上に表示し、スクロール/リサイズで位置追従
  - クリックでユーザID/パスワードを対象フォームに入力（クリック中の`blur`による非表示を抑止）

## 制限・注意
- **対象URL**: `http`/`https`/`file`のみ対応。`chrome://`や拡張ページでは動作しません。
- **iframe**: クロスオリジン`iframe`内部にはアクセスできません（ブラウザ制約）。
- **ネイティブホスト**: `com.tsu.tsupasswd` の登録が必要です（ネイティブメッセージングのホストマニフェスト設定）。

## メモ
- `background` はService Workerのため長時間状態を保持しません。必要に応じて `chrome.storage.*` を使用してください。
- `content_scripts.matches` は現在 `<all_urls>` です。必要なURLパターンに絞ることを推奨します。
