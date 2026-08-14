import { useState, useEffect, useCallback } from "react";
import { fetchItems } from "../api/items.js";
import type { ItemRecord } from "@unturned-manager/shared";

interface UseItemsReturn {
  /** 物品清单（内置 + 自定义，按 ID 升序） */
  items: ItemRecord[];
  loading: boolean;
  error: string | null;
  /** 重拉清单（物品清单 CRUD 后调用） */
  reload: () => Promise<void>;
}

/**
 * 物品清单 hook——挂载拉一次 + CRUD 后手动 reload。
 * LoadoutEditor 内部自持：ConfigPage 不感知物品清单的存在。
 *
 * @returns 物品清单状态 + { reload }
 *
 * @example
 * ```tsx
 * const { items, reload } = useItems();
 * ```
 */
export function useItems(): UseItemsReturn {
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await fetchItems();
      setItems(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取物品清单失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, error, reload };
}
