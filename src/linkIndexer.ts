import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as glob from 'glob';

/**
 * リンクのインデックスを管理するクラス
 */
export class LinkIndexer {
    // リンクのインデックス: テキスト -> 宛先のマップ
    private linkIndex: Map<string, vscode.Location[]> = new Map();

    /**
     * インデックスをクリア
     */
    public clearIndex(): void {
        this.linkIndex.clear();
    }

    /**
     * テキストをインデックスに追加
     */
    public addToIndex(text: string, location: vscode.Location): void {
        const existingLocations = this.linkIndex.get(text) || [];
        this.linkIndex.set(text, [...existingLocations, location]);
    }

    /**
     * テキストに対応する宛先があるかどうかを確認
     */
    public hasDestination(text: string): boolean {
        return this.linkIndex.has(text) && this.linkIndex.get(text)!.length > 0;
    }

    /**
     * テキストに対応する宛先を取得
     */
    public getDestinations(text: string): vscode.Location[] {
        return this.linkIndex.get(text) || [];
    }

    /**
     * インデックスを再構築
     */
    public async rebuildIndex(links: any[]): Promise<void> {
        // インデックスをクリア
        this.clearIndex();

        // ワークスペースフォルダが存在しない場合は処理を中止
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }

        // 有効な設定のみフィルタリング
        const validLinks = links.filter(link =>
            Array.isArray(link.links) &&
            link.links.length > 0 &&
            Array.isArray(link.destinations) &&
            link.destinations.length > 0
        );

        // 各リンク設定に対して処理
        for (const link of validLinks) {
            await Promise.all(
                link.destinations.map(async (destination: any) => {
                    // 必須フィールドがない場合はスキップ
                    if (!destination.includes || !destination.patterns) {
                        return;
                    }

                    await this.processDestination(destination, link.links);
                })
            );
        }
    }

    /**
     * 宛先設定を処理する
     */
    private async processDestination(destination: any, sources: any[]): Promise<void> {
        // ワークスペースフォルダが存在しない場合は処理を中止
        if (!vscode.workspace.workspaceFolders) {
            return;
        }

        const allFiles: string[] = [];

        // 各ワークスペースフォルダからファイルを収集
        for (const folder of vscode.workspace.workspaceFolders) {
            const basePath = folder.uri.fsPath;
            const pattern = path.join(basePath, destination.includes);

            try {
                const files = glob.sync(pattern, { nodir: true });
                allFiles.push(...files);
            } catch (error) {
                console.error(`Error finding files for pattern ${destination.includes}:`, error);
            }
        }

        console.log(`Found ${allFiles.length} destination files matching ${destination.includes}`);

        // 各ファイルを処理
        await Promise.all(
            allFiles.map(async (file) => {
                await this.processFile(file, destination, sources);
            })
        );
    }

    /**
     * ファイルを処理する
     */
    private async processFile(file: string, destination: any, sources: any[]): Promise<void> {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split(/\r?\n/);

            // 各行を処理
            lines.forEach((line, lineIndex) => {
                try {
                    // 宛先パターンを直接正規表現として使用
                    const destRegex = new RegExp(destination.patterns);
                    const match = destRegex.exec(line);

                    if (match) {
                        // キャプチャグループがある場合は最初のグループを使用、なければマッチ全体
                        const linkValue = match[1] || match[0];

                        // 値が空でない場合のみインデックスに追加
                        if (linkValue && linkValue.trim()) {
                            console.log(`Found link value in ${file}: ${linkValue}`);

                            this.addToIndex(
                                linkValue.trim(),
                                {
                                    uri: vscode.Uri.file(file),
                                    range: new vscode.Range(lineIndex, 0, lineIndex, line.length)
                                }
                            );
                        }
                    }
                } catch (error) {
                    console.error(`Error processing pattern: ${destination.patterns}`, error);
                }
            });
        } catch (error) {
            console.error(`Error processing file ${file}:`, error);
        }
    }

    /**
     * ファイル名がグロブパターンにマッチするかどうか確認
     */
    public isFileMatchGlob(fileName: string, globPattern: string): boolean {
        if (!vscode.workspace.workspaceFolders) {
            return false;
        }

        return vscode.workspace.workspaceFolders.some(folder => {
            const basePath = folder.uri.fsPath;
            const pattern = path.join(basePath, globPattern);
            const relativePath = path.relative(basePath, fileName);

            return glob.sync(pattern, { nodir: true })
                .some(f => path.relative(basePath, f) === relativePath);
        });
    }
}
