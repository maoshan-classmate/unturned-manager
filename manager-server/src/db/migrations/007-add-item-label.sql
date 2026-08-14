-- 007: item_list 加 label 列——中文显示名（仅前端 UI 显示，不参与 Commands.dat 序列化）
ALTER TABLE item_list ADD COLUMN label TEXT;
