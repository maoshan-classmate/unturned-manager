import type { WorkshopFileId } from '../types/branded.js';
import type { WorkshopModMeta } from '../types/domain.js';

export interface IWorkshopMetadataService {
  getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null>;
  searchMods(query: string): Promise<WorkshopModMeta[]>;
  refreshCache(modId: WorkshopFileId): Promise<void>;
}
