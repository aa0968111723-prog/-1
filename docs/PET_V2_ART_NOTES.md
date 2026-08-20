# 小財 V2 美術備註（Grok）

參考圖：`docs/pet-v2-reference.png`（108 視窗向量對齊同一隻角色）

## 改過 / 新增

**改（drawable）**
- `ic_pet_body.xml` — 去掉翅膀與肚金幣；梨形圓滾滾、2.5D 徑向高光 + rim light、短橘腳、雙葉嫩芽
- `ic_pet_face_idle.xml` / `_happy` / `_blink` / `_sleep` / `_concern` — 大眼雙 catchlight、圓粉腮、小橘喙；sleep 的 Z 已移出

**新（drawable）**
- `ic_pet_wings.xml` — 雙翼，與身體同 108 viewport
- `ic_pet_face_surprised.xml`（・o・）/ `_curious.xml`（眼偏右、單邊挑眉）/ `_shy.xml`（視線避開、超大腮紅）
- `ic_pet_prop_wallet.xml` / `_notebook.xml` / `_blanket.xml` / `_party_hat.xml`（錐帽，有別於 Lv5 圓帽）
- `ic_pet_zzz.xml` — 三顆漂浮 Z

未改檔名，未動 `DrawablePetRenderer.kt` / 任何 `.kt` `.ts`。Splash 仍只疊 body+idle，接翅膀層前會暫時沒翅膀。

## 建議疊層（底 → 頂）

1. `ic_pet_wings`（身體後方，內側被 silhouette 擋住）
2. `ic_pet_body`（影 → rim → 身體 → 腳 → 芽）
3. `ic_pet_face_*`（互斥）
4. prop 擇一：`wallet` | `notebook` | `blanket`（blanket 從 y≈74 蓋下半，五官仍可見）
5. accessory：既有 `leaf/scarf/hat` **或** `party_hat`
6. `ic_pet_zzz`（僅深睡）

錢包／筆記本約在肚皮 (54, 82)；派對帽已預旋 12°。

## Pivot（108 viewport px）

| 元件 | pivot | 建議 |
|---|---|---|
| `left_wing` | **(26, 58)** | wiggle −12°…+8°（負＝上拍） |
| `right_wing` | **(82, 58)** | 鏡向 +12°…−8° |
| `sprout` | **(54, 16)** | sway ±8° |
| `body` | **(54, 54)** | 既有呼吸 scale |
| `party_hat` | **(56, 26)** | 已 rotation=12 |
| `z_small/mid/large` | (76,34)/(86,22)/(96,10) | 輕微 float α／y |

色票維持 `#FFD66B` / stroke `#E0AE45` / 芽綠 / 腮 `#FF8B96`。
