# 发版流程

版本只有一个来源：**git tag**。`package.json` 的 version 必须和 tag 一致——发布工作流的 `validate` job 会断言这一点，对不上就不会发版。

> 上一次卡在这里：打了 `v0.5.0` 的 tag，却忘了把 `package.json` 抬到 `0.5.0`，validate 立刻拦下来了（这正是它该做的）。所以下面第 1 步别跳。

## 步骤

**1. 先把版本抬上去**（在要发布的那个分支上）

```bash
npm pkg set version=0.6.0
npm --prefix web pkg set version=0.6.0
```

`web/package-lock.json` 里还有两处 `"version"` 要跟着改成同一个值。

**2. 提交并推送**

```bash
git commit -am "chore(release): set version to 0.6.0"
git push
```

**3. 打 tag 并推送** —— tag 一推上去就触发 `.github/workflows/release.yml`

```bash
git tag v0.6.0
git push origin v0.6.0
```

## 流水线做了什么

| job | 内容 |
| --- | --- |
| `validate` | 断言 tag 与 `package.json` 版本一致；跑 lint、单测、前端构建；再检查入库的 `src/public` 与 `web/` 的构建结果**逐字节一致**（改了前端忘了提交构建产物，这里会拦住） |
| `build` | Windows / macOS / Linux **三个平台并行**打包。macOS 同时产出 dmg 与 zip——**zip 是 macOS 应用内更新的载体**，只有 dmg 时 mac 上「检查更新」必失败；Linux 产出 AppImage（唯一能自更新的格式）与 deb / rpm |
| `publish` | 需要**人工审批**（`release` environment）；校验每个更新清单指向的文件确实存在、且指向可自更新的载体（Windows=NSIS、macOS=zip、Linux=AppImage）；算 SHA256SUMS 并出 provenance attestation；建草稿、上传产物、把 `releases/latest` 指过去；最后以匿名用户身份再核验一遍 |

三个平台并行是安全的：只有 `publish` 一个 job 有写权限，不存在多条流水线抢同一个 release 的问题。

## 常见问题

**`validate` 报 `version mismatch`** —— 打 tag 时忘了改 `package.json`。tag 必须指向**已经带上该版本**的提交：

```bash
npm pkg set version=0.6.0
git commit -am "chore(release): set version to 0.6.0"
git tag -f v0.6.0 && git push --force origin v0.6.0
```

**只有在这个版本还没发出去、没人下载过时才可以这么做**（比如像上次那样死在 `validate`）。已经发布出去的版本不能替换，只能 forward-fix：发下一个版本号。

**想重跑一次** —— Actions 页面 → release workflow → Run workflow → 填 tag。已发布过的 tag 会被 `publish` job 拒绝覆盖。

**产物没签名** —— Windows 首次运行显示「未知发布者」、SmartScreen 可能拦截；macOS 首次打开需右键 →「打开」。release 说明里已写明。签好 Azure Artifact Signing 与 Apple Developer ID 凭据后，在仓库 secrets 里配同名变量即可自动生效，配置不用改。

**应用内更新查不到新版本** —— 先确认 `releases/latest` 指向新 tag，再匿名拉一次 `https://github.com/rockbenben/md-publisher/releases/latest/download/latest.yml` 看内容对不对。
