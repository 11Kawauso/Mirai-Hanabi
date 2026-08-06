# オンラインランキングの設定手順（Firebase Realtime Database）

現在ランキングは **端末内モード** で動いています。以下を設定すると全プレイヤー共通になります。
未設定のままでも、そのまま提出して問題ありません（端末内ランキングとして動作します）。

**SDKもAPIキーも不要です。** データベースのURLひとつを貼るだけで、`fetch` が直接REST APIを
叩きます。ファイル構成は3つのままです。

> **なぜ Firestore ではなく Realtime Database か**
> Firestore は約100KBの外部SDKを読み込む必要があり、並び替え取得も構造化クエリをPOSTする
> 形式で冗長です。「1つの配列を並べ替えて上位を取る」だけの用途では Realtime Database の
> RESTがそのまま使えて、依存ゼロを保てます。

---

## 1. Firebase プロジェクトを作る

1. https://console.firebase.google.com にGoogleアカウントでログイン
2. **プロジェクトを追加** → プロジェクト名（例: `mirai-hanabi`）
3. Googleアナリティクスは **オフでOK**（不要です）
4. 作成完了まで1分ほど待つ

## 2. Realtime Database を作る

1. 左メニュー **構築 → Realtime Database** を開く
2. **データベースを作成** を押す
3. ロケーションは **asia-southeast1（シンガポール）** が国内から最速です
4. セキュリティルールは **ロックモードで開始** を選ぶ（次の手順で書き換えます）

作成後、画面上部に表示される **URL** をコピーしておきます。

```
https://mirai-hanabi-default-rtdb.asia-southeast1.firebasedatabase.app
```

## 3. セキュリティルールを設定する

**ルール** タブを開き、中身を全部消して以下を貼り、**公開** を押します。

```json
{
  "rules": {
    "scores": {
      ".read": true,
      ".indexOn": ["score"],
      "$client": {
        ".write": "newData.exists() && (!data.exists() || newData.child('score').val() >= data.child('score').val())",
        ".validate": "newData.hasChildren(['name','score'])",
        "name": {
          ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 12"
        },
        "score": {
          ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100000"
        },
        "$other": { ".validate": false }
      }
    }
  }
}
```

`$client` はブラウザごとに1つ発行される固定IDです。**1ブラウザ＝1行**になり、名前を変えても
行が増えず、同じ名前を別のブラウザで使っても別の行として記録されます。

このルールが効かせていること:

| ルール | 効果 |
|---|---|
| `.read: true` | 誰でもランキングを読める |
| `newData.exists()` | **削除できない** |
| `score >= 既存` | **記録を下げられない。** 同じ点数での書き直し（改名）は通る |
| `.indexOn` | `orderBy="score"` での取得に必要 |
| `name` の検証 | 1〜12文字の文字列のみ |
| `score` の検証 | 0〜100,000 の数値のみ |
| `$other: false` | 想定外のフィールドを弾く |

## 4. script.js に貼り付ける

`script.js` の上のほう、`// ---- ranking` の直下にあります。

```js
const RANKING_DB = '';    // ← ここにURLを
```

こう書き換えます（**末尾のスラッシュは付けない**）。

```js
const RANKING_DB = 'https://mirai-hanabi-default-rtdb.asia-southeast1.firebasedatabase.app';
```

保存してページを再読み込みすれば、ランキング上部の表示が
「この端末の記録（オンライン未設定）」から **「全プレイヤー共通」** に変わります。

---

## 動作確認

ブラウザで直接開いても中身を確認できます。

```
https://（あなたのURL）/scores.json
```

`null` なら空、記録があればJSONが返ります。

## 仕様

- **送信タイミング**: 自己ベストを更新したときだけ。同じ記録で何度も送られません
- **表示**: 上位30件。同じ名前は最高記録だけに集約されます
- **自分の順位**: 30位以内なら該当行がピンクで強調され、圏外なら一覧の下に別途表示されます
- **通信できないとき**: 自動的に端末内の記録へ切り替わります。ゲームは止まりません
- **開発モード**（`?h=` や `?skins`）では送信されません

## 注意点

**データベースのURLはページを見れば誰でも分かります。** これはRealtime Databaseの想定内で、
実際の防御は上のセキュリティルールです。既存の記録を消したり書き換えたりはできませんが、
**新しい記録を投稿すること自体は誰でもできます**。クライアントだけで完結するランキングの
原理的な限界です。

コンテスト展示程度なら実用上問題ありませんが、荒らされた場合は Firebase コンソールの
**データ** タブから該当データを手動で削除できます。厳密な不正対策が必要なら、
Cloud Functions などサーバー側での検証が別途必要になります。

## 無料枠について

Realtime Database の無料枠（Sparkプラン）は **同時接続100・保存1GB・転送10GB/月** です。
このゲームは1回の読み込みで数KBしかやり取りしないため、コンテスト展示の規模なら
まず超えません。クレジットカードの登録も不要です。
