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

#### 修正 1-C: `gas_src/lib_Settings.gs` の `normalizeWebAppUrl` / ALLOWED_ROLES を解体

**現状 (該当: 168-200 行目付近)**:
```javascript
var ALLOWED_ROLES = ['upload', 'apply'];
function normalizeWebAppUrl(role, url) { ... }
function setWebAppUrl(role, rawUrl) { ... }
function getWebAppUrl(role) { ... }
```

**修正後 (single deployment + PIN 認証で運用、BUG-002 Option A 採用)**:

```javascript
// 旧 normalizeWebAppUrl / setWebAppUrl / getWebAppUrl は廃止。
// `web_app_url` 単一キーに統一、role/正規化ロジック不要。

// (Settings module 内に新規追加)
function getWebAppUrl() {
  return get('web_app_url', '');  // bare URL、?id=XX / ?role=dashboard は呼出側で付与
}

function setWebAppUrl(url) {
  if (!url) throw new Error('URL is required');
  set('web_app_url', String(url),
      'WebApp 公開 URL (パラメータなし、?id=XX / ?role=dashboard は呼出側で付与)');
  return url;
}
```

bootstrap defaults の変更:
- 削除: `upload_web_app_url`, `apply_web_app_url`
- 追加: `web_app_url` (1 個のみ)

```javascript
// lib_Settings.gs:bootstrap() の defaults
web_app_url: '',
```

return 句から `normalizeWebAppUrl` / 旧 `setWebAppUrl(role, ...)` / 旧 `getWebAppUrl(role)` を削除し、以下 2 つに置換:
```javascript
return {
  // ...
  getWebAppUrl: getWebAppUrl,    // 引数なし版
  setWebAppUrl: setWebAppUrl,    // 引数 (url) 版
  // ...
};
```

### 検証項目 (修正後)
| ケース | 期待 |
|---|---|
| `<webapp_url>?id=MI-001` | G-2 アップロード画面が表示される |
| `<webapp_url>?id=` (空) | G-1 申込フォームが表示される (id 空なので) |
| `<webapp_url>` | G-1 申込フォームが表示される |
| `<webapp_url>?role=dashboard` | G-3 管理者ダッシュボード (PIN 入力プロンプト、BUG-002 参照) |
| `<webapp_url>?role=upload&id=MI-001` | G-2 が表示される (id があるため、role は無視) |
| 確認メール内 URL | `?id=MI-001` 付きで保護者がワンタップで G-2 に到達 |

### 既存 Settings 行のクリーンアップ (運用)
すでに `upload_web_app_url` / `apply_web_app_url` を `m_設定` に投入済みの環境では、bootstrap 後に手動で:
- 旧キーの行を削除 or 値を空に (used されない)
- 新規 `web_app_url` キーに正しい URL を投入

migration スクリプト不要 (Settings.bootstrap() は既存行を上書きしないため)。

---

## BUG-002: ダッシュボード (`?role=dashboard`) に管理者認証がない

| | |
|---|---|
| 起票日 | 2026-05-03 |
| Severity | High (情報漏洩 + 誤操作リスク) |
| Status | **OPEN (Ryo 判断 A 確定 2026-05-03、脱属人化要件)** |
| Reporter | 動作検証担当 (Web CC) |
| Assignee | 実装担当 (ターミナル CC) |

### 確定仕様: Option A (PIN 認証 + token-based セッション)

Ryo 判断 (2026-05-03、再判断):
- **A** (PIN 認証) → **採用**: 引継ぎ可能、脱属人化に整合
- **B** (Google 認証で混在) → 却下: parent flow と衝突
- **C** (別 deployment + MYSELF_ONLY) → 却下: Ryo アカウント依存で**引継ぎ不可**、運用者が Ryo 以外になる前提に反する

### 全体像

- **single deployment** (ANYONE_ANONYMOUS, executeAs USER_DEPLOYING) で運用
- ダッシュボード初期描画時にクライアント側で認証状態確認
- 未認証なら PIN 入力フォームを描画、認証済みならダッシュボード描画
- セッション token は `ScriptProperties.admin_sessions` に JSON map で保持 (12h で expire)
- 失敗 5 回でロック (15 分、ScriptProperties.admin_pin_lockout)
- 全 admin server-side API (g3_*) は token を引数に受け取り `_assertAdminAuth(token)` で検証

### 修正対象 (5 箇所)

#### 修正 2-A: `gas_src/lib_Settings.gs` の bootstrap defaults

```javascript
// lib_Settings.gs:bootstrap() の defaults に追加
admin_pin_hash: '',
admin_session_ttl_hours: '12',
admin_lockout_threshold: '5',
admin_lockout_duration_minutes: '15'
```

description テキスト:
- `admin_pin_hash`: '管理者ダッシュボード PIN の SHA-256 ハッシュ (admin_setupPin() で設定)'
- `admin_session_ttl_hours`: '管理者セッション有効時間 (時間単位)'
- `admin_lockout_threshold`: '連続失敗回数 N 回でロック'
- `admin_lockout_duration_minutes`: 'ロック時間 (分)'

#### 修正 2-B: 新規ファイル `gas_src/api_Admin_Auth.gs`

```javascript
/**
 * api_Admin_Auth.gs (goudou_enshu_app)
 * 管理者ダッシュボード PIN 認証 + token セッション管理。
 *
 * 来歴: 2026-05-03 BUG-002 Option A 確定 (脱属人化要件)。
 *
 * - PIN は SHA-256 ハッシュで Settings.admin_pin_hash に保存
 * - token は UUID、ScriptProperties.admin_sessions に JSON map で保存
 * - failed_count / locked_until は ScriptProperties.admin_pin_lockout に保存
 * - 期限切れ token / locked_until は読込時に自動 cleanup
 */

var SESSIONS_KEY = 'admin_sessions';      // ScriptProperties key
var LOCKOUT_KEY = 'admin_pin_lockout';

/**
 * GAS エディタから手動実行する初期 PIN 設定ユーティリティ。
 * @param {string} plainPin 4 桁以上の数字または英数字
 */
function admin_setupPin(plainPin) {
  if (!plainPin || String(plainPin).length < 4) {
    throw new Error('PIN は 4 桁以上を指定してください');
  }
  Settings.set('admin_pin_hash', Util.hashPassword(plainPin),
    '管理者ダッシュボード PIN の SHA-256 ハッシュ');
  // 設定変更時は既存セッション + ロックを全クリア (新 PIN 即適用)
  PropertiesService.getScriptProperties().deleteProperty(SESSIONS_KEY);
  PropertiesService.getScriptProperties().deleteProperty(LOCKOUT_KEY);
  return { ok: true, message: 'PIN を更新しました。既存セッションは無効化されました。' };
}

/**
 * クライアントから google.script.run で呼ぶログイン API。
 * @param {string} pin 平文 PIN
 * @return {{ok, token?, expiresAt?, error?, lockedUntil?}}
 */
function admin_login(pin) {
  try {
    // 1. ロック確認
    var lockout = _readLockout();
    if (lockout.lockedUntil && new Date(lockout.lockedUntil) > new Date()) {
      return {
        ok: false,
        error: 'ロック中です',
        lockedUntil: lockout.lockedUntil
      };
    }

    // 2. PIN 設定の有無確認
    var stored = Settings.get('admin_pin_hash', '');
    if (!stored) {
      return { ok: false, error: 'PIN が未設定です。管理者は admin_setupPin() を実行してください。' };
    }

    // 3. 照合
    var inputHash = Util.hashPassword(String(pin || ''));
    if (inputHash !== stored) {
      // 失敗カウント増分
      var threshold = Number(Settings.get('admin_lockout_threshold', 5));
      var newCount = (lockout.failedCount || 0) + 1;
      var newLockout = { failedCount: newCount, lockedUntil: '' };
      if (newCount >= threshold) {
        var lockMin = Number(Settings.get('admin_lockout_duration_minutes', 15));
        newLockout.lockedUntil = Utilities.formatDate(
          new Date(Date.now() + lockMin * 60 * 1000),
          Util.getTz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
      }
      _writeLockout(newLockout);
      return {
        ok: false,
        error: 'PIN が違います (残り ' + Math.max(threshold - newCount, 0) + ' 回)',
        lockedUntil: newLockout.lockedUntil || null
      };
    }

    // 4. 成功 → 失敗カウント reset, token 発行
    _writeLockout({ failedCount: 0, lockedUntil: '' });
    var token = Utilities.getUuid();
    var ttlH = Number(Settings.get('admin_session_ttl_hours', 12));
    var expiresAt = Utilities.formatDate(
      new Date(Date.now() + ttlH * 3600 * 1000),
      Util.getTz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
    var sessions = _readSessions();
    sessions[token] = expiresAt;
    _writeSessions(sessions);
    AuditLog.log('admin_login', 'admin_sessions', token.substring(0, 8) + '...', null,
      { expiresAt: expiresAt });
    return { ok: true, token: token, expiresAt: expiresAt };
  } catch (err) {
    Logger.log('[admin_login] ' + err.stack);
    return { ok: false, error: err.message };
  }
}

/**
 * 認証状態確認 (再訪時)。
 * @param {string} token
 */
function admin_isAuthenticated(token) {
  if (!token) return { ok: false, error: 'token なし' };
  var sessions = _readSessions();
  var expiresAt = sessions[token];
  if (!expiresAt) return { ok: false, error: '無効なセッション' };
  if (new Date(expiresAt) <= new Date()) {
    delete sessions[token];
    _writeSessions(sessions);
    return { ok: false, error: 'セッション切れ' };
  }
  return { ok: true, expiresAt: expiresAt };
}

/**
 * ログアウト。
 */
function admin_logout(token) {
  if (!token) return { ok: true };
  var sessions = _readSessions();
  if (sessions[token]) {
    delete sessions[token];
    _writeSessions(sessions);
  }
  return { ok: true };
}

/**
 * server-side admin API のガード。token 不正なら throw。
 */
function _assertAdminAuth(token) {
  var res = admin_isAuthenticated(token);
  if (!res.ok) throw new Error('管理者認証が必要です: ' + (res.error || ''));
}

// ----- 内部: ScriptProperties JSON 読み書き + cleanup -----

function _readSessions() {
  var raw = PropertiesService.getScriptProperties().getProperty(SESSIONS_KEY);
  var map = raw ? Util.safeJsonParse(raw, {}) : {};
  // 期限切れ token を読込時に削除
  var now = new Date();
  var changed = false;
  Object.keys(map).forEach(function (k) {
    if (new Date(map[k]) <= now) { delete map[k]; changed = true; }
  });
  if (changed) _writeSessions(map);
  return map;
}

function _writeSessions(map) {
  PropertiesService.getScriptProperties().setProperty(SESSIONS_KEY, JSON.stringify(map));
}

function _readLockout() {
  var raw = PropertiesService.getScriptProperties().getProperty(LOCKOUT_KEY);
  return raw ? Util.safeJsonParse(raw, { failedCount: 0, lockedUntil: '' })
             : { failedCount: 0, lockedUntil: '' };
}

function _writeLockout(obj) {
  PropertiesService.getScriptProperties().setProperty(LOCKOUT_KEY, JSON.stringify(obj));
}
```

#### 修正 2-C: `gas_src/api_G3_Notify.gs` の admin 関数に token ガード追加

以下 4 関数の冒頭で `_assertAdminAuth(authToken)` を呼ぶ:

```javascript
function g3_populateGrading(authToken) {
  _assertAdminAuth(authToken);
  // ... 既存処理
}

function g3_computeRankings(authToken) {
  _assertAdminAuth(authToken);
  // ... 既存処理
}

function g3_distributeResults(opts, authToken) {
  _assertAdminAuth(authToken);
  // ... 既存処理
}

function g3_setBulkMailEnabled(enabled, authToken) {
  _assertAdminAuth(authToken);
  // ... 既存処理
}

function g3_previewResultMail(studentId, authToken) {
  _assertAdminAuth(authToken);
  // ... 既存処理
}

function g3_getProgress(authToken) {
  _assertAdminAuth(authToken);
  // ... 既存処理
}
```

`api_G6_DocGen.gs:g6_generateAll` / `g6_generateOne` も同様に追加 (admin 操作)。

#### 修正 2-D: `gas_src/G3_Dashboard.html` をログイン状態管理対応に書き換え

主な変更点:
1. ページ冒頭にログインフォームの DOM を追加 (display:none で隠しておく)
2. ページ末尾の `<script>` で `localStorage.adminToken` チェック
3. 未認証なら login form 表示、認証済みなら dashboard 表示
4. 全 google.script.run 呼出に `localStorage.adminToken` を引数追加
5. ヘッダーに「ログアウト」ボタン追加

具体的な実装イメージ (簡略):

```html
<!-- 既存の dashboard wrap の前に追加 -->
<div id="loginPane" class="card" style="display:none">
  <h2 style="text-align:center;margin-bottom:16px">管理者 PIN 入力</h2>
  <form id="loginForm">
    <input type="password" id="pinInput" placeholder="PIN" required
      autocomplete="current-password" style="width:100%;padding:14px;font-size:18px;text-align:center">
    <button type="submit" class="btn" style="margin-top:10px">ログイン</button>
  </form>
  <div id="loginMsg"></div>
</div>

<!-- 既存の dashboard wrap (.wrap) を id="dashboardPane" にして display:none をデフォに -->
<div class="wrap" id="dashboardPane" style="display:none">
  ...既存...
  <button class="btn secondary" id="logoutBtn" type="button" style="margin-left:10px">ログアウト</button>
  ...
</div>
```

```javascript
var AUTH_TOKEN = null;

document.addEventListener('DOMContentLoaded', function () {
  AUTH_TOKEN = localStorage.getItem('adminToken') || null;
  if (!AUTH_TOKEN) {
    showLogin();
  } else {
    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.ok) showDashboard();
        else { localStorage.removeItem('adminToken'); AUTH_TOKEN = null; showLogin(); }
      })
      .admin_isAuthenticated(AUTH_TOKEN);
  }

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pin = document.getElementById('pinInput').value;
    google.script.run
      .withSuccessHandler(function (res) {
        if (res.ok) {
          AUTH_TOKEN = res.token;
          localStorage.setItem('adminToken', AUTH_TOKEN);
          showDashboard();
        } else {
          var msg = res.error;
          if (res.lockedUntil) msg += ' (ロック解除: ' + res.lockedUntil + ')';
          document.getElementById('loginMsg').innerHTML =
            '<div class="alert error">' + esc(msg) + '</div>';
        }
      })
      .admin_login(pin);
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    google.script.run
      .withSuccessHandler(function () {
        localStorage.removeItem('adminToken');
        AUTH_TOKEN = null;
        showLogin();
      })
      .admin_logout(AUTH_TOKEN);
  });
});

function showLogin() {
  document.getElementById('loginPane').style.display = 'block';
  document.getElementById('dashboardPane').style.display = 'none';
}
function showDashboard() {
  document.getElementById('loginPane').style.display = 'none';
  document.getElementById('dashboardPane').style.display = 'block';
  loadProgress();
}

// 既存の loadProgress / runPopulate / runRanking / runDryDistribute /
// runDistribute / toggleKillSwitch / previewStudent / runDistribute は
// すべて google.script.run.xxxx(args) 呼出に AUTH_TOKEN を最後の引数として追加。
// 例:
function loadProgress() {
  google.script.run
    .withSuccessHandler(...)
    .g3_getProgress(AUTH_TOKEN);  // 追加
}
function runPopulate() {
  google.script.run...g3_populateGrading(AUTH_TOKEN);
}
// ... 他も同様
```

#### 修正 2-E: `gas_src/SETUP.md` に PIN 設定手順 + ロック解除手順を追記 (★必須★)

**※ Ryo 確認済 (2026-05-03): 検証 4 (5 回失敗ロック) 実行の前提として、ロック解除手順が SETUP.md に明記されていることを確認するゲートを設ける。**

`### 9.` の前 (G-6 テンプレ前) に新セクションを追加。**以下の内容を漏れなく含めること**:

```markdown
### 8.5. 管理者 PIN 設定 (BUG-002)

GAS エディタで以下を 1 回実行 (引数に任意の PIN を渡す):

```javascript
admin_setupPin('1234');  // 4 桁以上の任意の文字列
```

PIN は SHA-256 ハッシュで `m_設定.admin_pin_hash` に保存される (平文は保持しない)。

PIN 変更時は再度 `admin_setupPin('newPin')` を実行 (既存セッションは全無効化)。

#### ロック解除手順 (5 回連続失敗で 15 分ロックされた場合)

以下のいずれかで解除可能:

**方法 1: ScriptProperties から `admin_pin_lockout` を手動削除**
- GAS エディタ → プロジェクト設定 → スクリプト プロパティ
- `admin_pin_lockout` の行を削除して保存
- 即座にロック解除、失敗カウントもリセット

**方法 2: PIN を再設定 (既存ロックも自動クリア)**
```javascript
admin_setupPin('新PIN');  // 既存ロック・全セッションが自動クリア
```

PIN を覚えている場合は **方法 1** が最速 (PIN 変更不要)。
PIN を忘れた場合は **方法 2** で新 PIN を設定。
```

### 検証項目 (修正後、Ryo 指定 4 項目 + Web CC 補強)

**※ 検証 4 (ロック) の前提ゲート**: 検証 0 (SETUP.md ドキュメント確認) を必ず先に通過させること。SETUP.md にロック解除手順が記載されていない状態でロック発生させると、検証 4 自体がブロッカー化する。

| # | ケース | 期待 |
|---|---|---|
| 0 | **(検証 4 の前提)** SETUP.md に「ロック解除手順」セクションあり、方法 1 (ScriptProperties.admin_pin_lockout 削除) と方法 2 (admin_setupPin 再実行) の両方が記載されている | 記載確認 OK → 検証 4 実行可。記載なし → BUG-003 起票してターミナル CC へ修正依頼 |
| 1 | `?role=dashboard` 初回アクセス | PIN 入力フォーム表示 |
| 2 | PIN 正解で submit | ダッシュボード表示、token が localStorage に保存 |
| 3 | PIN 誤りで submit | エラー表示「PIN が違います (残り N 回)」、ログイン画面のまま |
| 4 | PIN を 5 回連続で誤り | エラー「ロック中です」+ ロック解除時刻表示、15 分間ログイン不可。検証完了後すぐに SETUP.md 記載の方法 1 でロック解除して次の検証に支障を出さないこと |
| 5 | ログイン後にページ reload | localStorage の token が有効なのでダッシュボード即表示 (PIN 不要) |
| 6 | セッション切れ後 (12h 経過) reload | 「セッション切れ」、再度 PIN プロンプト |
| 7 | ログアウトボタン押下 | localStorage クリア + ScriptProperties から token 削除 + ログイン画面復帰 |
| 8 | 認証なしで g3_distributeResults を直接 google.script.run で呼ぶ | エラー「管理者認証が必要です」(_assertAdminAuth 効果) |
| 9 | `?id=MI-001` (parent ルート) | G-2 アップロード画面 (認証不要、PIN 影響なし) |
| 10 | 無指定 | G-1 申込フォーム (認証不要) |

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
