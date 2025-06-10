import * as vscode from 'vscode';
import { LinkIndexer } from './linkIndexer';
import { LinkDecorator } from './linkDecorator';

let linkIndexer: LinkIndexer;
let linkDecorator: LinkDecorator;

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating Link Patterns extension');

    // リンクインデクサーとデコレーターを初期化
    linkIndexer = new LinkIndexer();
    linkDecorator = new LinkDecorator(linkIndexer);

    // 初期インデックス構築
    void rebuildIndex();

    // コマンドを登録
    const refreshCommand = vscode.commands.registerCommand('regex-anchor.refresh', async () => {
        await rebuildIndex();
        void vscode.window.showInformationMessage('Link index has been refreshed');
    });

    // 設定変更を監視
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('regexAnchor')) {
                void rebuildIndex();
            }
        })
    );

    // エディタを更新
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                void linkDecorator.updateDecorations(editor);
            }
        })
    );

    // ドキュメントの変更を監視
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                void linkDecorator.updateDecorations(editor);
            }
        })
    );

    // ファイルの保存を監視（宛先ファイルが更新された場合はインデックスを再構築）
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            // 保存されたファイルが宛先ファイルのいずれかと一致するか確認
            const config = vscode.workspace.getConfiguration('regexAnchor');
            const links = config.get<any[]>('rules') || [];

            const isDestinationFile = links.some(link =>
                (link.destinations || []).some((dest: any) =>
                    dest.includes && linkIndexer.isFileMatchGlob(document.fileName, dest.includes)
                )
            );

            if (isDestinationFile) {
                void rebuildIndex();
            }
        })
    );

    // 初期エディタ更新
    if (vscode.window.activeTextEditor) {
        void linkDecorator.updateDecorations(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(refreshCommand);
}

// インデックスの再構築
async function rebuildIndex(): Promise<void> {
    console.log('Rebuilding link index...');

    if (!vscode.workspace.workspaceFolders) {
        console.log('No workspace folders found. Aborting index rebuild.');
        return;
    }

    await linkIndexer.rebuildIndex();

    // アクティブエディタを更新
    if (vscode.window.activeTextEditor) {
        void linkDecorator.updateDecorations(vscode.window.activeTextEditor);
    }

    console.log('Link index rebuilt successfully');
}

export function deactivate() {
    // リソースをクリーンアップ
    linkDecorator.dispose();
}
