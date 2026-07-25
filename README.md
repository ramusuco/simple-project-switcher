# Simple Project Switcher

VS Codeのフォルダとワークスペースをサイドバーに保存し、クリックで切り替えます。

## 機能

- 現在のプロジェクトを保存
- フォルダまたはワークスペースを選択して保存
- 名前、パス、グループを編集
- グループ別にプロジェクトを表示
- 同じウィンドウまたは別ウィンドウで開く
- 登録したプロジェクトを削除

## 設定

プロジェクトはユーザーの `settings.json` に保存されます。

```json
"simpleProjectSwitcher.projects": [
  {
    "name": "Web App",
    "path": "C:\\work\\web-app",
    "group": "Frontend"
  }
]
```

`group` は省略できます。

## 安全性

- 外部依存パッケージなし
- ネットワーク通信、テレメトリなし
- コマンドやスクリプトの実行なし
- VS Code標準APIのみ使用
