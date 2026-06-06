# 部署建议

## 推荐：放进 chinggg.github.io

把整个 `mydealz-gzg/` 文件夹放进 `chinggg/chinggg.github.io` 仓库根目录。

上线地址会是：

```text
https://chinggg.github.io/mydealz-gzg/
```

如果你的 GitHub Pages 已经从 `main` 分支根目录发布，这种方式最省事，不需要新服务。

## 推荐更新方式：本地 Codex 跑完整流程

高质量周更在本地 Codex 跑，因为中文理解、跳过宠物/婴儿、合并购物状态都需要 subagents 或你的偏好上下文。这个仓库不使用 GitHub Actions/CI。

每周流程：

```bash
cd /Users/mac/Workspace/Misc/chinggg.github.io/mydealz-gzg
npm run update
# 如果 data/enrichment.todo.json 里有新商品，让 Codex 用 subagents 生成并合并 enrichment
npm run update
cd ..
git add mydealz-gzg
git commit -m "ci: mydealz GZG $(date +%F)"
git push ssh main
```

## 状态保存

“已买 / 已提交 / 跳过 / 备注”保存在手机浏览器的 `localStorage`，不是存在 GitHub 仓库里。

换手机前，在页面右上角导出状态 JSON；新手机打开网页后导入即可。

## 其他免费托管

- GitHub Pages：最适合你现在的情况，已有仓库，纯静态，维护成本最低。
- Cloudflare Pages：也很适合静态站，免费额度更宽松，但需要再接一个 Pages 项目。
- Netlify / Vercel：也能用，但这个项目不需要它们的框架构建能力。
