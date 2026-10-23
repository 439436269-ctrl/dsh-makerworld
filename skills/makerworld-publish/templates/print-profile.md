# 打印配置(print profile)发布模板

> 用法:3MF 上传后按此填。差异描述通常已自动检测,人工核对即可。

## 差异描述(单行,与默认配置的区别)

```
〈x mm〉 层高, 〈n〉 层墙, 〈n%〉 填充
```

示例:`0.12mm 层高, 2 层墙, 15% 填充`

## 配置描述(富文本,无 Markdown)

```
Bambu Studio 〈版本〉 对 〈机型〉 〈喷嘴〉 切片:〈层高〉、〈墙数〉 层墙、〈填充率〉 填充。〈摆放/支撑/AMS 说明〉,〈部件〉实测约 〈时长〉。〈多板/多部件说明〉。
```

示例:`Bambu Studio 0.2.05 对 P1S 0.4 喷嘴切片:0.12mm 层高、2 层墙、15% 填充。底座朝下平放、免支撑、免 AMS,frame 实测轻量化后约 6 小时。盘子 2x2 一板可打。`

## 发布前检查

1. 3MF 为 Bambu Studio 切片产物(含 `Metadata/slice_info.config`、`plate_*.json`)
2. 兼容打印机自动检测结果核对(如 P1S)
3. **实拍图 ≥1 张**(drop 到"添加照片",准则强制,否则会被下架)
4. 勾选「我已阅读打印配置上传准则」
5. 点"保存草稿"旁的无名按钮 = 发布;成功标志:跳 verifying 且"审核中 (N)+1"

## CLI 切片备忘(用户没现成 3MF 时)

```cmd
"C:\Program Files\Bambu Studio\bambu-studio.exe" --arrange 1 --slice 0 --export-3mf out.3mf in.stl
```
- `--arrange 1` 必加(否则物体中心在原点、床坐标 0..256,报不在打印体积内)
- `--load-settings "<machine.json>"` 指定机器;preset 文件名含中文会转码失败 → 先复制为英文名
- 机器 preset 位置:`%APPDATA%\BambuStudio\user\<MW账号ID>\machine\*.json`
