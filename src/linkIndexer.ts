import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as glob from 'glob';

/**
 * リンクのインデックスを管理するクラス
 */
export class LinkIndexer {
    // リンクのインデックス: テキスト -> 宛先のマップ
    private linkIndex: Map<string, Set<vscode.Location>> = new Map();

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
        if (!this.linkIndex.has(text)) {
            this.linkIndex.set(text, new Set<vscode.Location>());
        }
        this.linkIndex.get(text)!.add(location);
    }

    /**
     * テキストに対応する宛先があるかどうかを確認
     */
    public hasDestination(text: string): boolean {
        return this.linkIndex.has(text) && this.linkIndex.get(text)!.size > 0;
    }

    /**
     * テキストに対応する宛先を取得
     */
    public getDestinations(text: string): vscode.Location[] {
        return this.linkIndex.has(text) ? Array.from(this.linkIndex.get(text)!) : [];
    }

    /**
     * インデックスを再構築
     */
    public async rebuildIndex(): Promise<void> {
        // インデックスをクリア
        this.clearIndex();

        // ワークスペースフォルダが存在しない場合は処理を中止
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }
        const config = vscode.workspace.getConfiguration('regexAnchor');
        const rules = config.get<any[]>('rules') || [];


        // 各リンク設定に対して処理
        for (const rule of rules) {
            if (!rule.to || !Array.isArray(rule.to)) {
                continue;
            }
            await Promise.all(
                rule.to.map(async (destination: any) => {
                    // 必須フィールドがない場合はスキップ
                    if (!destination.includes || !destination.patterns) {
                        return;
                    }

                    await this.processDestination(destination);
                })
            );
        }
    }

    /**
     * 宛先設定を処理する
     */
    private async processDestination(destination: any): Promise<void> {
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
                await this.processFile(file, destination);
            })
        );
    }

    /**
     * ファイルを処理する
     */
    private async processFile(file: string, destination: any): Promise<void> {
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
            // globPattern が絶対パスの場合はそのまま使う
            const pattern = path.isAbsolute(globPattern) ? globPattern : path.join(basePath, globPattern);
            const relativePathFromBase = path.relative(basePath, fileName);

            // glob.sync はワークスペースルートからの相対パスまたは絶対パスで動作するため、
            // pattern がワークスペース外を指している場合や、fileName が期待通りに解決できない場合がある。
            // ここでは、globPattern がワークスペース内のファイルを指すことを期待する。
            try {
                const matchedFiles = glob.sync(pattern, { nodir: true, cwd: basePath });
                return matchedFiles.some(f => path.resolve(basePath, f) === path.resolve(fileName));
            } catch (error) {
                console.error(`Error in glob.sync for pattern ${pattern} with base ${basePath}:`, error);
                // isFileMatchGlob の呼び出し元で fileName がフルパスであることを確認する
                // globPattern が相対パスの場合、basePath からの相対として解釈
                // glob.sync は cwd からの相対パスでマッチングを行う
                // fileName を basePath からの相対パスに変換して比較する方が安全かもしれない
                const relativeToCwd = path.relative(basePath, fileName);
                return glob.sync(globPattern, { nodir: true, cwd: basePath }).includes(relativeToCwd);
            }
        });
    }
}
