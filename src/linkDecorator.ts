import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';

/**
 * エディタ内のリンクデコレーションを管理するクラス
 */
export class LinkDecorator {
    // リンクの装飾タイプ
    private linkDecorationType: vscode.TextEditorDecorationType;
    // リンク切れの装飾タイプ
    private brokenLinkDecorationType: vscode.TextEditorDecorationType;

    /**
     * コンストラクタ
     * @param linkIndexer リンクインデクサー
     */
    constructor(private readonly linkIndexer: LinkIndexer) {
        // リンクのスタイルを定義
        this.linkDecorationType = vscode.window.createTextEditorDecorationType({
            color: '#3794ff',
            textDecoration: 'underline',
            cursor: 'pointer'
        });

        this.brokenLinkDecorationType = vscode.window.createTextEditorDecorationType({
            color: '#ff3737',
            textDecoration: 'underline dotted',
        });

        this.registerLinkClickHandler();
        this.registerHoverProvider();
    }

    /**
     * リンクのクリックハンドラを登録
     */
    private registerLinkClickHandler(): void {
        vscode.window.onDidChangeTextEditorSelection(async event => {
            const editor = event.textEditor;
            const selection = event.selections[0];

            if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse || !selection || !selection.isEmpty) {
                return;
            }

            const document = editor.document;
            const position = selection.active;
            const config = vscode.workspace.getConfiguration('linkPatterns');
            const rules = config.get<any[]>('rules') || [];

            for (const rule of rules) {
                if (!rule.from || !Array.isArray(rule.from)) continue;

                for (const fromPattern of rule.from) {
                    if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                        continue;
                    }

                    try {
                        const line = document.lineAt(position.line).text;
                        const matches = [...line.matchAll(new RegExp(fromPattern.patterns, 'g'))];

                        for (const match of matches) {
                            if (match.index === undefined) continue;

                            const startPos = new vscode.Position(position.line, match.index);
                            const endPos = new vscode.Position(position.line, match.index + match[0].length);
                            const matchRange = new vscode.Range(startPos, endPos);

                            if (matchRange.contains(position)) {
                                const linkText = match[1] || match[0];
                                if (this.linkIndexer.hasDestination(linkText)) {
                                    await this.navigateToDestination(linkText);
                                    return; // 最初のマッチで処理終了
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Invalid regex pattern: ${fromPattern.patterns}`, error);
                    }
                }
            }
        });
    }

    /**
     * ホバープロバイダーを登録
     */
    private registerHoverProvider(): void {
        vscode.languages.registerHoverProvider('*', {
            provideHover: async (document, position, token) => {
                const config = vscode.workspace.getConfiguration('linkPatterns');
                const rules = config.get<any[]>('rules') || [];

                for (const rule of rules) {
                    if (!rule.from || !Array.isArray(rule.from) || !rule.to || !Array.isArray(rule.to)) continue;

                    for (const fromPattern of rule.from) {
                        if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                            continue;
                        }

                        try {
                            const lineText = document.lineAt(position.line).text;
                            const matches = [...lineText.matchAll(new RegExp(fromPattern.patterns, 'g'))];

                            for (const match of matches) {
                                if (match.index === undefined) continue;

                                const start = new vscode.Position(position.line, match.index);
                                const end = new vscode.Position(position.line, match.index + match[0].length);
                                const range = new vscode.Range(start, end);

                                if (range.contains(position)) {
                                    const linkText = match[1] || match[0];
                                    const destinations = this.linkIndexer.getDestinations(linkText);

                                    if (destinations.length > 0) {
                                        const destination = destinations[0]; // 最初の宛先を使用

                                        // マッチした 'from' に対応する 'to' の設定を探す
                                        // rule.to の中から、この destination を生成した可能性のある toDef を見つける
                                        let hoverConfig = { linesBefore: 2, linesAfter: 2 }; // デフォルト
                                        const matchedToDefinition = rule.to.find((toDef: any) => {
                                            // 簡易的な判定: destination の URI が toDef.includes にマッチするか
                                            // より正確には、LinkIndexer がインデックス作成時にどの toDef に基づいたかを記録する必要がある
                                            if (toDef.includes && this.linkIndexer.isFileMatchGlob(destination.uri.fsPath, toDef.includes)) {
                                                // さらに、destination の内容が toDef.patterns にマッチするかどうかを確認する必要があるが、
                                                // 現在の LinkIndexer の実装では、どの toDef.patterns でマッチしたかの情報までは保持していない。
                                                // ここでは includes のマッチのみで判断する。
                                                return true;
                                            }
                                            return false;
                                        });

                                        if (matchedToDefinition && matchedToDefinition.hoverPreview) {
                                            hoverConfig = matchedToDefinition.hoverPreview;
                                        } else if (rule.to.length > 0 && rule.to[0].hoverPreview) {
                                            // フォールバックとして、ルールの最初の to の hoverPreview を使用
                                            hoverConfig = rule.to[0].hoverPreview;
                                        }


                                        const destDoc = await vscode.workspace.openTextDocument(destination.uri);
                                        const relativePath = vscode.workspace.asRelativePath(destination.uri);
                                        const startLine = Math.max(0, destination.range.start.line - hoverConfig.linesBefore);
                                        const endLine = Math.min(destDoc.lineCount - 1, destination.range.start.line + hoverConfig.linesAfter);

                                        let previewContent = '';
                                        for (let i = startLine; i <= endLine; i++) {
                                            const lineContent = destDoc.lineAt(i).text;
                                            previewContent += `${i === destination.range.start.line ? '**' : ''}${i + 1}: ${lineContent}${i === destination.range.start.line ? '**' : ''}\n`;
                                        }

                                        const markdownString = new vscode.MarkdownString();
                                        markdownString.appendMarkdown(`**Link Target:**\n[${relativePath}:${destination.range.start.line + 1}](${destination.uri})\n`);
                                        markdownString.appendCodeblock(previewContent, destDoc.languageId || 'plaintext');
                                        return new vscode.Hover(markdownString, range);
                                    } else {
                                        const markdownString = new vscode.MarkdownString();
                                        markdownString.appendMarkdown(`**Broken Link:** \`${linkText}\` (Destination not found)`);
                                        return new vscode.Hover(markdownString, range);
                                    }
                                }
                            }
                        } catch (error) {
                            console.error(`Error in hover provider: ${error}`);
                        }
                    }
                }
                return null; // rule をまたいで検索を続ける
            }
        });
    }

    /**
     * リンク先に移動
     */
    private async navigateToDestination(text: string): Promise<void> {
        const destinations = this.linkIndexer.getDestinations(text);
        if (destinations.length === 0) return;

        if (destinations.length === 1) {
            await this.openLocation(destinations[0]);
        } else {
            const items = destinations.map(location => ({
                label: vscode.workspace.asRelativePath(location.uri),
                description: `Line ${location.range.start.line + 1}`,
                location
            }));
            const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select destination' });
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
        editor.selection = new vscode.Selection(location.range.start, location.range.start);
        editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
    }

    /**
     * エディタの装飾を更新
     */
    public updateDecorations(editor: vscode.TextEditor): void {
        if (!editor) return;

        const document = editor.document;
        const config = vscode.workspace.getConfiguration('linkPatterns');
        const rules = config.get<any[]>('rules') || [];

        const allValidRanges: vscode.Range[] = [];
        const allBrokenRanges: vscode.Range[] = [];

        for (const rule of rules) {
            if (!rule.from || !Array.isArray(rule.from) || !rule.to || !Array.isArray(rule.to)) continue;

            for (const fromPattern of rule.from) {
                if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                    continue;
                }
                const { validRanges, brokenRanges } = this.getLinkRangesInDocument(document, fromPattern.patterns);
                allValidRanges.push(...validRanges);
                allBrokenRanges.push(...brokenRanges);
            }
        }
        editor.setDecorations(this.linkDecorationType, allValidRanges);
        editor.setDecorations(this.brokenLinkDecorationType, allBrokenRanges);
    }

    /**
     * ドキュメント内のリンクの範囲を取得
     */
    private getLinkRangesInDocument(document: vscode.TextDocument, patternStr: string): { validRanges: vscode.Range[], brokenRanges: vscode.Range[] } {
        const validRanges: vscode.Range[] = [];
        const brokenRanges: vscode.Range[] = [];
        try {
            const text = document.getText();
            const pattern = new RegExp(patternStr, 'g'); // 'g' フラグが重要
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const linkText = match[1] || match[0]; // キャプチャグループ1があればそれを、なければマッチ全体
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const range = new vscode.Range(startPos, endPos);

                if (this.linkIndexer.hasDestination(linkText)) {
                    validRanges.push(range);
                } else {
                    brokenRanges.push(range);
                }
            }
        } catch (error) {
            console.error(`Error while getting link ranges: ${error}`);
        }
        return { validRanges, brokenRanges };
    }


    /**
     * リソースをクリーンアップ
     */
    public dispose(): void {
        this.linkDecorationType.dispose();
        this.brokenLinkDecorationType.dispose();
    }
}
