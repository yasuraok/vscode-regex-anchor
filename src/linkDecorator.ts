import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';

/**
 * エディタ内のリンクデコレーションを管理するクラス
 */
export class LinkDecorator {
    // リンクの装飾タイプ
    private linkDecorationType: vscode.TextEditorDecorationType;

    /**
     * コンストラクタ
     * @param linkIndexer リンクインデクサー
     */
    constructor(private readonly linkIndexer: LinkIndexer) {
        // リンクのスタイルを定義
        this.linkDecorationType = vscode.window.createTextEditorDecorationType({
            color: '#3794ff', // リンクの色
            textDecoration: 'underline', // 下線を表示
            cursor: 'pointer' // カーソルをポインタに変更
        });

        // クリックイベントの登録
        this.registerLinkClickHandler();
    }

    /**
     * リンクのクリックハンドラを登録
     */
    private registerLinkClickHandler(): void {
        vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;
            const selection = event.selections[0];

            if (selection && selection.isEmpty) {
                // カーソル位置のテキストを取得
                const document = editor.document;
                const position = selection.active;

                // 現在のファイルに適用されるリンクパターンを探す
                const config = vscode.workspace.getConfiguration('linkPatterns');
                const links = config.get<any[]>('links') || [];

                // ファイルに一致するリンクパターンを検索
                const matchingLink = links.find(link =>
                    Array.isArray(link.links) && link.links.some((source: any) =>
                        source.includes &&
                        source.patterns &&
                        this.linkIndexer.isFileMatchGlob(document.fileName, source.includes)
                    )
                );

                if (matchingLink) {
                    // このファイルに適用される全パターンを取得
                    const patterns = matchingLink.links
                        .filter((source: any) =>
                            source.includes &&
                            this.linkIndexer.isFileMatchGlob(document.fileName, source.includes)
                        )
                        .map((source: any) => source.patterns);

                    // 各パターンで試行
                    for (const patternStr of patterns) {
                        try {
                            // カーソル位置の単語を取得
                            // 正規表現が不正な場合は次のパターンを試す
                            const pattern = new RegExp(patternStr);
                            const line = document.lineAt(position.line).text;
                            const lineRange = document.lineAt(position.line).range;

                            // この行で正規表現にマッチする部分を探す
                            const matches = [...line.matchAll(new RegExp(patternStr, 'g'))];

                            for (const match of matches) {
                                if (match.index === undefined) continue;

                                const startPos = new vscode.Position(position.line, match.index);
                                const endPos = new vscode.Position(position.line, match.index + match[0].length);
                                const matchRange = new vscode.Range(startPos, endPos);

                                // カーソルがマッチ範囲内にある場合
                                if (matchRange.contains(position)) {
                                    // キャプチャグループがある場合は最初のグループを使用、なければマッチ全体
                                    const linkText = match[1] || match[0];

                                    // インデックス内にあるかどうかを確認
                                    if (this.linkIndexer.hasDestination(linkText)) {
                                        // リンク先に移動
                                        this.navigateToDestination(linkText);
                                        return;
                                    }
                                }
                            }
                        } catch (error) {
                            console.error(`Invalid regex pattern: ${patternStr}`, error);
                        }
                    }
                }
            }
        });
    }

    /**
     * リンク先に移動
     */
    private async navigateToDestination(text: string): Promise<void> {
        const destinations = this.linkIndexer.getDestinations(text);

        if (destinations.length === 0) {
            return;
        }

        if (destinations.length === 1) {
            // 宛先が1つだけの場合は直接ジャンプ
            await this.openLocation(destinations[0]);
        } else {
            // 複数の宛先がある場合はクイックピックを表示
            const items = destinations.map(location => {
                const path = vscode.workspace.asRelativePath(location.uri);
                return {
                    label: path,
                    description: `Line ${location.range.start.line + 1}`,
                    location
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select destination'
            });

            if (selected) {
                await this.openLocation(selected.location);
            }
        }
    }

    /**
     * 場所を開く
     */
    private async openLocation(location: vscode.Location): Promise<void> {
        const document = await vscode.workspace.openTextDocument(location.uri);
        const editor = await vscode.window.showTextDocument(document);

        // カーソルを位置に移動してビューを調整
        editor.selection = new vscode.Selection(location.range.start, location.range.start);
        editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
    }

    /**
     * エディタの装飾を更新
     */
    public updateDecorations(editor: vscode.TextEditor): void {
        if (!editor) {
            return;
        }

        const document = editor.document;
        const config = vscode.workspace.getConfiguration('linkPatterns');
        const links = config.get<any[]>('links') || [];

        // すべてのリンク装飾をクリア
        editor.setDecorations(this.linkDecorationType, []);

        // 有効な設定のみフィルタリング
        const validLinks = links.filter(link =>
            Array.isArray(link.links) &&
            link.links.length > 0
        );

        // リンク対象のファイルを探す
        for (const link of validLinks) {
            // ファイルに一致するリンク設定を探す
            const matchingSource = link.links.find((source: any) =>
                source.includes &&
                source.patterns &&
                this.linkIndexer.isFileMatchGlob(document.fileName, source.includes)
            );

            if (matchingSource) {
                console.log(`File ${document.fileName} matches link source pattern ${matchingSource.includes}`);
                this.decorateLinksInDocument(editor, document, matchingSource.patterns);
                break; // 最初に一致した設定のみ使用
            }
        }
    }

    /**
     * ドキュメント内のリンクを装飾
     */
    private decorateLinksInDocument(editor: vscode.TextEditor, document: vscode.TextDocument, patternStr: string): void {
        try {
            const text = document.getText();
            const pattern = new RegExp(patternStr, 'g');
            const ranges: vscode.Range[] = [];

            // 行ごとに処理してパフォーマンス向上と正確なマッチングを実現
            const lines = text.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const matches = [...line.matchAll(pattern)];

                for (const match of matches) {
                    if (match.index === undefined) continue;

                    // キャプチャグループがある場合は最初のグループを使用、なければマッチ全体を使用
                    const linkText = match[1] || match[0];

                    const startPos = new vscode.Position(i, match.index);
                    const endPos = new vscode.Position(i, match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);

                    // インデックスにリンク先が存在するか確認
                    if (this.linkIndexer.hasDestination(linkText)) {
                        console.log(`Found link: ${linkText} at line ${i + 1}`);
                        ranges.push(range);
                    }
                }
            }
        } catch (error) {
            console.error(`Error while decorating links: ${error}`);
        }

        // リンクの装飾を適用
        if (ranges.length > 0) {
            console.log(`Decorating ${ranges.length} links in ${document.fileName}`);
            editor.setDecorations(this.linkDecorationType, ranges);
        }
    }

    /**
     * リソースをクリーンアップ
     */
    public dispose(): void {
        this.linkDecorationType.dispose();
    }
}
