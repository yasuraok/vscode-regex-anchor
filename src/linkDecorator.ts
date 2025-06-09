import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';

interface LinkMatch {
    range: vscode.Range;
    linkText: string;
}

interface PreviewConfig {
    linesBefore: number;
    linesAfter: number;
    hover?: boolean;
    editor?: string;
}

/**
 * エディタ内のリンクデコレーションを管理するクラス
 */
export class LinkDecorator {
    // リンクの装飾タイプ
    private linkDecorationType: vscode.TextEditorDecorationType;
    // リンク切れの装飾タイプ
    private brokenLinkDecorationType: vscode.TextEditorDecorationType;
    // インライン表示の装飾タイプ
    private inlineDecorationType: vscode.TextEditorDecorationType;

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

        // インライン表示のスタイルを定義
        this.inlineDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: '#999999',
                fontStyle: 'italic',
                margin: '0 0 0 10px'
            }
        });

        this.registerHoverProvider();
        this.registerDefinitionProvider();
    }

    /**
     * Definition Providerを登録（Ctrl+クリック対応）
     */
    private registerDefinitionProvider(): void {
        vscode.languages.registerDefinitionProvider('*', {
            provideDefinition: async (document, position, token) => {
                const config = vscode.workspace.getConfiguration('regexAnchor');
                const rules = config.get<any[]>('rules') || [];

                for (const rule of rules) {
                    if (!rule.from || !Array.isArray(rule.from)) continue;

                    for (const fromPattern of rule.from) {
                        if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                            continue;
                        }

                        const matches = this.findLinkMatches(document, fromPattern.patterns, position.line);

                        for (const match of matches) {
                            if (match.range.contains(position)) {
                                const destinations = this.linkIndexer.getDestinations(match.linkText);
                                if (destinations.length > 0) {
                                    return destinations;
                                }
                            }
                        }
                    }
                }
                return null;
            }
        });
    }

    /**
     * 指定されたドキュメントと位置でリンクマッチを検索
     */
    private findLinkMatches(document: vscode.TextDocument, patternStr: string, lineNumber?: number): LinkMatch[] {
        const matches: LinkMatch[] = [];

        try {
            const pattern = new RegExp(patternStr, 'g');

            if (lineNumber !== undefined) {
                // 特定の行のみを処理（ホバー用）
                const lineText = document.lineAt(lineNumber).text;
                const lineMatches = [...lineText.matchAll(pattern)];

                for (const match of lineMatches) {
                    if (match.index === undefined) continue;

                    const linkText = match[1] || match[0];
                    const startPos = new vscode.Position(lineNumber, match.index);
                    const endPos = new vscode.Position(lineNumber, match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);

                    matches.push({ range, linkText });
                }
            } else {
                // ドキュメント全体を処理（装飾用）
                const text = document.getText();
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    const linkText = match[1] || match[0];
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);

                    matches.push({ range, linkText });
                }
            }
        } catch (error) {
            console.error(`Error while finding link matches: ${error}`);
        }

        return matches;
    }

    /**
     * 宛先に対応するプレビュー設定を取得
     */
    private getPreviewConfig(destination: vscode.Location, toDefinitions: any[]): PreviewConfig {
        const defaultConfig: PreviewConfig = { linesBefore: 2, linesAfter: 2, hover: true };

        const matchedToDefinition = toDefinitions.find((toDef: any) => {
            return toDef.includes && this.linkIndexer.isFileMatchGlob(destination.uri.fsPath, toDef.includes);
        });

        if (matchedToDefinition?.preview) {
            return { ...defaultConfig, ...matchedToDefinition.preview };
        }

        return defaultConfig;
    }

    /**
     * 宛先のコンテンツを取得
     */
    private async getDestinationContent(destination: vscode.Location, config: PreviewConfig): Promise<string> {
        const destDoc = await vscode.workspace.openTextDocument(destination.uri);
        const startLine = Math.max(0, destination.range.start.line - config.linesBefore);
        const endLine = Math.min(destDoc.lineCount - 1, destination.range.start.line + config.linesAfter);

        let content = '';
        for (let i = startLine; i <= endLine; i++) {
            const lineContent = destDoc.lineAt(i).text;
            content += lineContent + '\n';
        }

        return content;
    }

    /**
     * ホバープロバイダーを登録
     */
    private registerHoverProvider(): void {
        vscode.languages.registerHoverProvider('*', {
            provideHover: async (document, position, token) => {
                const config = vscode.workspace.getConfiguration('regexAnchor');
                const rules = config.get<any[]>('rules') || [];

                for (const rule of rules) {
                    if (!rule.from || !Array.isArray(rule.from) || !rule.to || !Array.isArray(rule.to)) continue;

                    for (const fromPattern of rule.from) {
                        if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                            continue;
                        }

                        const matches = this.findLinkMatches(document, fromPattern.patterns, position.line);

                        for (const match of matches) {
                            if (match.range.contains(position)) {
                                const destinations = this.linkIndexer.getDestinations(match.linkText);

                                if (destinations.length > 0) {
                                    const destination = destinations[0];
                                    const previewConfig = this.getPreviewConfig(destination, rule.to);

                                    // hover が false の場合はホバー表示しない
                                    if (previewConfig.hover === false) {
                                        return null;
                                    }

                                    const content = await this.getDestinationContent(destination, previewConfig);
                                    const destDoc = await vscode.workspace.openTextDocument(destination.uri);
                                    const relativePath = vscode.workspace.asRelativePath(destination.uri);

                                    let previewContent = '';
                                    const lines = content.split('\n');
                                    const targetLineIndex = previewConfig.linesBefore;

                                    lines.forEach((lineContent, index) => {
                                        if (lineContent.trim() || index < lines.length - 1) { // 最後の空行以外は含める
                                            const lineNumber = destination.range.start.line - previewConfig.linesBefore + index + 1;
                                            const isTargetLine = index === targetLineIndex;
                                            previewContent += `${isTargetLine ? '**' : ''}${lineNumber}: ${lineContent}${isTargetLine ? '**' : ''}\n`;
                                        }
                                    });

                                    const markdownString = new vscode.MarkdownString();
                                    markdownString.appendMarkdown(`**Link Target:**\n[${relativePath}:${destination.range.start.line + 1}](${destination.uri})\n`);
                                    markdownString.appendCodeblock(previewContent, destDoc.languageId || 'plaintext');
                                    return new vscode.Hover(markdownString, match.range);
                                } else {
                                    const markdownString = new vscode.MarkdownString();
                                    markdownString.appendMarkdown(`**Broken Link:** \`${match.linkText}\` (Destination not found)`);
                                    return new vscode.Hover(markdownString, match.range);
                                }
                            }
                        }
                    }
                }
                return null;
            }
        });
    }

    /**
     * エディタの装飾を更新
     */
    public async updateDecorations(editor: vscode.TextEditor): Promise<void> {
        const document = editor.document;
        const decorations: vscode.DecorationOptions[] = [];
        const brokenDecorations: vscode.DecorationOptions[] = [];
        const inlineDecorations: vscode.DecorationOptions[] = [];
        const config = vscode.workspace.getConfiguration('regexAnchor');
        const rules = config.get<any[]>('rules') || [];

        for (const rule of rules) {
            if (!rule.from || !Array.isArray(rule.from) || !rule.to || !Array.isArray(rule.to)) continue;

            for (const fromPattern of rule.from) {
                if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                    continue;
                }
                const { validRanges, brokenRanges, inlineData } = await this.getLinkRangesInDocument(document, fromPattern.patterns, rule.to);
                // Convert ranges to decoration options
                decorations.push(...validRanges.map(range => ({ range })));
                brokenDecorations.push(...brokenRanges.map(range => ({ range })));
                inlineDecorations.push(...inlineData);
            }
        }
        editor.setDecorations(this.linkDecorationType, decorations);
        editor.setDecorations(this.brokenLinkDecorationType, brokenDecorations);
        editor.setDecorations(this.inlineDecorationType, inlineDecorations);
    }

    /**
     * ドキュメント内のリンクの範囲を取得
     */
    private async getLinkRangesInDocument(document: vscode.TextDocument, patternStr: string, toDefinitions: any[]): Promise<{ validRanges: vscode.Range[], brokenRanges: vscode.Range[], inlineData: vscode.DecorationOptions[] }> {
        const validRanges: vscode.Range[] = [];
        const brokenRanges: vscode.Range[] = [];
        const inlineData: vscode.DecorationOptions[] = [];

        const matches = this.findLinkMatches(document, patternStr);

        for (const match of matches) {
            if (this.linkIndexer.hasDestination(match.linkText)) {
                validRanges.push(match.range);

                // インライン表示の処理
                const destinations = this.linkIndexer.getDestinations(match.linkText);
                if (destinations.length > 0) {
                    const destination = destinations[0];
                    const previewConfig = this.getPreviewConfig(destination, toDefinitions);

                    // editor プロパティが設定されている場合、インライン表示を行う
                    if (previewConfig.editor) {
                        try {
                            const content = await this.getDestinationContent(destination, previewConfig);

                            // editor 正規表現でコンテンツを抽出
                            const editorRegex = new RegExp(previewConfig.editor, 'm');
                            const editorMatch = editorRegex.exec(content);

                            if (editorMatch) {
                                const extractedText = editorMatch[1] || editorMatch[0];
                                if (extractedText && extractedText.trim()) {
                                    inlineData.push({
                                        range: match.range,
                                        renderOptions: {
                                            after: {
                                                contentText: ` (${extractedText.trim()})`,
                                                color: '#999999',
                                                fontStyle: 'italic'
                                            }
                                        }
                                    });
                                }
                            }
                        } catch (error) {
                            console.error(`Error processing inline display for ${match.linkText}:`, error);
                        }
                    }
                }
            } else {
                brokenRanges.push(match.range);
            }
        }

        return { validRanges, brokenRanges, inlineData };
    }


    /**
     * リソースをクリーンアップ
     */
    public dispose(): void {
        this.linkDecorationType.dispose();
        this.brokenLinkDecorationType.dispose();
        this.inlineDecorationType.dispose();
    }
}
