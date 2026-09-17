# Volcengine Ark 3D Plugin

火山引擎方舟 3D 生成插件，支持三个模型系列的图生 3D 和文生 3D。

[//]: # ("/ark/3d/generations/tasks" => "/ark/3d/contents/generations/tasks")

## 模型支持

| 模型 ID | 能力 | 计费 |
|---------|------|------|
| `doubao-seed3d-2-0-260328` | 图生 3D，生成带纹理和 PBR 材质的 3D 文件 | 按次计费 |
| `hyper3d-gen2-260112` | 文生 3D、图生 3D | 固定 3 万 token/次（1.8 元） |
| `hitem3d-2-0-251223` | 图生 3D，标准/高精白膜与纹理模型 | 按次计费 |

## 适配模式

**原生同构直通（Isomorphic）**：保真复制厂商请求体，仅执行模型映射、URL 重建和鉴权替换。完整保留：
- 厂商扩展字段（`seed`、`callback_url`、`vendor_extension` 等）
- `false` / `0` / `null` / 空数组
- 嵌套对象和数组顺序

## API 路由

- **提交任务**：`POST /ark/3d/generations/tasks`
- **查询任务**：`GET /ark/3d/generations/tasks/:task_id`

## 状态映射

六层阶梯，上层命中即返回：

1. **Envelope 错误**：`code !== 0` → `FAILURE`（408/429/5xx 抛错重试）
2. **文档枚举**：`succeeded`/`processing`/`queued`/`failed` 等精确映射
3. **前缀模糊**：`success*`/`comp*` → `SUCCESS`；`erro*`/`fail*` → `FAILURE`；`run*`/`process*` → `IN_PROGRESS`；`queue*`/`pend*` → `QUEUED`
4. **结果 URL**：`content.url` 存在且无失败信号 → `SUCCESS`
5. **失败信号**：状态不可识别但有 `fail_reason`/`error.message` → `FAILURE`
6. **安全默认**：未知状态 → `QUEUED`（永不返回 `UNKNOWN`）

## Artifacts

任务成功后，从 `content.url` 或 `content.parts[].url` 提取 3D 模型文件：
- **Key**：`file` / `file_2` / ...
- **Type**：`file`
- **MIME**：`model/gltf-binary`（默认）
- **回源**：`credentialless: true`（预签名 URL，不携带渠道鉴权）

## 用量跟踪

- **Hyper3D-Gen2**：固定 30,000 output_tokens
- **其他模型**：1 output_token

## 示例请求

### Seed3D（图生 3D）

```json
POST /ark/3d/generations/tasks

{
  "model": "doubao-seed3d-2-0-260328",
  "content": [
    {
      "type": "text",
      "text": "--subdivisionlevel medium --fileformat glb"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/input.png"
      }
    }
  ]
}
```

### Hyper3D-Gen2（文生 3D）

```json
POST /ark/3d/generations/tasks

{
  "model": "hyper3d-gen2-260112",
  "content": [
    {
      "type": "text",
      "text": "Complete full-body quadrupedal mech robot, orange and black armored --mesh_mode Raw --hd_texture true --quality_override 1000000"
    }
  ],
  "seed": 8648
}
```

### HiTem3D（图生 3D）

```json
POST /ark/3d/generations/tasks

{
  "model": "hitem3d-2-0-251223",
  "content": [
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/input.png"
      }
    }
  ]
}
```

## 查询响应示例

```json
GET /ark/3d/generations/tasks/cgt-2026xxxxxx

{
  "id": "cgt-2026xxxxxx",
  "model": "doubao-seed3d-2-0-260328",
  "status": "succeeded",
  "content": {
    "url": "https://ark-project.tos-cn-beijing.volces.com/output/model.glb"
  },
  "created_at": 1735660800,
  "updated_at": 1735660920,
  "usage": {
    "output_tokens": 1
  }
}
```

## 参考文档

- [3D 生成教程](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1874993)
- [Seed3D API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1856293)
- [Hyper3D API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2279945)
- [HiTem3D API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2307069)
- [模型价格](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1544106#59e650ae)

## 版本历史

### 1.0.0 (2026-09-04)

- 初始版本
- 支持 Seed3D、Hyper3D-Gen2、HiTem3D 三个模型系列
- 原生同构适配，保留厂商扩展字段
- 六层状态映射阶梯
- Artifact 发现与 credentialless 回源
- 用量跟踪（Hyper3D 30000 token，其他 1 token）
- ChannelType: 10001
