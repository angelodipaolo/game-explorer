/** IGDB image URL builder. https://api-docs.igdb.com/#images */
export type IgdbImageSize =
  | "cover_small" // 90x128
  | "cover_big" // 264x374
  | "720p"
  | "1080p"
  | "screenshot_med" // 569x320
  | "screenshot_big" // 889x500
  | "screenshot_huge" // 1280x720
  | "thumb"
  | "micro";

export function igdbImageUrl(imageId: string, size: IgdbImageSize, retina = false): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}${retina ? "_2x" : ""}/${imageId}.jpg`;
}
