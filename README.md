# auto-io-tsupasswd (MV3)

ネイティブアプリ（tsupasswd）から資格情報を取得し、Webページのフォームに入力するChrome拡張（Manifest V3）。

## 機能概要
- ユーザID/パスワードの自動入力支援
- フォーム入力欄の自動検出とバインド
- インラインポップアップによる直感的な操作
- SPA（Single Page Application）対応
- 拡張ポップアップからの手動検索・入力

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

## 使い方
- **自動検出**: ページ読み込み時にユーザID/パスワード入力欄を自動検出し、資格情報を取得します
- **インラインポップアップ**: 入力欄クリック時に候補リストを表示します
- **候補選択**: 候補をクリックすると対応するフィールドに自動入力されます
- **ホバー機能**: マウスオーバーで入力内容をプレビューできます
- **拡張ポップアップ**: ブラウザの拡張アイコンから手動検索・入力も可能です

### 対応する入力欄
- パスワード入力欄
- 同一フォーム内にパスワード欄があるユーザID欄
- 一部サイトではユーザIDのみの入力欄にも対応

## 技術仕様
- **資格情報管理**: ネイティブホスト `tsupasswd` と連携して資格情報の取得・保存を行います
- **フォーム検出**: Shadow DOMやiframeを含む深い探索で入力欄を検出します
- **UI表示**: インラインポップアップで候補を表示し、直感的な操作を実現します
- **SPA対応**: ページ遷移を検出して自動表示フラグをリセットします

## 通信仕様
### 主要メッセージ
- **PING**: ヘルスチェック
- **RUN_TSUPASSWD**: 資格情報検索
- **SAVE_TSUPASSWD**: 資格情報保存
- **AUTH_TSUPASSWD**: 認証処理

### ネイティブホスト連携
- ホスト名: `dev.happyfactory.tsupasswd`
- 認証シークレットと実行パスを設定可能
- フォールバック機構で複数ホスト候補を試行

## 拡張ポップアップ機能
- **資格情報検索**: ユーザIDで検索して結果を表示
- **パスワード表示**: 表示/非表示を切り替え
- **設定管理**: 認証シークレットとホスト名を保存

## 設定項目
- **auth_secret**: ネイティブホスト認証用シークレット
- **host_name**: 接続先ホスト名（任意）
- **tsupasswd_bin**: 実行バイナリパス（任意）

## 制限・注意
- **対象URL**: `http`/`https`/`file` のみ。`chrome://` 等では動作しません。
- **iframe**: `manifest.json` に `all_frames: true` で全フレームへ注入しますが、サイトのセキュリティ設定や sandbox により期待通り動作しない場合があります。
- **ネイティブホスト**: `dev.happyfactory.tsupasswd` の登録が必要です（`dev.happyfactory.tsupasswd.json` マニフェストを参照）。`chrome.storage.local.tsupasswd_bin` で `tsupasswd` 実行パスを上書き可能です。

## メモ
- `background` はService Workerのため長時間状態を保持しません。必要に応じて `chrome.storage.*` を使用してください。
- `content_scripts.matches` は現在 `<all_urls>` です。必要なURLパターンに絞ることを推奨します。

## 主な改善点
- **UIの安定化**: ホバー時のポップアップ表示を安定化
- **自動クローズ**: 候補選択後の自動クローズ機能
- **操作性向上**: 外側クリック・ESCキー・スクロールでの閉じる対応
- **表示制御**: 不要な再表示を抑止し、チラつきを防止
- **位置調整**: アンカー位置に基づく最適なポップアップ配置
- **エラー処理**: Extension context invalidatedへの対策

## 動作環境
- **対応URL**: `http`、`https`、`file`スキーム
- **ブラウザ**: Chrome（Manifest V3対応）
- **ネイティブホスト**: 別途 `tsupasswd` のインストールが必要

## トラブルシューティング

- 「Extension context invalidated」
  - 拡張の更新/リロード直後に発生することがあります。ページの再読み込み、または拡張のリロードを実施してください。
  - 再発時は、保存/取得処理がフォールバックに切り替わるか、再読み込みの案内がUIに表示されます。
- ネイティブホストの実行パス（macOS 例）
  - `dev.happyfactory.tsupasswd.json` の `path` 例: `/usr/local/bin/tsupasswd-host`
  - 実体の存在と実行権限を確認してください。
