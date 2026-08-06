import type { ServerId } from '../types/branded.js';

export interface ILogStreamer {
  startStreaming(serverId: ServerId): void;
  stopStreaming(serverId: ServerId): void;
}
