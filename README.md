# Regex Anchor

Create cross-file workspace anchor links from any regex pattern.

VSCode拡張機能: 正規表現で指定したパターンを、ワークスペース内ファイルへのアンカーリンクに。

## 機能

* settings.jsonで定義したパターンに基づいて、ファイル内のテキストを別のファイル内の対応する場所へのリンクとして機能させます
* リンク先は自動的にインデックス化され、簡単にナビゲーションできます

## 使用方法

1. `settings.json`に以下のような設定を追加します:

```json
{
    "regexAnchor.rules": [
        {
            "from": [
                {
                    "includes": "doc/*.md",
                    "patterns": "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
                }
            ],
            "to": [
                {
                    "includes": "src/*.yaml",
                    "patterns": "id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
                }
            ]
        }
    ]
}
```

2. 上記の例では、`doc/*.md`内のUUID形式のテキストが`src/*.yaml`ファイル内の対応する`id: <uuid>`行へのリンクになります
3. リンクをクリックすると、対応する宛先ファイルの該当行に移動します

## 動作例

* `doc/sample.md`ファイル内の`550e8400-e29b-41d4-a716-446655440000`のようなUUIDをクリックすると
* `src/config.yaml`内の`id: 550e8400-e29b-41d4-a716-446655440000`という行に移動します

## コマンド

* `Regex Anchor: Refresh Link Index`: リンクインデックスを手動で更新します

## 開発者向け情報

このセクションでは、拡張機能の開発に関する情報を提供します。

### 開発環境のセットアップ

1. リポジトリをクローンします
2. 依存関係をインストールします:
   ```bash
   npm install
   ```

### テストの実行

#### 単体テストの実行

以下のコマンドで単体テストを実行できます：

```bash
npm test
```

この単体テストでは、実際のVSCode APIではなくモックを使用し、拡張機能のコア機能をテストします。

#### デバッグ実行

拡張機能を実際に動作させる場合は、以下の手順を実行してください：

1. VSCodeでプロジェクトを開きます
2. F5キーを押します (またはデバッグメニューから「実行」を選択)
3. 新しいVSCodeウィンドウが開き、拡張機能がデバッグモードで実行されます

### ビルド方法

VSIXパッケージをビルドするには:

```bash
npm run package
```

ビルドされたVSIXファイルは、`dist`ディレクトリに生成されます。

### Visual Studio Code Marketplaceへのデプロイ

Marketplaceへ拡張機能をパブリッシュするには:

1. Visual Studio Code拡張機能のパブリッシャーIDを取得します (初回のみ)
2. 以下のコマンドを実行します:
   ```bash
   npm run publish
   ```

詳細なパブリッシュ手順については、[VSCode公式ドキュメント](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)を参照してください。
