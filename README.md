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
  - 取得: `background.js` がネイティブホスト `dev.happyfactory.tsupasswd` に `{ args: [<url>, ...] }` を送信し、検索結果（`entries` または `username/password`）を受領。
  - 保存: `content.js` の保存ダイアログから `SAVE_TSUPASSWD` を送信。`background.js` が ネイティブホスト `dev.happyfactory.tsupasswd` に `{ action: 'SAVE', entry: { title, url, username, password, note } }` を渡します。パスワードは未入力でも保存可能（空文字として扱います）。
- **フィールド検出**:
  - 深い探索（Shadow DOM、iframe含む）
  - 近傍ペアリング（同一`form`優先→親近傍→距離スコア）
  - ユーザIDのみ／パスワードのみのフィールドにも対応
- **表示/入力**:
  - 固定配置のインラインポップを入力欄の `ownerDocument` に生成し、位置は対象フレームの `window` で追従
  - 初回自動表示＋フォーカス時表示。候補クリック/タッチ/ホバーで入力（片側のみでも反映）
- **SPA/URL変化対応**:
  - `pushState/replaceState/popstate/hashchange` をフックして、自動表示フラグをリセットし再表示可能に

## メッセージ/処理フロー（実装準拠）
- **メッセージ種別（`background.js`）**
  - `PING`
    - ヘルスチェック用。同期応答 `{ ok: true }`。
  - `RUN_TSUPASSWD`
    - ネイティブホストへ `{ args: [...], secret, bin? }` を送信。
    - 応答が `ok: true` の場合は `{ ok: true, data: <native response> }` を返却。
    - 失敗時は `{ ok: false, error, data? }` を返却（`stderr/stdout` 等を含むことあり）。
  - `SAVE_TSUPASSWD`
    - 保存用。`{ action: 'SAVE', entry: { title, url, username, password, note }, secret, bin? }` を送信。
  - `AUTH_TSUPASSWD`
    - 認証用。`{ action: 'AUTH', mode, secret, bin? }` を送信。`mode` 既定値は `secret`。

- **ホスト解決とフォールバック**
  - 優先順: `message.host` → `chrome.storage.local.host_name` → 既定値 → フォールバック群。
  - 現在の既定/フォールバックは `dev.happyfactory.tsupasswd`。
  - 複数候補に対して順次 `chrome.runtime.sendNativeMessage` を試行し、成功した時点で応答。

- **シークレット/バイナリパスの扱い**
  - `secret`: `message.secret` が無ければ `chrome.storage.local.auth_secret` を使用。
  - `bin`（任意）: `message.bin` が無ければ `chrome.storage.local.tsupasswd_bin` を使用。

## ポップアップ UI の挙動（`popup/popup.js`）
- **検索（取得）**
  - 入力欄のユーザIDをクエリに `window.tsupasswd.search(query)` を実行。
  - 内部で `RUN_TSUPASSWD` を発行し、ネイティブ応答を JSON として解釈。
  - 優先的に `entries[0].username/password` を使用。無ければ `username/password` フィールドを参照。
  - 結果が空ならメッセージ表示。値があれば資格情報ボックスに反映。

- **パスワード表示切替**
  - ボタンで `password`/`text` をトグル（ラベルは「表示/非表示」に自動切替）。

- **設定（保存）**
  - シークレット: `#secret-input` → `chrome.storage.local.auth_secret` に保存後、`AUTH_TSUPASSWD` を発行して即時認証を試行。
  - ホスト名: `#host-input` → `chrome.storage.local.host_name` に保存。
  - 保存の結果はポップアップ下部に短いステータスとして表示。

## 設定項目と保存先
- **auth_secret**（`chrome.storage.local`）
  - ネイティブメッセージング時に付与するシークレット。
  - ポップアップから保存可能。`AUTH_TSUPASSWD` で検証。
- **host_name**（`chrome.storage.local`）
  - 既定ホストを上書きするための任意設定。
- **tsupasswd_bin**（`chrome.storage.local`）
  - ネイティブ実行バイナリパスの明示指定（任意）。指定がある場合、ペイロードの `bin` として送出。

## 制限・注意
- **対象URL**: `http`/`https`/`file` のみ。`chrome://` 等では動作しません。
- **iframe**: `manifest.json` に `all_frames: true` で全フレームへ注入しますが、サイトのセキュリティ設定や sandbox により期待通り動作しない場合があります。
- **ネイティブホスト**: `dev.happyfactory.tsupasswd` の登録が必要です（`dev.happyfactory.tsupasswd.json` マニフェストを参照）。`chrome.storage.local.tsupasswd_bin` で `tsupasswd` 実行パスを上書き可能です。

## メモ
- `background` はService Workerのため長時間状態を保持しません。必要に応じて `chrome.storage.*` を使用してください。
- `content_scripts.matches` は現在 `<all_urls>` です。必要なURLパターンに絞ることを推奨します。
