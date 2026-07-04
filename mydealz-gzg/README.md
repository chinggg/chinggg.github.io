# mydealz GZG 手机清单

从公开的 mydealz GZG Google Sheet 拉取最新活动，生成适合手机逛超市时查看的 `index.html`。

## 更新

```bash
npm run update
```

生成内容：

- `index.html`：手机清单页面
- `data/deals.json`：结构化活动数据
- `data/enrichment.todo.json`：新商品/变更商品的中文理解任务包
- `data/enrichment-cache.json`：已缓存的中文理解结果
- `data/source.csv`：本次导出的原始 CSV
- `data/source.html`：用于提取商品图的 Google Sheet 页面快照

## 手机状态

页面里的“待买 / 已买 / 已提交 / 跳过”和备注会保存在当前手机浏览器的 `localStorage`。

页面右上角有导出/导入状态按钮。换手机、换浏览器，或者之后需要让我帮你合并状态时，导出 JSON 就行。

## 中文理解 / subagent enrichment

脚本分两层：

1. 确定性解析：拉 Google Sheet，解析日期、链接、图片、店铺限制，保证每周自动更新不会因为模型不可用而失败。
2. 可选 enrichment：用 subagent/LLM/人工为新商品补自然中文、购物提示、提交提示、标签。

流程：

```bash
npm run update
# 把 data/enrichment.todo.json 交给 subagent/LLM，按 prompts/enrich-deals.md 输出 data/enrichment.result.json
npm run merge-enrichment
npm run update
```

enrichment 按 `dealStableId` 缓存，并用 `sourceFingerprint` 判断是否过期；商品信息没变时不会重复理解。

## 当前数据源

https://docs.google.com/spreadsheets/d/1wcqckNai9SyRbQLt-pj6FHzGM7sypoET9glyAE05u2E/edit
