/**
 * Marketplace DTO tiplari (server + client).
 *
 * ESLATMA: serverda asl `shared/` papkasi saqlanmagan — bu fayl Prisma
 * `AdAccount` modeli va `routes/marketplace/accounts.ts` dagi `toDTO()`
 * ga qarab tiklangan.
 */

export interface AdAccountDTO {
  id: number;
  ownerId: number;
  igUsername: string;
  igProfileUrl: string;
  avatarFileId: string;
  niche: string;
  customNiche: string;
  region: string;
  description: string;
  verificationScreenshots: string[];
  followers: number;
  avgReelsViews: number;
  storyViews: number;
  engagementRate: number;
  priceStory: number;
  priceReels: number;
  priceFeed: number;
  guaranteedViews: number;
  guaranteeHours: number;
  status: string;
  isVerified: boolean;
  verifiedBadge: boolean;
  rating: number;
  completedOrders: number;
  successRate: number;
  createdAt: string;
  pendingEdit: Record<string, unknown> | null;
}
