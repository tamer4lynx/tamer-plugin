// Re-export from @tamer4lynx/tamer-asset for backwards compatibility.
// Import directly from @tamer4lynx/tamer-asset in new code.
export {
  Asset,
  resolveAssetSource,
  loadAssets,
  getManifest,
  lookupManifestEntry,
} from '@tamer4lynx/tamer-asset'
export type { TamerAsset, TamerAssetInput, AssetManifestEntry, AssetManifest } from '@tamer4lynx/tamer-asset'
