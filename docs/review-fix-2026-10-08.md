# 1.0.6 社区审核阻断项修复记录

## 原因与边界

用户提供的审核截图标出 `src/reading-source.ts:26`：字符实体解码把函数
参数写入 `textarea.innerHTML`，触发不安全 HTML 写入错误。该代码来自
1.0.6 的阅读文本核对改动；此前测试和仓库检查没有覆盖此审核规则。
来源证明缺失属于另外一条建议，不是这个源码错误的原因。

本次以纯文本解码替换 DOM 解码，保留原有支持范围、数值实体处理与
计数归属核对。未知实体仍保留原文，无法核对时不强行渲染。
未改动编辑会话、计数保存、快捷键、视觉样式、vault 配置或其他插件。

## 本地验证

- 先运行新增回归测试：旧实现 1 项失败、16 项通过；失败位置正是
  `innerHTML` 写入。替换实现后，全部 10 套、199 项测试通过。
- 仓库 ESLint、TypeScript 检查、生产构建、产物语法与严格加载测试通过。
- Markdown-it + DOMPurify + 实际阅读处理器的 8 个场景通过：普通字与
  计数并存、段中计数、强调、引用、命名实体、数值实体、恶意编码文本、
  连续软换行。恶意编码文本被净化器移除后，插件不重建其内容。
- 在隔离目录使用官方 `eslint-plugin-obsidianmd@0.4.2` 的完整
  recommended 配置与类型信息检查 `src/`：0 个错误、21 个警告。
  警告分布：弃用 API 4、默认快捷键 1、界面大小写 4、元素创建方式 12。
  这些警告不在本次最小修复中更改。
- 新增的仓库检查对旧实现报错，验证发布前防线确实可以拦截该回归。
- 发布工作流 YAML 检查通过；增加未来发布资产的来源证明生成步骤。
  此步骤尚未在 GitHub Actions 上运行，不能称为已生成证明。

## 尚未完成的发布验收

本记录证明的是本地修复与检查，不是社区目录在线审核通过。
没有改写现有 1.0.6 标签或发布资产，也没有同步运行副本。
用户已授权复查后推送发布 1.0.7。本记录写于发布前；发布应经正常
PR 与 CI 流程，核对下载资产与来源证明。社区目录在线审核结果另行确认。

官方参考：[社区目录审核](https://docs.obsidian.md/community-directory/manage-entry)、
[官方检查规则](https://github.com/obsidianmd/eslint-plugin)、
[GitHub 资产来源证明](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。
