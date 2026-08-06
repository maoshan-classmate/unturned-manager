// Branded types — 编译期类型安全，运行时是原始 string/number
// 是整个 shared/ 包的类型系统基础，防止原始类型混淆

export type ServerId = string & { readonly __brand: 'ServerId' };
export type SteamId64 = string & { readonly __brand: 'SteamId64' };
export type WorkshopFileId = string & { readonly __brand: 'WorkshopFileId' };
export type Port = number & { readonly __brand: 'Port' };
