import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authenticateToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  CreateItemSchema,
  UpdateItemSchema,
} from "@unturned-manager/shared";
import type { IItemService } from "@unturned-manager/shared";

/**
 * 物品清单 REST 端点（HTTP I/O 层）——同步 better-sqlite3 CRUD。
 * 响应统一 { data } / { error }；鉴权在 index.ts 挂载时统一套 JWT。
 *
 * 设计来源：docs/architecture/loadout-item-editor-design.md §4.5。
 */
export function createItemsRouter(itemService: IItemService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json({ data: itemService.listItems() });
    }),
  );

  router.post(
    "/",
    validate(CreateItemSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: itemService.createItem(req.body) });
    }),
  );

  router.put(
    "/:id",
    validate(UpdateItemSchema),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      res.json({ data: itemService.updateItem(id, req.body) });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      itemService.deleteItem(id);
      res.status(204).end();
    }),
  );

  return router;
}
