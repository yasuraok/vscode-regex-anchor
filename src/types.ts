/**
 * リンクルールの型定義
 */
export interface LinkRule {
    from: SrcConf[];
    to: DestConf[];
}

/**
 * ソース設定の型定義
 */
export interface SrcConf {
    includes: string;
    patterns: string;
}

/**
 * 宛先設定の型定義
 */
export interface DestConf {
    includes: string;
    patterns: string;
    preview?: PreviewConfig;
}

/**
 * プレビュー設定の型定義
 */
export interface PreviewConfig {
    linesBefore: number;
    linesAfter: number;
    hover?: boolean;
    editor?: string;
}
