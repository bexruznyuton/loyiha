/**
 * API so'rov/javob tiplari (server + client).
 *
 * ESLATMA: serverda asl `shared/` papkasi saqlanmagan — bu fayl faqat
 * server kodidagi ishlatilishiga qarab tiklangan.
 */

export interface DemoResponse {
  message: string;
}

export interface InstagramScrapeRequest {
  username: string;
  searchString: string;
}

export interface InstagramScrapeResponse {
  success: boolean;
  totalPosts?: number;
  matchedPosts?: number;
  links?: string[];
  error?: string;
}

export interface InstagramCaptionRequest {
  url: string;
}

export interface InstagramCaptionResponse {
  success: boolean;
  caption: string;
  source?: string;
  error?: string;
}
