// 単体テスト用のインデックスファイル
// Mochaは自動的に同じディレクトリ内の.test.jsファイルを探します
// このファイルでは全テストに共通の設定を行うことができます
const Mocha = require('mocha');

// テストで共通で使用する変数や関数をここで設定できます
// 必要に応じて環境変数の設定やスタブの作成などもここで行います

// Mocha自体の設定
Mocha.describe('Link Patterns Extension Tests', function() {
  Mocha.before(function() {
    console.log('テスト実行前の準備を行います');
    // テスト前に必要な設定やセットアップがあればここに記述します
  });

  Mocha.after(function() {
    console.log('テスト実行後のクリーンアップを行います');
    // テスト後のクリーンアップがあればここに記述します
  });
});
