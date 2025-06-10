import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';
import { LinkRule, SrcConf, DestConf, PreviewConfig } from './types';

interface Result {
    src: {
        range: vscode.Range;
        linkText: string;
    };
    dest: {
        location: vscode.Location;
        previewConfig: PreviewConfig;
    } | null; // リンク切れの場合は省略
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
     * 引数のdocumentをリンクソースとする設定を取得
     */
    private getRulesForThisSource(document: vscode.TextDocument): { rule: LinkRule; fromPattern: SrcConf }[] {
        const config = vscode.workspace.getConfiguration('regexAnchor');
        const rules = config.get<LinkRule[]>('rules') || [];
        const applicableRules: { rule: LinkRule; fromPattern: SrcConf }[] = [];

        for (const rule of rules) {
            if (!rule.from || !Array.isArray(rule.from)) continue;

            for (const fromPattern of rule.from) {
                if (!fromPattern.includes || !fromPattern.patterns || !this.linkIndexer.isFileMatchGlob(document.fileName, fromPattern.includes)) {
                    continue;
                }
                applicableRules.push({ rule, fromPattern });
            }
        }

        return applicableRules;
    }

    /**
     * ドキュメントとポジションから該当するリンクマッチを検索
     */
    private findMatchingLinkAtPosition(document: vscode.TextDocument, position: vscode.Position): Result | null {
        const applicableRules = this.getRulesForThisSource(document);

        for (const { rule, fromPattern } of applicableRules) {
            try {
                const pattern = new RegExp(fromPattern.patterns, 'g');
                const lineText = document.lineAt(position.line).text;
                const lineMatches = [...lineText.matchAll(pattern)];

                for (const match of lineMatches) {
                    if (match.index === undefined) continue;

                    const linkText = match[1] || match[0];
                    const startPos = new vscode.Position(position.line, match.index);
                    const endPos = new vscode.Position(position.line, match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);

                    if (range.contains(position)) {
                        return {
                            src: { range, linkText },
                            dest: this.findDestination(linkText, rule.to),
                        };
                    }
                }
            } catch (error) {
                console.error(`Error while finding link matches at position: ${error}`);
            }
        }
        return null;
    }

    /**
     * ドキュメント全体でリンクマッチを検索し、結果として返す
     */
    private findAllLinkMatches(document: vscode.TextDocument): Result[] {
        const applicableRules = this.getRulesForThisSource(document);
        const allResults: Result[] = [];

        for (const { rule, fromPattern } of applicableRules) {
            // findAllLinkMatchesの処理をインライン展開
            try {
                const pattern = new RegExp(fromPattern.patterns, 'g');
                const text = document.getText();
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    const linkText = match[1] || match[0];
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);
                    allResults.push({
                        src: { range, linkText },
                        dest: this.findDestination(linkText, rule.to)
                    });
                }
            } catch (error) {
                console.error(`Error while finding all link matches: ${error}`);
            }
        }

        return allResults;
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
     * ソースのリンクテキストからリンク先情報を取得
     */
    private findDestination(linkText: string, destConfs: DestConf[]) {
        const destinations = this.linkIndexer.getDestinations(linkText);

        if (destinations.length > 0) {
            const location = destinations[0];
            const previewConfig = this.getPreviewConfig(location, destConfs);
            return { location, previewConfig };
        } else {
            return null;
        }
    }

    /**
     * 宛先のコンテンツを取得
     */
    private async getDestinationContent(destination: vscode.Location, config: PreviewConfig) {
        const destDoc = await vscode.workspace.openTextDocument(destination.uri);
        const startLine = Math.max(0, destination.range.start.line - config.linesBefore);
        const endLine = Math.min(destDoc.lineCount - 1, destination.range.start.line + config.linesAfter);

        let content = '';
        for (let i = startLine; i <= endLine; i++) {
            const lineContent = destDoc.lineAt(i).text;
            content += lineContent + '\n';
        }

        return {content, languageId: destDoc.languageId || 'plaintext'};
    }

    /**
     * ホバープロバイダーを登録
     */
    private registerHoverProvider(): void {
        vscode.languages.registerHoverProvider('*', {
            provideHover: async (document, position, token) => {
                const result = this.findMatchingLinkAtPosition(document, position);
                if (!result) return null;

                if (result.dest) {
                    // hover が false の場合はホバー表示しない
                    if (result.dest.previewConfig.hover === false) {
                        return null;
                    }

                    const markdownString = await this.createHoverContent(result.src, result.dest.location, result.dest.previewConfig);
                    return new vscode.Hover(markdownString, result.src.range);
                } else {
                    const markdownString = this.createBrokenLinkContent(result.src.linkText);
                    return new vscode.Hover(markdownString, result.src.range);
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
                const documentLinks: vscode.DocumentLink[] = [];
                const results = this.findAllLinkMatches(document);

                for (const result of results) {
                    if (result.dest) {
                        const relativePath = vscode.workspace.asRelativePath(result.dest.location.uri);

                        // previewConfigを使用して選択範囲を計算
                        const targetLine = result.dest.location.range.start.line;
                        const previewStartLine = Math.max(0, targetLine - result.dest.previewConfig.linesBefore);
                        const previewEndLine = targetLine + result.dest.previewConfig.linesAfter + 1;

                        // 1ベースの行番号に変換（VS Codeのフラグメントは1ベース）
                        const startLineForUri = previewStartLine + 1;
                        const endLineForUri = previewEndLine + 1;

                        // フラグメント形式: L開始行-終了行（列は指定しない）
                        const uriWithSelection = result.dest.location.uri.with({
                            fragment: `L${startLineForUri}-${endLineForUri}`
                        });

                        // DocumentLinkを作成
                        const documentLink = new vscode.DocumentLink(result.src.range, uriWithSelection);
                        // ツールチップを設定（VSCodeが自動的に"(ctrl + click)"を追加する）
                        // ツールチップ全体がリンク扱いとなるので、ここにリンク先プレビューを (markdown装飾で) 詰めることはできず、HoverProviderを援用する
                        documentLink.tooltip = `Follow link to ${relativePath}:${targetLine + 1}`;

                        documentLinks.push(documentLink);
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
        const results = this.findAllLinkMatches(document);

        const decorations: vscode.DecorationOptions[] = [];
        const brokenDecorations: vscode.DecorationOptions[] = [];
        const inlineDecorations: vscode.DecorationOptions[] = [];

        // 結果から装飾データを作成
        for (const result of results) {
            if (result.dest) {
                // 有効なリンク（DocumentLinkProviderに任せるので装飾は空）
                decorations.push({ range: result.src.range });

                // インライン表示の処理
                const inlineDecoration = await this.createInlineDecorationOption(result);
                if (inlineDecoration) {
                    inlineDecorations.push(inlineDecoration);
                }
            } else {
                // 破損したリンク
                brokenDecorations.push({ range: result.src.range });
            }
        }

        // 装飾を適用
        editor.setDecorations(this.linkDecorationType, []); // 有効なリンクは装飾しない
        editor.setDecorations(this.brokenLinkDecorationType, brokenDecorations);
        editor.setDecorations(this.inlineDecorationType, inlineDecorations);
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
    private async createHoverContent(src: { range: vscode.Range; linkText: string }, destination: vscode.Location, previewConfig: PreviewConfig): Promise<vscode.MarkdownString> {
        const { content, languageId } = await this.getDestinationContent(destination, previewConfig);

        let previewContent = '';
        const lines = content.split('\n');

        lines.forEach((lineContent, index) => {
            if (lineContent.trim() || index < lines.length - 1) { // 最後の空行以外は含める
                const lineNumber = destination.range.start.line - previewConfig.linesBefore + index + 1;
                previewContent += `${lineNumber}: ${lineContent}\n`;
            }
        });

        const markdownString = new vscode.MarkdownString();
        // リンク先のファイルが何かについてはDocumentLinkProviderが提供するのでここでは不要
        // markdownString.appendMarkdown(`**Link Target:**\n[${relativePath}:${destination.range.start.line + 1}](${destination.uri})\n`);
        markdownString.appendCodeblock(previewContent, languageId);
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

    /**
     * インライン表示用の装飾オプションを作成
     */
    private async createInlineDecorationOption(result: Result): Promise<vscode.DecorationOptions | null> {
        if (!result.dest?.previewConfig?.editor) {
            return null;
        }

        try {
            const {content} = await this.getDestinationContent(result.dest.location, result.dest.previewConfig);

            // editor 正規表現でコンテンツを抽出
            const editorRegex = new RegExp(result.dest.previewConfig.editor, 'm');
            const editorMatch = editorRegex.exec(content);

            if (editorMatch) {
                const extractedText = editorMatch[1] || editorMatch[0];
                if (extractedText && extractedText.trim()) {
                    return {
                        range: result.src.range,
                        renderOptions: {
                            after: {
                                contentText: ` (${extractedText.trim()})`,
                            }
                        }
                    };
                }
            }
        } catch (error) {
            console.error(`Error processing inline display for ${result.src.linkText}:`, error);
        }

        return null;
    }
}
