import { apiClient } from "./client.js";
import type { ItemRecord } from "@unturned-manager/shared";

/**
 * 拉取物品清单（全量，按 ID 升序）——客户端搜索用。
 * @returns 物品记录列表（内置 + 自定义）
 */
export async function fetchItems(): Promise<ItemRecord[]> {
  const { data } = await apiClient.get<{ data: ItemRecord[] }>("/items");
  return data.data;
}

/**
 * 新增自定义物品。
 * @param input - { id: 物品 ID, name: 显示名 }
 * @returns 新建记录
 */
export async function createItem(input: {
  id: number;
  name: string;
}): Promise<ItemRecord> {
  const { data } = await apiClient.post<{ data: ItemRecord }>("/items", input);
  return data.data;
}

/**
 * 修改自定义物品（ID 或名称，至少一项）。
 * @param id - 目标物品 ID
 * @param input - 可改字段
 * @returns 更新后的记录
 */
export async function updateItem(
  id: number,
  input: { id?: number; name?: string },
): Promise<ItemRecord> {
  const { data } = await apiClient.put<{ data: ItemRecord }>(
    `/items/${id}`,
    input,
  );
  return data.data;
}

/**
 * 删除自定义物品。
 * @param id - 目标物品 ID
 */
export async function deleteItem(id: number): Promise<void> {
  await apiClient.delete(`/items/${id}`);
}
