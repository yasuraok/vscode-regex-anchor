import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';

interface LinkRule {
    from: SrcConf[];
    to: DestConf[];
}

interface SrcConf {
    includes: string;
    patterns: string;
}

interface DestConf {
    includes: string;
    patterns: string;
    preview?: PreviewConfig;
}

interface PreviewConfig {
    linesBefore: number;
    linesAfter: number;
    hover?: boolean;
    editor?: string;
}

interface LinkMatch {
    range: vscode.Range;
    linkText: string;
}


/**
 * エディタ内のリンクデコレーションを管理するクラス
 */
export class LinkDecorator {
    // リンクの装飾タイプ
    private linkDecorationType = vscode.window.createTextEditorDecorationType({
        // 有効なリンクは装飾なし - DocumentLinkProviderが担当
    });

    // リンク切れの装飾タイプ
    private brokenLinkDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#ff3737',
        textDecoration: 'underline dotted',
    });

    // インライン表示の装飾タイプ
    private inlineDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: '#999999',
            fontStyle: 'italic',
            margin: '0'
        }
    });

    /**
     * コンストラクタ
     * @param linkIndexer リンクインデクサー
     */
    constructor(private readonly linkIndexer: LinkIndexer) {
        this.registerHoverProvider();
        this.registerDocumentLinkProvider();
    }

    /**
     * 設定からルールを取得
     */
    private getRules(): LinkRule[] {
        const config = vscode.workspace.getConfiguration('regexAnchor');
        return config.get<LinkRule[]>('rules') || [];
    }

    /**
     * ドキュメントとポジションから該当するリンクマッチを検索
     */
    private findMatchingLinkAtPosition(document: vscode.TextDocument, position: vscode.Position): { match: LinkMatch; rule: LinkRule } | null {
        const rules = this.getRules();

        for (const rule of rules) {
            if (!rule.from || !Array.isArray(rule.from)) continue;

            for (const fromPattern of rule.from) {
                if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                    continue;
                }

                const matches = this.findLinkMatches(document, fromPattern.patterns, position.line);

                for (const match of matches) {
                    if (match.range.contains(position)) {
                        return { match, rule };
                    }
                }
            }
        }
        return null;
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
    private getPreviewConfig(destination: vscode.Location, destConfs: DestConf[]): PreviewConfig {
        const defaultConfig: PreviewConfig = { linesBefore: 2, linesAfter: 2, hover: true };

        const matched = destConfs.find((destConf: DestConf) => {
            return destConf.includes && this.linkIndexer.isFileMatchGlob(destination.uri.fsPath, destConf.includes);
        });

        if (matched?.preview) {
            return { ...defaultConfig, ...matched.preview };
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
                const matchResult = this.findMatchingLinkAtPosition(document, position);
                if (!matchResult) return null;

                const destinations = this.linkIndexer.getDestinations(matchResult.match.linkText);

                if (destinations.length > 0) {
                    const destination = destinations[0];
                    const previewConfig = this.getPreviewConfig(destination, matchResult.rule.to);

                    // hover が false の場合はホバー表示しない
                    if (previewConfig.hover === false) {
                        return null;
                    }

                    const markdownString = await this.createHoverContent(matchResult.match, destination, matchResult.rule);
                    return new vscode.Hover(markdownString, matchResult.match.range);
                } else {
                    const markdownString = this.createBrokenLinkContent(matchResult.match.linkText);
                    return new vscode.Hover(markdownString, matchResult.match.range);
                }
            }
        });
    }

    /**
     * Document Link Providerを登録（Ctrl+クリック、ガイド文、アンダーライン対応）
     */
    private registerDocumentLinkProvider(): void {
        vscode.languages.registerDocumentLinkProvider('*', {
            provideDocumentLinks: async (document, token) => {
                const rules = this.getRules();
                const documentLinks: vscode.DocumentLink[] = [];

                for (const rule of rules) {
                    if (!rule.from || !Array.isArray(rule.from)) continue;

                    for (const fromPattern of rule.from) {
                        if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                            continue;
                        }

                        const matches = this.findLinkMatches(document, fromPattern.patterns);

                        for (const match of matches) {
                            const destinations = this.linkIndexer.getDestinations(match.linkText);
                            if (destinations.length > 0) {
                                const destination = destinations[0];
                                const relativePath = vscode.workspace.asRelativePath(destination.uri);

                                // DocumentLinkを作成
                                const documentLink = new vscode.DocumentLink(match.range, destination.uri);
                                // ツールチップを設定（VSCodeが自動的に"(ctrl + click)"を追加する）
                                // ツールチップ全体がリンク扱いとなるので、ここにリンク先プレビューを (markdown装飾で) 詰めることはできず、HoverProviderを援用する
                                documentLink.tooltip = `Follow link to ${relativePath}:${destination.range.start.line + 1}`;

                                documentLinks.push(documentLink);
                            }
                        }
                    }
                }

                return documentLinks;
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
        const rules = this.getRules();

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
        // 有効なリンクはDocumentLinkProviderに任せ、破損したリンクとインライン装飾のみ適用
        editor.setDecorations(this.linkDecorationType, []); // 有効なリンクは装飾しない
        editor.setDecorations(this.brokenLinkDecorationType, brokenDecorations);
        editor.setDecorations(this.inlineDecorationType, inlineDecorations);
    }

    /**
     * ドキュメント内のリンクの範囲を取得
     */
    private async getLinkRangesInDocument(document: vscode.TextDocument, patternStr: string, destConfs: DestConf[]): Promise<{ validRanges: vscode.Range[], brokenRanges: vscode.Range[], inlineData: vscode.DecorationOptions[] }> {
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
                    const previewConfig = this.getPreviewConfig(destination, destConfs);

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

    /**
     * ホバー用のMarkdownコンテンツを生成
     */
    private async createHoverContent(match: LinkMatch, destination: vscode.Location, rule: LinkRule): Promise<vscode.MarkdownString> {
        const previewConfig = this.getPreviewConfig(destination, rule.to);
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
        // リンク先のファイルが何かについてはDocumentLinkProviderが提供するのでここでは不要
        // markdownString.appendMarkdown(`**Link Target:**\n[${relativePath}:${destination.range.start.line + 1}](${destination.uri})\n`);
        markdownString.appendCodeblock(previewContent, destDoc.languageId || 'plaintext');
        return markdownString;
    }

    /**
     * 破損リンク用のMarkdownコンテンツを生成
     */
    private createBrokenLinkContent(linkText: string): vscode.MarkdownString {
        const markdownString = new vscode.MarkdownString();
        markdownString.appendMarkdown(`**Broken Link:** \`${linkText}\` (Destination not found)`);
        return markdownString;
    }
}
