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
var webAppBase = Settings.getParentWebAppUrl();
if (!webAppBase) {
  webAppBase = '(管理者: m_設定 の web_app_url_parent を設定してください)';
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

**修正後 (BUG-002 Option C 採用に伴い、parent / admin の 2 deployment 前提)**:

```javascript
// 旧 normalizeWebAppUrl / setWebAppUrl / getWebAppUrl は廃止。
// 以下 4 関数に置換する。

function getParentWebAppUrl() {
  return get('web_app_url_parent', '');  // bare URL、?id=XX は呼出側で付与
}

function setParentWebAppUrl(url) {
  if (!url) throw new Error('URL is required');
  set('web_app_url_parent', String(url),
      'parent (anonymous) deployment の WebApp URL。?id=XX は送信時に付与する。');
  return url;
}

function getAdminWebAppUrl() {
  // defense in depth: 保存値に ?role=dashboard が無くても付与して返す
  var url = get('web_app_url_admin', '');
  if (!url) return '';
  if (/[?&]role=dashboard/.test(url)) return url;
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'role=dashboard';
}

function setAdminWebAppUrl(rawUrl) {
  if (!rawUrl) throw new Error('URL is required');
  // 保存時にも ?role=dashboard を強制付与
  var u = String(rawUrl);
  if (!/[?&]role=dashboard/.test(u)) {
    u += (u.indexOf('?') >= 0 ? '&' : '?') + 'role=dashboard';
  }
  set('web_app_url_admin', u,
      'admin (MYSELF_ONLY) deployment の WebApp URL。?role=dashboard 強制付与済。');
  return u;
}
```

bootstrap defaults の変更:
- 削除: `upload_web_app_url`, `apply_web_app_url`
- 追加: `web_app_url_parent`, `web_app_url_admin`

```javascript
// lib_Settings.gs:bootstrap() の defaults
web_app_url_parent: '',
web_app_url_admin: '',
```

return 句から `normalizeWebAppUrl` / `setWebAppUrl` / `getWebAppUrl` を削除し、以下 4 つを export:
```javascript
return {
  // ...
  getParentWebAppUrl: getParentWebAppUrl,
  setParentWebAppUrl: setParentWebAppUrl,
  getAdminWebAppUrl: getAdminWebAppUrl,
  setAdminWebAppUrl: setAdminWebAppUrl,
  // ...
};
```

### 検証項目 (修正後)
| ケース | 期待 |
|---|---|
| `<parent_url>?id=MI-001` | G-2 アップロード画面が表示される |
| `<parent_url>?id=` (空) | G-1 申込フォームが表示される (id 空なので) |
| `<parent_url>` | G-1 申込フォームが表示される |
| `<admin_url>?role=dashboard` | G-3 管理者ダッシュボード (Google SSO で Ryo のみ閲覧可能、BUG-002 参照) |
| `<parent_url>?role=upload&id=MI-001` | G-2 が表示される (id があるため、role は無視) |
| 確認メール内 URL | parent URL に `?id=MI-001` 付きで保護者がワンタップで G-2 に到達 |

### 既存 Settings 行のクリーンアップ (運用)
すでに `upload_web_app_url` / `apply_web_app_url` を `m_設定` に投入済みの環境では、bootstrap 後に手動で:
- 旧キーの行を削除 or 値を空に (used されない)
- 新規 `web_app_url_parent` / `web_app_url_admin` キーに正しい URL を投入

migration スクリプト不要 (Settings.bootstrap() は既存行を上書きしないため)。

---

## BUG-002: ダッシュボード (`?role=dashboard`) に管理者認証がない

| | |
|---|---|
| 起票日 | 2026-05-03 |
| Severity | High (情報漏洩 + 誤操作リスク) |
| Status | **OPEN (Ryo 判断 C 確定 2026-05-03)** |
| Reporter | 動作検証担当 (Web CC) |
| Assignee | 実装担当 (ターミナル CC) |

### 確定仕様: Option C (別 deployment + Google SSO)

Ryo 判断 (2026-05-03):
- **A** (PIN 認証) は 14 日のスケジュール内で 1〜2 日の認証実装は重い → 却下
- **B** (Google 認証で混在) は parent flow と衝突 → 却下
- **C** (別 deployment + MYSELF_ONLY) は実装ほぼゼロでセキュリティ最強 (Google SSO) → **採用**

### 確定仕様

```
deployment-parent : ANYONE_ANONYMOUS, executeAs USER_DEPLOYING (= Ryo)
deployment-admin  : MYSELF_ONLY,      executeAs USER_ACCESSING (= 開いた人)
```

m_設定 シートに 2 つの URL 列を持つ:
- `web_app_url_parent` : parent (anonymous) deployment URL
- `web_app_url_admin`  : admin (MYSELF_ONLY) deployment URL (`?role=dashboard` 強制付与済)

Code.gs:doGet は **変更なし**。Google deployment 設定 (MYSELF_ONLY) が認証層を担う。
保護者が admin URL を踏んでも Google 側で「アクセス権がありません」エラーになる。

### 修正対象 (3 箇所、いずれも軽微)

#### 修正 2-A: `gas_src/lib_Settings.gs` の bootstrap defaults

BUG-001 修正 1-C で既に対応 (`web_app_url_parent` / `web_app_url_admin` 追加)。
BUG-002 では **`getAdminWebAppUrl` / `setAdminWebAppUrl` の defense in depth** が役立つ。
具体的には `setAdminWebAppUrl` 保存時 + `getAdminWebAppUrl` 取得時の両方で `?role=dashboard` を強制付与済 (BUG-001 の修正後コード参照)。

#### 修正 2-B: `gas_src/SETUP.md` に「2 つ目の deployment 作成手順」を追記

現状の SETUP.md `### 7. WebApp デプロイ` セクションを以下で置換:

```markdown
### 7. WebApp デプロイ (parent / admin の 2 deployment)

#### 7-1. parent deployment (保護者向け、anonymous アクセス)

GAS エディタ → デプロイ → 新しいデプロイ → 種類「ウェブアプリ」

| 項目 | 値 |
|---|---|
| 説明 | parent deployment (anonymous) |
| 実行アカウント | 自分 (Ryo) |
| アクセス権 | 全員 (anonymous) |

デプロイ完了後の URL を保存:
```javascript
Settings.setParentWebAppUrl('https://script.google.com/macros/s/.../exec');
```

#### 7-2. admin deployment (管理者向け、Google SSO)

同じく デプロイ → 新しいデプロイ → 種類「ウェブアプリ」

| 項目 | 値 |
|---|---|
| 説明 | admin deployment (MYSELF_ONLY) |
| 実行アカウント | **アクセスしているユーザー** (USER_ACCESSING) |
| アクセス権 | **自分のみ** (MYSELF_ONLY) |

デプロイ完了後の URL を保存:
```javascript
Settings.setAdminWebAppUrl('https://script.google.com/macros/s/.../exec');
// `?role=dashboard` は内部で自動付与されます
```

#### 7-3. ブックマーク

Ryo はブラウザのブックマークに以下 2 つを登録:
- 「合同演習会 parent (申込テスト用)」: parent URL
- 「合同演習会 admin (ダッシュボード)」: `Settings.getAdminWebAppUrl()` の戻り値 (admin URL + ?role=dashboard)

#### 7-4. 確認: parent URL で `?role=dashboard` を踏むと

parent deployment は anonymous なので何の制限もないが、Code.gs:doGet は
**id 優先 + role=dashboard も受付** するため、ダッシュボード HTML が返ってしまう
**ように見える**。

ただし server-side API (g3_*) は parent URL でも動作するため、データ漏洩リスクが残る。

→ **対策**: deployment-parent の Code.gs:doGet で `?role=dashboard` の場合に
「アクセス権がありません」を返す簡易ガードを追加すべき (修正 2-C)。

#### 修正 2-C (追加): parent deployment で dashboard ルートを塞ぐ

`gas_src/Code.gs:doGet` を以下に修正:

```javascript
function doGet(e) {
  var params = (e && e.parameter) || {};
  var id = params.id || '';
  var role = params.role || '';
  try {
    if (id) {
      return _renderUploadPage(id);
    }
    if (role === 'dashboard') {
      // admin deployment 経由でしかダッシュボードを返さない
      // USER_ACCESSING で running なら必ず Session.getActiveUser().getEmail() が取得可能
      // anonymous deployment では空文字列が返るため、それでガードする
      var userEmail = '';
      try { userEmail = Session.getActiveUser().getEmail() || ''; } catch (err) {}
      if (!userEmail) {
        return _renderForbidden('管理者ダッシュボードはこの URL から開けません。管理者の URL をご利用ください。');
      }
      // Optional: m_設定.admin_emails 許可リストとの照合 (将来拡張)
      return _renderDashboardPage();
    }
    return _renderApplyPage();
  } catch (err) {
    return _renderError(err);
  }
}

function _renderForbidden(msg) {
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>アクセス権がありません</title></head>' +
    '<body style="font-family:sans-serif;padding:40px;max-width:560px;margin:auto">' +
    '<h2 style="color:#c0392b">アクセス権がありません</h2>' +
    '<p>' + Util.escapeHtml(msg) + '</p></body></html>';
  return HtmlService.createHtmlOutput(html);
}
```

**根拠**:
- parent deployment は `executeAs: USER_DEPLOYING` + anonymous なので `Session.getActiveUser().getEmail()` は **空文字列**
- admin deployment は `executeAs: USER_ACCESSING` + MYSELF_ONLY なので **必ず Ryo のメールが取れる**
- この差で deployment 区別できる

これで parent URL を踏んだ第三者が `?role=dashboard` を試しても弾かれる。

#### 修正 2-D (任意、防御深化): server-side API ガード

api_G3_Notify.gs の `g3_distributeResults` / `g3_setBulkMailEnabled` 等、
admin-only であるべき関数の冒頭で同様の email チェックを足すと、
万一 parent URL から google.script.run が呼ばれた場合の保険になる:

```javascript
function _assertAdmin() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  if (!email) throw new Error('管理者権限が必要です');
}

function g3_distributeResults(opts) {
  _assertAdmin();
  // ... 既存処理
}
function g3_setBulkMailEnabled(enabled) {
  _assertAdmin();
  // ... 既存処理
}
function g3_populateGrading() {
  _assertAdmin();
  // ... 既存処理
}
function g3_computeRankings() {
  _assertAdmin();
  // ... 既存処理
}
```

修正 2-D は **任意** だが kill switch + 配信ボタンの誤操作リスクを下げるので推奨。

### 検証項目 (修正後、Ryo 指定 + Web CC 追加)
| # | ケース | 期待 |
|---|---|---|
| 1 | parent URL で `?id=MI-001` | G-2 アップロード画面 |
| 2 | parent URL で `?role=dashboard` | 「アクセス権がありません」表示 (修正 2-C 効果) |
| 3 | parent URL で `?role=dashboard` から google.script.run で `g3_distributeResults` 呼出 (DevTools 経由) | エラー「管理者権限が必要です」(修正 2-D 効果、任意) |
| 4 | admin URL を未ログインで開く | Google ログイン画面 |
| 5 | admin URL を Ryo 以外のアカウントで開く | Google「アクセス権がありません」(MYSELF_ONLY 効果) |
| 6 | admin URL で `?role=dashboard` を Ryo アカウントで開く | ダッシュボード表示 + Ryo の email 取得済 |
| 7 | admin URL で `?id=MI-001` を Ryo アカウントで開く | G-2 画面 (Ryo も parent 動作確認できる) |

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
