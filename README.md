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
- **自動実行/検出**: ページが `http/https/file` のとき、ロード後に資格情報を取得し、ユーザID/パスワード入力欄を深く探索して検出・バインドします（SPAにも追従）。
- **インラインポップの自動表示**: 入力欄を検出したタイミングで、1回だけ自動でポップを表示します。以降はユーザID欄/パスワード欄にフォーカスすると表示されます。
- **ユーザIDのみでも表示**: 同一フォームにパスワード欄が無い場合でも、ユーザID欄のみに対してポップを表示します。
- **候補クリックで入力**: 候補一覧からクリック（またはタッチ）すると、対応するフィールドへ値を入力します。片方しか無い場合は、その片方にだけ反映します。
- **ホバーでプレビュー**: マウスオーバー時はプレビューとして値を一時的に反映します（マウス環境のみ）。
- **拡張ポップアップからの起動**: 拡張ポップアップからも検索・入力UIを使用できます。

## 仕様概要
- **資格情報取得/保存**:
  - 取得: `background.js` がネイティブホスト `com.tsu.tsupasswd` に `{ args: [<url>, ...] }` を送信し、検索結果（`entries` または `username/password`）を受領。
  - 保存: `content.js` の保存ダイアログから `SAVE_TSUPASSWD` を送信。`background.js` が `tsupasswd-host` に `{ action: 'SAVE', entry: { title, url, username, password, note } }` を渡します。パスワードは未入力でも保存可能（空文字として扱います）。
- **フィールド検出**:
  - 深い探索（Shadow DOM、iframe含む）
  - 近傍ペアリング（同一`form`優先→親近傍→距離スコア）
  - ユーザIDのみ／パスワードのみのフィールドにも対応
- **表示/入力**:
  - 固定配置のインラインポップを入力欄の `ownerDocument` に生成し、位置は対象フレームの `window` で追従
  - 初回自動表示＋フォーカス時表示。候補クリック/タッチ/ホバーで入力（片側のみでも反映）
- **SPA/URL変化対応**:
  - `pushState/replaceState/popstate/hashchange` をフックして、自動表示フラグをリセットし再表示可能に

## 制限・注意
- **対象URL**: `http`/`https`/`file` のみ。`chrome://` 等では動作しません。
- **iframe**: `manifest.json` に `all_frames: true` で全フレームへ注入しますが、サイトのセキュリティ設定や sandbox により期待通り動作しない場合があります。
- **ネイティブホスト**: `com.tsu.tsupasswd` の登録が必要です（ホストマニフェスト設定）。`TSUPASSWD_BIN` で `tsupasswd` 実行パスを上書き可能です。

## メモ
- `background` はService Workerのため長時間状態を保持しません。必要に応じて `chrome.storage.*` を使用してください。
- `content_scripts.matches` は現在 `<all_urls>` です。必要なURLパターンに絞ることを推奨します。
