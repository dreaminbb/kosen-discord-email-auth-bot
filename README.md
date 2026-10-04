# kosen-auth-discord-bot

Discord の利用者を Discord OAuth と学校メールで確認し、期限付きロールを付与する仕組みです。Discord Bot は認証 URL を DM し、Google Apps Script Web App が OAuth、受信メールのヘッダー検証、ロール操作を行います。

## Bot

```bash
bun install
bun run index.ts
```

Bot の `.env` には以下を設定します。`AUTH_WEB_APP_URL` は Apps Script Web App の `/exec` URL です。

```dotenv
BOT_TOKEN=
BOT_CLIENT_ID=
BOT_GUILD_ID=
AUTH_WEB_APP_URL=
BOT_VERIFIED_ROLE_ID=
```

`AUTH_WEB_APP_URL` は Apps Script Web App の `/exec` URL です。例: `https://script.google.com/macros/s/.../exec`。`BOT_VERIFIED_ROLE_ID` は Apps Script の `DISCORD_VERIFIED_ROLE_ID` と同じ Discord ロール ID を設定します。

起動時にグローバルな `/auth-dm` と `/auth-status` コマンドを Discord に登録します。前者は利用者へ認証ページ URL を DM し、後者は付与済みロールから認証状態を表示します。Bot を起動する Discord アカウントには、付与するロールより上位のロールと `Manage Roles` 権限が必要です。

## Apps Script の設定

1. 認証専用 Gmail の Google アカウントで新しい Apps Script プロジェクトを作ります。Web エディタの `コード.gs` に `apps-script/Code.js` の内容を貼り付けます。
2. 左の歯車アイコンの **プロジェクトの設定** で **「エディタで appsscript.json マニフェスト ファイルを表示する」** を有効にします。表示された `appsscript.json` に `apps-script/appsscript.json` の内容を貼り付けます。ファイルのアップロードは不要です。
3. 左の **サービス** の `+` から **Gmail API** を追加し、リンク先の Google Cloud プロジェクトでも Gmail API を有効化します。
4. スクリプトに紐付けない Google Sheet を作成し、その ID を控えます。
5. Apps Script を Web App としてデプロイします。実行ユーザーは認証専用 Gmail、アクセスできるユーザーは認証対象に合わせて設定し、発行された `/exec` URL を控えます。
6. Script Properties に下表の値をすべて設定します。秘密情報は Sheet、ソース、`.env` に保存しません。未設定の Property がある状態で Web App を開くと Apps Script のエラーページが表示されます。
7. `/exec?action=callback` URL を Discord Developer Portal の OAuth2 Redirects と `DISCORD_REDIRECT_URI` に同じ値で設定します。Bot の `AUTH_WEB_APP_URL` にはクエリを付けない `/exec` URL を設定します。
8. Apps Script エディタから `setupSpreadsheet` を一度実行し、`VerificationTokens`、`Verifications`、`Schools` の各シートを作成します。続けて `installTriggers` を一度実行し、必要な権限を承認して、1 分ごとのメール確認と 1 時間ごとの期限切れロール削除を作成します。

| Property | 値 |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord Application Client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth2 Client Secret |
| `DISCORD_REDIRECT_URI` | Web App の `/exec?action=callback` URL（Developer Portal と完全一致させる） |
| `DISCORD_BOT_TOKEN` | ロール操作用 Bot Token |
| `DISCORD_GUILD_ID` | 対象 Discord サーバー ID |
| `DISCORD_VERIFIED_ROLE_ID` | 認証済みユーザーに付与するロール ID |
| `VERIFICATION_INBOX` | 受信専用 Gmail アドレス |
| `SPREADSHEET_ID` | 管理用 Google Sheet ID |
| `EMAIL_HMAC_KEY` | 十分に長いランダムな秘密値 |

## 学校ドメイン表

`Schools` シートには下記の列をこの順序で入力します。`AllowedDomain` はワイルドカードではなく、実際の送信元メールの完全なドメインだけを入力してください。

| SchoolId | SchoolName | AllowedDomain | Assurance | SourceUrl | LastCheckedAt | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 文科省学校コード | 学校名 | `example.kosen.ac.jp` | `student_only` または `school_member` | 公式の学生向けメール案内 URL | `YYYY-MM-DD` | `verified` |

`Status=verified` の行だけが自動認証されます。公式根拠を確認できない候補は `pending` にし、Web サイトのドメインや `*.ac.jp` を登録しません。`student_only` は学生専用ドメインを公式資料で確認できた場合だけ使用します。

## 判定と保持データ

メール件名は正確に `[KOSEN-AUTH] <code>` と一致する必要があります。コードは 10 分で失効し、成功時に一度だけ使用済みになります。不正な候補メールは同じコードにつき 5 回まで許可します。

送信元 `From` ドメインが `verified` の完全一致ドメインであり、次のいずれかを満たす場合だけ認証します。

```text
DMARC=pass
DKIM=pass かつ header.i/header.d のドメインが From と完全一致
SPF=pass かつ smtp.mailfrom のドメインが From と完全一致
```

Gmail API は受信メールの raw ヘッダーだけを読むため、本文、氏名、平文メールアドレスは保存しません。認証記録には Discord user ID、学校 ID、確認日時、1 年後の失効日時、メールアドレスの HMAC、付与ロールだけを保存します。失効時は Apps Script がロールを削除します。
