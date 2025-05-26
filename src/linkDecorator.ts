import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';

/**
 * エディタ内のリンクデコレーションを管理するクラス
 */
export class LinkDecorator {
    // リンクの装飾タイプ
    private linkDecorationType: vscode.TextEditorDecorationType;
    // リンク切れの装飾タイプ
    private brokenLinkDecorationType: vscode.TextEditorDecorationType; // 追加

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

        // リンク切れのスタイルを定義 (追加)
        this.brokenLinkDecorationType = vscode.window.createTextEditorDecorationType({
            color: '#ff3737', // リンク切れの色 (例: 赤)
            textDecoration: 'underline dotted', // 点線の下線 (例)
            // cursor: 'not-allowed' // カーソルを変更することも可能
        });

        // クリックイベントの登録
        this.registerLinkClickHandler();

        // ホバーイベントの登録
        this.registerHoverProvider();
    }

    /**
     * リンクのクリックハンドラを登録
     */
    private registerLinkClickHandler(): void {
        vscode.window.onDidChangeTextEditorSelection(async event => {
            const editor = event.textEditor;
            const selection = event.selections[0];

            // マウスによるクリック操作（選択範囲が空）の場合のみ処理
            if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse || !selection || !selection.isEmpty) {
                return;
            }

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
                                    await this.navigateToDestination(linkText); // await を追加
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Invalid regex pattern: ${patternStr}`, error);
                    }
                }
            }
        });
    }

    /**
     * ホバープロバイダーを登録
     */
    private registerHoverProvider(): void {
        vscode.languages.registerHoverProvider('*', { // すべてのファイルタイプを対象にする場合
            provideHover: async (document, position, token) => {
                const config = vscode.workspace.getConfiguration('linkPatterns');
                const links = config.get<any[]>('links') || [];
                // ホバー設定を取得 (追加)
                const hoverConfig = config.get<any>('hoverPreview') || { linesBefore: 0, linesAfter: 3 };


                const matchingLinkPattern = links.find(link =>
                    Array.isArray(link.links) && link.links.some((source: any) =>
                        source.includes &&
                        source.patterns &&
                        this.linkIndexer.isFileMatchGlob(document.fileName, source.includes)
                    )
                );

                if (!matchingLinkPattern) {
                    return null;
                }

                const patterns = matchingLinkPattern.links
                    .filter((source: any) =>
                        source.includes &&
                        this.linkIndexer.isFileMatchGlob(document.fileName, source.includes)
                    )
                    .map((source: any) => source.patterns);

                for (const patternStr of patterns) {
                    try {
                        const lineText = document.lineAt(position.line).text;
                        const matches = [...lineText.matchAll(new RegExp(patternStr, 'g'))];

                        for (const match of matches) {
                            if (match.index === undefined) continue;

                            const start = new vscode.Position(position.line, match.index);
                            const end = new vscode.Position(position.line, match.index + match[0].length);
                            const range = new vscode.Range(start, end);

                            if (range.contains(position)) {
                                const linkText = match[1] || match[0];
                                if (this.linkIndexer.hasDestination(linkText)) {
                                    const destinations = this.linkIndexer.getDestinations(linkText);
                                    if (destinations.length > 0) {
                                        // 最初の宛先情報を表示 (複数ある場合の考慮は別途)
                                        const destination = destinations[0];
                                        const destDoc = await vscode.workspace.openTextDocument(destination.uri);
                                        const relativePath = vscode.workspace.asRelativePath(destination.uri);

                                        // 設定に基づいて表示行数を調整 (変更)
                                        const startLine = Math.max(0, destination.range.start.line - hoverConfig.linesBefore);
                                        const endLine = Math.min(destDoc.lineCount - 1, destination.range.start.line + hoverConfig.linesAfter);


                                        let previewContent = '';
                                        for (let i = startLine; i <= endLine; i++) {
                                            const lineContent = destDoc.lineAt(i).text;
                                            if (i === destination.range.start.line) {
                                                previewContent += `**${i + 1}: ${lineContent}**\n`;
                                            } else {
                                                previewContent += `${i + 1}: ${lineContent}\n`;
                                            }
                                        }

                                        const markdownString = new vscode.MarkdownString();
                                        markdownString.appendMarkdown(`**Link Target:**\n`);
                                        markdownString.appendMarkdown(`[${relativePath}:${destination.range.start.line + 1}](${destination.uri})\n`);
                                        markdownString.appendCodeblock(previewContent, destDoc.languageId || 'plaintext');
                                        return new vscode.Hover(markdownString, range);
                                    }
                                } else { // リンク切れの場合のホバー (追加)
                                    const markdownString = new vscode.MarkdownString();
                                    markdownString.appendMarkdown(`**Broken Link:** \`${linkText}\` (Destination not found)`);
                                    return new vscode.Hover(markdownString, range);
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error in hover provider: ${error}`);
                        // パターンエラー時は次のパターンへ
                    }
                }
                return null;
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
        editor.setDecorations(this.brokenLinkDecorationType, []); // リンク切れ装飾もクリア (追加)


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
        const validRanges: vscode.Range[] = []; // 有効なリンクの範囲 (変更)
        const brokenRanges: vscode.Range[] = []; // リンク切れの範囲 (追加)
        try {
            const text = document.getText();
            const pattern = new RegExp(patternStr, 'g');

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
                        validRanges.push(range); // 有効なリンクとして追加 (変更)
                    } else {
                        console.log(`Found broken link: ${linkText} at line ${i + 1}`);
                        brokenRanges.push(range); // リンク切れとして追加 (追加)
                    }
                }
            }
        } catch (error) {
            console.error(`Error while decorating links: ${error}`);
        }

        // リンクの装飾を適用
        if (validRanges.length > 0) {
            console.log(`Decorating ${validRanges.length} valid links in ${document.fileName}`);
            editor.setDecorations(this.linkDecorationType, validRanges);
        }
        // リンク切れの装飾を適用 (追加)
        if (brokenRanges.length > 0) {
            console.log(`Decorating ${brokenRanges.length} broken links in ${document.fileName}`);
            editor.setDecorations(this.brokenLinkDecorationType, brokenRanges);
        }
    }

    /**
     * リソースをクリーンアップ
     */
    public dispose(): void {
        this.linkDecorationType.dispose();
        this.brokenLinkDecorationType.dispose(); // 追加
    }
}
