# BUGS.md — goudou_enshu_app バグ管理

このファイルは **動作検証担当 (Web Claude Code セッション)** から **実装担当 (ターミナル Claude Code セッション)** への修正依頼チケット集です。

- 起票: 動作検証担当 → ステータス `OPEN`
- 修正対応: 実装担当 → コミットメッセージで `Fix BUG-NNN: ...` と明記、ステータスを `FIXED` に
- 再検証: 動作検証担当 → ステータスを `VERIFIED` または `REOPENED` に

各バグには修正対象ファイル + 該当行 + 確定仕様を明記しています。判断不要で surgical に対応できる粒度で書く方針。

---

## BUG-001: URL ルーティング仕様 — `id` 優先 + `role=dashboard` のみ採用

| | |
|---|---|
| 起票日 | 2026-05-03 |
| Severity | Blocker (5/17 当日の保護者リンクに直接影響) |
| Status | **OPEN** |
| Reporter | 動作検証担当 (Web CC) |
| Assignee | 実装担当 (ターミナル CC) |

### 背景
HANDOFF_GOUDOU_ENSHU_IMPL.md (実装担当側 正本) は `?id=MI-001` 単独 URL を前提にしている一方、Web CC の現行実装は `?role=upload&id=MI-001` を期待している。

Ryo 判断 (2026-05-03): **ハイブリッド採用**。
- 理由: HANDOFF v1 は admin route を未考慮、ダッシュボードを捨てる選択肢 (B) は 5/17 当日の事故リスクが高い (kill switch + 進捗監視 GUI が必須)。

### 確定仕様
```
?id=MI-001         → G-2 答案アップロード (保護者)
?role=dashboard    → G-3 管理者ダッシュボード (admin)
(無指定)           → G-1 申込フォーム
```

それ以外の role (`?role=upload`, `?role=apply`) は廃止。

### 修正対象 (3 箇所)

#### 修正 1-A: `gas_src/Code.gs` の `doGet` ルーティング

**現状 (該当: 17-32 行目付近)**:
```javascript
function doGet(e) {
  var role = (e && e.parameter && e.parameter.role) || '';
  try {
    if (role === 'upload') {
      return _renderUploadPage(e.parameter.id || '');
    }
    if (role === 'apply') {
      return _renderApplyPage();
    }
    if (role === 'dashboard') {
      return _renderDashboardPage();
    }
    return _renderApplyPage();
  } catch (err) {
    return _renderError(err);
  }
}
```

**修正後**:
```javascript
function doGet(e) {
  var params = (e && e.parameter) || {};
  var id = params.id || '';
  var role = params.role || '';
  try {
    if (id) {
      return _renderUploadPage(id);          // ?id=XX → G-2 直行
    }
    if (role === 'dashboard') {
      return _renderDashboardPage();          // ?role=dashboard → admin
    }
    return _renderApplyPage();                // 無指定 → G-1
  } catch (err) {
    return _renderError(err);
  }
}
```

#### 修正 1-B: `gas_src/api_G1_Apply.gs` の `_sendConfirmationMail` 内 uploadUrl 組み立て

**現状 (該当: `_sendConfirmationMail` 関数内、110 行目付近)**:
```javascript
var uploadUrlBase = Settings.getWebAppUrl('upload');
// ... uploadUrlBase は ?role=upload 付きを返す前提
var uploadUrl = uploadUrlBase.indexOf('http') === 0
  ? uploadUrlBase + '&id=' + encodeURIComponent(ctx.studentId)
  : uploadUrlBase;
```

**修正後**:
```javascript
// upload role は廃止。WebApp ベース URL に ?id=XX を直接付ける。
var webAppBase = Settings.get('web_app_url', '');
if (!webAppBase) {
  webAppBase = '(管理者: m_設定 の web_app_url を設定してください)';
}
var uploadUrl = webAppBase.indexOf('http') === 0
  ? webAppBase + '?id=' + encodeURIComponent(ctx.studentId)
  : webAppBase;
```

#### 修正 1-C: `gas_src/lib_Settings.gs` の `normalizeWebAppUrl` / ALLOWED_ROLES

**現状 (該当: 168-200 行目付近)**:
```javascript
var ALLOWED_ROLES = ['upload', 'apply'];
function normalizeWebAppUrl(role, url) { ... }
function setWebAppUrl(role, rawUrl) { ... }
function getWebAppUrl(role) { ... }
```

**修正方針 2 択 (実装担当判断)**:

**選択 a (推奨): ALLOWED_ROLES から削除、`web_app_url` 単一キーに統一**
- `?id=` の自動付与は申込メール組み立て側で行う (修正 1-B 参照)
- `?role=dashboard` は不変パラメータなので URL に直接含めて Settings に保存
- `normalizeWebAppUrl` / `setWebAppUrl` / `getWebAppUrl` は dashboard 専用に簡略化
- bootstrap defaults: `upload_web_app_url` / `apply_web_app_url` を削除し `web_app_url` を 1 つだけ追加 (`description: 'WebApp 公開 URL (パラメータなし、id/role はクライアント側で付与)'`)

**選択 b: `dashboard` だけ残す**
```javascript
var ALLOWED_ROLES = ['dashboard'];
```
- dashboard URL だけ Settings 経由で正規化、parent URL は別キー `web_app_url` に素のまま保存。

→ **選択 a を推奨**。コード量が減る + 概念が単純化される。

### 検証項目 (修正後)
| ケース | 期待 |
|---|---|
| `https://script.google.com/.../exec?id=MI-001` | G-2 アップロード画面が表示される |
| `https://script.google.com/.../exec?id=` (空) | G-1 申込フォームが表示される (id 空なので) |
| `https://script.google.com/.../exec` | G-1 申込フォームが表示される |
| `https://script.google.com/.../exec?role=dashboard` | G-3 管理者ダッシュボードが表示される (※ BUG-002 で admin_pin 追加要) |
| `https://script.google.com/.../exec?role=upload&id=MI-001` | G-2 が表示される (id があるため、role は無視) |
| 確認メール内 URL | `?id=MI-001` 付きで保護者がワンタップで G-2 に到達 |

### 既存 Settings 行のクリーンアップ (運用)
すでに `upload_web_app_url` / `apply_web_app_url` を `m_設定` に投入済みの環境では、bootstrap 後に手動で:
- 行を削除 or 値を空に (used されない)
- 新規 `web_app_url` キーに正しい URL を投入

migration スクリプト不要 (Settings.bootstrap() は既存行を上書きしないため)。

---

## BUG-002: ダッシュボード (`?role=dashboard`) に管理者認証がない

| | |
|---|---|
| 起票日 | 2026-05-03 |
| Severity | High (情報漏洩 + 誤操作リスク) |
| Status | **OPEN** |
| Reporter | 動作検証担当 (Web CC) |
| Assignee | 実装担当 (ターミナル CC) |

### 背景
Ryo 検証項目に「`?role=dashboard` で admin_pin プロンプトが出るか」が追加された。

しかし Web CC の現行実装 (`Code.gs:_renderDashboardPage`) は **何の認証もなく** ダッシュボードを返している。WebApp の `access: ANYONE_ANONYMOUS` 設定下では URL を知られた瞬間に:
- 受験者の氏名・点数・配信状況が全閲覧可能
- 「結果一斉配信」ボタンが押せてしまう (ただし kill switch があるので実害は限定的)
- kill switch 自体の ON/OFF を第三者が切替可能

### 確定仕様 (要 Ryo 確認)
PIN ベース認証を `m_設定` の `admin_pin_hash` に保存して照合。
- 初回アクセス時に PIN 入力プロンプト
- セッションは PropertiesService.getUserProperties() で保持 (有効期限 12h)
- PIN 失敗 5 回でロック (15 分)

### 提案実装

#### Settings に追加
```javascript
admin_pin_hash: '',                    // SHA-256 hash of admin PIN
admin_session_ttl_hours: '12',
admin_pin_failed_count: '0',           // 連続失敗カウンタ
admin_pin_locked_until: ''             // ロック解除時刻 ISO
```

#### `setupAdminPin(plainPin)` ユーティリティ (GAS エディタから手動実行)
```javascript
function setupAdminPin(plainPin) {
  if (!plainPin || plainPin.length < 4) throw new Error('PIN は 4 桁以上');
  Settings.set('admin_pin_hash', Util.hashPassword(plainPin), '管理者ダッシュボード PIN の SHA-256 ハッシュ');
  return 'PIN 設定完了';
}
```

#### Auth API (api_Admin_Auth.gs 新規)
```javascript
function admin_login(pin) {
  // ロック確認 → ハッシュ照合 → 成功時 session token 発行 → UserProperties 保存
}
function admin_isAuthenticated() {
  // UserProperties の token + expires チェック
}
function admin_logout() {
  // UserProperties クリア
}
```

#### `Code.gs:_renderDashboardPage` 修正
```javascript
function _renderDashboardPage() {
  if (!admin_isAuthenticated()) {
    return _renderAdminLoginPage();   // PIN 入力プロンプト
  }
  // ... 既存のダッシュボード描画
}
```

#### 新規 `Admin_Login.html`
- PIN 4桁入力 (type="password" で keychain autofill 効く)
- POST 後 `admin_login(pin)` 呼出
- 成功時 reload してダッシュボード表示

### 代替案 (Ryo 判断待ち)
- **A. PIN 認証 (上記)** — シンプル、保護者から覚えにくい URL でも見れる人が出る
- **B. Google アカウント認証** — `appsscript.json` で `executeAs: USER_ACCESSING` に変更し `Session.getActiveUser().getEmail()` を `m_設定.admin_emails` の許可リストと照合。ただし parent flow も Google サインイン必須になり保護者体験が悪化
- **C. 「実行アカウント = Ryo」 + 別 deployment** — admin 専用 deployment を `executeAs: USER_DEPLOYING` + `access: MYSELF_ONLY` で別作成。parent 側は anonymous のまま。最も clean

→ **C が技術的に一番きれい**。Settings の WebApp URL 管理が `web_app_url` (parent) と `admin_web_app_url` (admin) の 2 つになるが、parent flow に複雑性が漏れない。

PIN 認証 (A) は Workspace 非依存で動くが、運用の手間 (PIN 忘れ復旧、共有・更新) が増える。

### 検証項目 (修正後)
| ケース | 期待 |
|---|---|
| 未認証で `?role=dashboard` | PIN 入力 (or Google サインイン) プロンプト |
| 正しい PIN で submit | ダッシュボード表示 + セッション 12h 維持 |
| 誤 PIN を 5 回 | 15 分ロックメッセージ |
| ログアウト後再アクセス | 再度 PIN プロンプト |

→ **どの代替案 (A/B/C) を採用するか Ryo 判断待ち**。決まり次第このセクションを書き換える。

---

## 起票テンプレ (今後追加するバグ用)

```markdown
## BUG-NNN: タイトル

| | |
|---|---|
| 起票日 | YYYY-MM-DD |
| Severity | Blocker / High / Medium / Low |
| Status | OPEN / FIXED / VERIFIED / WONTFIX |
| Reporter | 動作検証担当 |
| Assignee | 実装担当 |

### 背景

### 再現手順
1.
2.
3.

### 期待動作

### 実際の動作

### 修正対象
- ファイル名:行番号 — 期待修正

### 検証項目 (修正後)
- [ ]
```

---

**END OF BUGS.md**
