import type { SteamCmdStatus } from '../types/domain.js';

export interface ISteamCmdManager {
  getStatus(): Promise<SteamCmdStatus>;
  install(installDir: string): Promise<void>;
  updateU3DS(installDir: string): Promise<void>;
  downloadWorkshopItem(installDir: string, itemIds: string[]): Promise<void>;
}
