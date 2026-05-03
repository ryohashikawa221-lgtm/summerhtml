# BUGS.md — goudou_enshu_app バグ管理

このファイルは **動作検証担当 (Web Claude Code セッション)** から **実装担当 (ターミナル Claude Code セッション)** への修正依頼チケット集です。

- 起票: 動作検証担当 → ステータス `OPEN`
- 修正対応: 実装担当 → コミットメッセージで `Fix BUG-NNN: ...` と明記、ステータスを `FIXED` に
- 再検証: 動作検証担当 → ステータスを `VERIFIED` または `REOPENED` に

各バグには修正対象ファイル + 該当行 + 確定仕様を明記しています。判断不要で surgical に対応できる粒度で書く方針。

---

## Static Review Log (動作検証担当の静的レビュー結果集)

役割再定義 (2026-05-03): Web CC は静的コードレビュー専門。動的検証 (UI/E2E/認証フロー) は Ryo or Mac CC 担当。

### 2026-05-03 静的レビュー Round 1 (Day 0 Day 1 後の改訂版コード)

レビュー対象 (Ryo が貼付):
1. `gas_src/SETUP.md §6` (admin_setupPin + ロック解除手順)
2. `gas_src/api_Admin_Auth.gs` 全文
3. `gas_src/Code.gs` 全文

#### 検証 0 結果: SETUP.md ロック解除手順記載確認

**判定: PASS**

- 方法 1 (admin_setupPin 再実行) 記載あり ✓
- 方法 2 (admin_clearLockout 関数実行) 記載あり ✓ (実装で関数化、私の仕様より洗練)
- 検証 4 (5 回失敗ロック) を実行しても後続検証がブロッカー化しないことを保証

#### 検証 8 結果: `_assertAdminAuth` ガード位置確認

**判定: CONDITIONAL PASS**

- `api_Admin_Auth.gs` 末尾に `_assertAdminAuth(token)` 関数定義あり ✓
- 全 admin server-side API (`g3_*`, `g6_*`) の冒頭で呼出されているかは **次のレビューサイクル** (`api_G3_Notify.gs` / `api_G6_DocGen.gs` 受領時) に確認

#### 仕様適合サマリー

| ファイル | ✓ 適合 | ✗ 不適合 | ⚠ 要確認 | 💡 改善 |
|---|---|---|---|---|
| SETUP.md §6 | 8 件 | 0 | 0 | 1 件 (admin_clearLockout 関数化、実装が仕様超え) |
| api_Admin_Auth.gs | 10 件 | 1 件 → BUG-003 | 0 (paste artifact 解消済) | 5 件 (AuditLog 連携 / api_g3_* 命名 / purgeAllSessions / DEFAULT_ パターン / _formatJaTime) |
| Code.gs | 多数 | 0 | 3 件 → BUG-005 | 7 件 (?action=bootstrap / ?action=ping / _runFullBootstrap / _ensureUnifiedViewFormula / onOpen menu / v2 bootstrap 統合 / _getExamInfoForStudent) |

**ブロッカー**: 1 件 (BUG-003)、**マイナー逸脱**: 3 件 (BUG-005)、**全体評価**: 期待を上回る品質。

#### 動的検証担当 (Ryo) への引き継ぎ

静的では検出不可、Day 1 で実機確認が必要な項目:
- 検証 1〜7, 9〜10 (UI 動作・認証フロー・E2E)
- E2E シナリオ: MI-001/002/003 で G-1 → G-2 → G-3 完走
- モバイル実機での G-2 アップロード挙動
- 確認メールの実配信確認

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

## BUG-003: `setAdminPin` が既存セッション + ロックを clear しない

| | |
|---|---|
| 起票日 | 2026-05-03 (静的レビュー Round 1 で検出) |
| Severity | High (脱属人化要件の中核に影響) |
| Status | **OPEN (ターミナル CC 修正中)** |
| Reporter | 動作検証担当 (Web CC) |
| Assignee | 実装担当 (ターミナル CC) |

### 背景

BUG-002 修正 2-B (案A) の確定仕様では `admin_setupPin` (実装名: `setAdminPin`) で PIN ハッシュ更新時に **既存セッション全破棄 + ロックアウトカウンタ全クリア** を必須としていた。

実装 (`api_Admin_Auth.gs:setAdminPin`) は PIN hash の更新のみ行い、sessions / lockout のクリアを行っていない。

### 実害

- **A. 引継ぎ時の旧運用者残存セッション**: Ryo が新運用者へ引継ぎして PIN を変えても、旧運用者の localStorage に保存された旧 token は **最大 12h 有効のまま**。これは **脱属人化要件 (BUG-002 を Option A に決めた根拠そのもの) に直接違反**。
- **B. SETUP.md §6-3 方法1 の不正確化**: 「PIN を再設定 → 新 PIN でログイン → ロックアウトカウンタ自動リセット」と書いてあるが、ロック中は loginAdmin step (a) で弾かれるため、PIN 再設定だけではログインできない (admin_clearLockout 併用が必要)。

### 修正対象

`gas_src/api_Admin_Auth.gs` の `setAdminPin` 関数 (AdminAuth module 内、private)

**確定仕様 (修正後コード)**:

```javascript
function setAdminPin(plainPin) {
  var pin = String(plainPin || '').trim();
  if (!pin || pin.length < 4) throw new Error('PIN は 4 文字以上にしてください');
  var hash = Util.hashPassword(pin);
  Settings.set('admin_pin_hash', hash, 'BUG-002 案A: PIN の SHA-256 ハッシュ');
  // BUG-003: PIN 変更 = 引継ぎや緊急対応の合図。
  // 既存セッション + ロックを全クリアして即適用する (旧運用者残存セッション排除)。
  PropertiesService.getScriptProperties().deleteProperty(SESSIONS_KEY);
  PropertiesService.getScriptProperties().deleteProperty(LOCKOUT_KEY);
  AuditLog.log('reset_pin', 'admin_auth', '', null, {
    hash_prefix: hash.substring(0, 8) + '...',
    sessions_cleared: true,
    lockout_cleared: true
  });
  return {
    ok: true,
    hash_prefix: hash.substring(0, 8) + '...',
    sessions_cleared: true,
    lockout_cleared: true
  };
}
```

### 検証項目 (修正後)

| # | ケース | 期待 |
|---|---|---|
| 1 | 既存セッション (token 保持) で `admin_setupPin('newPin')` 実行 → 既存 token で `api_g3_verify` | 「無効なセッション」が返る (旧 token 失効) |
| 2 | ロック中 (5 回失敗状態) で `admin_setupPin('newPin')` 実行 → 新 PIN でログイン試行 | ロックエラーなしで成功 (即座にログイン可能) |
| 3 | `admin_setupPin('newPin')` の戻り値 | `{ ok: true, hash_prefix: '...', sessions_cleared: true, lockout_cleared: true }` |
| 4 | audit_log シート | `reset_pin` action 行が追加されている |

### 関連

- BUG-002 修正 2-B の確定仕様 (Web CC 起票時から書いていたが、ターミナル CC が初版実装で漏らした)
- SETUP.md §6-3 方法1 の正確性も BUG-003 修正で担保される

---

## BUG-005: Code.gs に BUG-001 確定仕様からの 3 点逸脱 + 改善 2 件まとめて反映

| | |
|---|---|
| 起票日 | 2026-05-03 (静的レビュー Round 1 で検出) |
| Severity | Medium (実害限定的だが整合性 + 監査性のため必須) |
| Status | **OPEN (ターミナル CC 修正中)** |
| Reporter | 動作検証担当 (Web CC) |
| Assignee | 実装担当 (ターミナル CC) |

### 背景

`Code.gs:doGet` は BUG-001 修正 1-A の確定仕様に対して 3 点の逸脱があり、また Web CC 静的レビューで提案した改善 2 件 (bootstrap AuditLog 記録 + dead code 削除) も Ryo が採用判断済。これら 5 点を 1 PR でまとめて反映する。

### 修正対象 (5 サブタスク)

#### 修正 5-A: legacy route `?role=upload` / `?role=apply` の削除

**現状** (`Code.gs:doGet` L52-58):
```javascript
if (role === 'upload') {
  return _renderUploadPage(e.parameter.id || '');
}
if (role === 'apply') {
  return _renderApplyPage();
}
```

**修正後**: 上記 2 ブロックを **削除**。`?role=upload` / `?role=apply` は廃止し、確定仕様の 3 ルート (`?id=` / `?role=dashboard` / 無指定) のみ。

#### 修正 5-B: `id` 優先順位の `&& !role` 条件を削除

**現状** (`Code.gs:doGet` L48-50):
```javascript
if (e && e.parameter && e.parameter.id && !role) {
  return _renderUploadPage(e.parameter.id);
}
```

**修正後**:
```javascript
if (e && e.parameter && e.parameter.id) {
  return _renderUploadPage(e.parameter.id);
}
```

これにより `?id=MI-001&role=dashboard` でも `?id=MI-001&role=upload` でも常に G-2 が優先される (確定仕様検証項目 5「id 優先で role 無視」の原則準拠)。

#### 修正 5-C: ヘッダコメント (L4-6) を新仕様で書き換え

**現状**:
```javascript
 * URL ルーティング (HANDOFF G-2 シーケンス §4):
 *   {WebAppURL}?role=upload&id={受験番号}  → G-2 答案アップロード画面
 *   {WebAppURL}?role=apply                  → G-1 申込フォーム
 *   {WebAppURL}                             → 既定: G-1 申込フォーム
```

**修正後**:
```javascript
 * URL ルーティング (BUG-001 確定仕様 2026-05-03):
 *   {WebAppURL}?id={受験番号}     → G-2 答案アップロード画面 (parent)
 *   {WebAppURL}?role=dashboard    → G-3 管理者ダッシュボード (PIN 認証要)
 *   {WebAppURL}                   → G-1 申込フォーム (default)
 *   {WebAppURL}?action=bootstrap&secret={secret}  → 自走 setup (運用ツール)
 *   {WebAppURL}?action=ping       → health check
 *
 * id があれば常に G-2 優先 (role 無視、検証項目 5 準拠)。
```

#### 修正 5-D: `?action=bootstrap` の AuditLog 記録追加 (改善 #1)

**修正後**:
```javascript
if (action === 'bootstrap') {
  var secret = (e && e.parameter && e.parameter.secret) || '';
  var expected = PropertiesService.getScriptProperties().getProperty('APP_BOOTSTRAP_SECRET') || '';
  if (!expected || secret !== expected) {
    AuditLog.log('remote_bootstrap_denied', 'system', '', null, {
      reason: !expected ? 'secret_not_set' : 'secret_mismatch',
      triggered_at: Util.nowIso()
    });
    return ContentService.createTextOutput(JSON.stringify({ /* ... */ }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  AuditLog.log('remote_bootstrap', 'system', '', null, {
    triggered_at: Util.nowIso()
  });
  var bootstrapReport = _runFullBootstrap();
  // ... 既存処理
}
```

denied / 成功どちらも記録すると、secret 漏洩時の検知能力が上がる。

#### 修正 5-E: `_renderForbidden` dead code 削除 (改善 #2)

`Code.gs` L70-77 の `_renderForbidden` 関数定義を削除 (どこからも呼ばれていない、BUG-002 案 C 検討時の名残)。

### 検証項目 (修正後)

| # | ケース | 期待 |
|---|---|---|
| 1 | `?role=upload&id=MI-001` | G-2 表示 (id 優先で動作変わらず) |
| 2 | `?role=apply` | G-1 表示 (route 削除で fallback、動作変わらず) |
| 3 | `?role=upload` (id なし) | G-1 表示 (route 削除で fallback) ※修正前はエラー画面 |
| 4 | `?id=MI-001&role=dashboard` | G-2 表示 (id 優先で role 無視) ※修正前は dashboard 表示 |
| 5 | `?action=bootstrap&secret=正` | 成功 + audit_log に `remote_bootstrap` 行 |
| 6 | `?action=bootstrap&secret=誤` | エラー + audit_log に `remote_bootstrap_denied` 行 |
| 7 | `grep -n _renderForbidden Code.gs` | hit 0 (削除確認) |
| 8 | ヘッダコメントの URL ルーティング表 | BUG-001 新仕様 (3 ルート + 2 action) を反映 |

### 関連

- BUG-001 修正 1-A 確定仕様
- 改善 #1 / 改善 #2 (Web CC レビュー Code.gs Round 1 提案、Ryo 判断 2026-05-03 採用)

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
