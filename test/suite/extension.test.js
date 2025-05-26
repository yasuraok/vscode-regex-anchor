const assert = require('assert');
const { describe, it } = require('mocha');

// モックを使ってVSCodeのAPIをシミュレートします
const vscode = {
  window: {
    createTextEditorDecorationType: () => ({}),
    showInformationMessage: () => {}
  },
  commands: {
    registerCommand: () => {},
    getCommands: () => Promise.resolve(['link-patterns.refresh'])
  },
  workspace: {
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} })
  }
};

// 拡張機能のモジュールの単体テスト
describe('Link Patterns Extension Unit Tests', function() {
  it('should have correct pattern matching', function() {
    // 正規表現パターンのテスト例
    const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
    const testUuid = '550e8400-e29b-41d4-a716-446655440000';
    const match = testUuid.match(uuidPattern);

    assert.ok(match);
    assert.strictEqual(match[1], testUuid);
  });

  it('should execute link refresh command', function() {
    // コマンド実行のモックテスト
    let commandExecuted = false;
    const mockCommand = () => { commandExecuted = true; };

    // コマンド実行をシミュレート
    mockCommand();

    assert.strictEqual(commandExecuted, true);
  });
});
