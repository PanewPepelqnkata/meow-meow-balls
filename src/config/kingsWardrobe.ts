import { COLLECTIBLE_TIERS, collectionDiscovery, collectionSlotsFor } from './collectibleCollection'
import type { SaveDataV1 } from '../game/state/save'

export type AchievementCategory = 'gameplay' | 'merge' | 'collection' | 'score' | 'milestone'
export type AchievementMetricKey = 'runs' | 'merges' | 'collection_count' | 'best_score' | 'best_tier'

export interface WardrobeCharacter {
  id: string
  tier: number
  theme?: string
  name: string
  subtitle: string
  requirement: string
  seed: number
}

export const WARDROBE_CHARACTERS: readonly WardrobeCharacter[] = [
  { id: 'core:1', tier: 1, name: 'Sunny', subtitle: 'FIRST DROP', requirement: 'Starter Character (Tier 1)', seed: 108 },
  { id: 'core:2', tier: 2, name: 'Berry', subtitle: 'SWEET SPARK', requirement: 'Starter Character (Tier 2)', seed: 215 },
  { id: 'core:3', tier: 3, name: 'Minty', subtitle: 'FRESH BOUNCE', requirement: 'Starter Character (Tier 3)', seed: 322 },
  { id: 'core:4', tier: 4, name: 'Tangerine', subtitle: 'CITRUS GUARD', requirement: 'Reach Tier 4 in a run', seed: 429 },
  { id: 'core:5', tier: 5, name: 'Classic Hero', subtitle: 'HOUSE CLASSIC', requirement: 'Reach Tier 5 in a run', seed: 536 },
  { id: 'core:6', tier: 6, name: 'Plum', subtitle: 'VELVET KNIGHT', requirement: 'Reach Tier 6 in a run', seed: 643 },
  { id: 'core:7', tier: 7, name: 'Coral', subtitle: 'CROWN JEWEL', requirement: 'Reach Tier 7 in a run', seed: 750 },
  { id: 'core:8', tier: 8, name: 'RGB Champion', subtitle: 'PRISMATIC CROWN', requirement: 'Merge into Tier 8 Prism', seed: 857 },
  { id: 'collectible:9:shark', tier: 9, theme: 'shark', name: 'Shark', subtitle: 'TIDEKEEPER', requirement: 'Discover Tier 9 Shark', seed: 911 },
  { id: 'collectible:9:pig', tier: 9, theme: 'pig', name: 'Pig', subtitle: 'HEART OF THE HALL', requirement: 'Discover Tier 9 Pig', seed: 922 },
  { id: 'collectible:9:drunko', tier: 9, theme: 'drunko', name: 'Drunko', subtitle: 'ROYAL TOAST', requirement: 'Discover Tier 9 Drunko', seed: 933 },
  { id: 'collectible:9:robo', tier: 9, theme: 'robo', name: 'Robo', subtitle: 'IRON GUARD', requirement: 'Discover Tier 9 Robo', seed: 944 },
  { id: 'collectible:9:pirate', tier: 9, theme: 'pirate', name: 'Pirate', subtitle: 'THE HIGH SEAS', requirement: 'Discover Tier 9 Pirate', seed: 955 },
  { id: 'collectible:10:crab', tier: 10, theme: 'crab', name: 'Crab', subtitle: 'SHELL SENTINEL', requirement: 'Discover Tier 10 Crab', seed: 1011 },
] as const

const CHARACTER_BY_ID: Record<string, WardrobeCharacter> = Object.fromEntries(
  WARDROBE_CHARACTERS.map((char) => [char.id, char]),
)

export function isValidWardrobeCharacterId(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CHARACTER_BY_ID, id.trim())
}

export function getWardrobeCharacter(id: string | null | undefined): WardrobeCharacter {
  if (id && Object.prototype.hasOwnProperty.call(CHARACTER_BY_ID, id.trim())) {
    return CHARACTER_BY_ID[id.trim()]!
  }
  return WARDROBE_CHARACTERS[0]!
}

export function isCharacterUnlockedInSave(save: SaveDataV1, characterId: string): boolean {
  if (!isValidWardrobeCharacterId(characterId)) return false
  if (characterId === 'core:1' || characterId === 'core:2' || characterId === 'core:3') {
    return true
  }
  if (characterId.startsWith('core:')) {
    const tier = Number(characterId.slice('core:'.length))
    return save.discovered[String(tier)] != null || save.stats.bestTier >= tier
  }
  if (characterId.startsWith('collectible:')) {
    const [, tierStr, theme] = characterId.split(':')
    const tier = Number(tierStr)
    if (!theme || !Number.isInteger(tier)) return false
    return collectionDiscovery(save.variants, tier, theme) !== null
  }
  return false
}

export function getUnlockedCharacterIdsFromSave(save: SaveDataV1): string[] {
  const unlocked: string[] = []
  for (const char of WARDROBE_CHARACTERS) {
    if (isCharacterUnlockedInSave(save, char.id)) {
      unlocked.push(char.id)
    }
  }
  return unlocked
}

export function getCharacterVariantFromSave(save: SaveDataV1, characterId: string): number {
  const char = getWardrobeCharacter(characterId)
  if (!char.theme) return 0
  const found = collectionDiscovery(save.variants, char.tier, char.theme)
  return found?.variant ?? 0
}

export function validateFavoriteBallIds(
  ids: readonly string[],
  unlockedIds?: ReadonlySet<string>,
): { valid: boolean; normalized: string[]; error: string | null } {
  if (!Array.isArray(ids)) {
    return { valid: false, normalized: [], error: 'Favorite balls must be an array' }
  }
  if (ids.length > 3) {
    return { valid: false, normalized: [], error: 'You can showcase at most 3 favorite balls' }
  }
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of ids) {
    if (typeof raw !== 'string') {
      return { valid: false, normalized: [], error: 'Invalid ball character identifier' }
    }
    const clean = raw.trim()
    if (!isValidWardrobeCharacterId(clean)) {
      return { valid: false, normalized: [], error: 'Invalid ball character identifier' }
    }
    if (seen.has(clean)) {
      return { valid: false, normalized: [], error: 'Duplicate favorite balls are not allowed' }
    }
    if (unlockedIds && !unlockedIds.has(clean)) {
      return { valid: false, normalized: [], error: 'Cannot select a locked character as a favorite' }
    }
    seen.add(clean)
    normalized.push(clean)
  }
  return { valid: true, normalized, error: null }
}

const RESERVED_USERNAMES: Record<string, true> = {
  admin: true, administrator: true, root: true, system: true, support: true,
  moderator: true, mod: true, ballrush: true, ball_rush: true, official: true,
  staff: true, owner: true, developer: true, dev: true, null: true,
  undefined: true, anonymous: true, guest: true, king: true, royal_admin: true,
  supabase: true,
}

const PROHIBITED_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'cock',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut', 'bastard',
  'nazi', 'hitler', 'rape', 'rapist', 'pedo', 'pedophile', 'kike', 'chink', 'spic',
]

function deobfuscateLeet(input: string): string {
  const map: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's',
  }
  return input.replace(/[0134578@$]/g, (ch) => map[ch] ?? ch)
}

export function validateRoyalUsername(raw: string): { valid: boolean; normalized: string; error: string | null } {
  const trimmed = (raw ?? '').trim()
  if (trimmed.length < 3 || trimmed.length > 20) {
    return { valid: false, normalized: trimmed, error: 'Username must be between 3 and 20 characters' }
  }
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return { valid: false, normalized: trimmed, error: 'Only letters, numbers, and underscores are allowed' }
  }
  if (trimmed.startsWith('_') || trimmed.endsWith('_') || trimmed.includes('__')) {
    return { valid: false, normalized: trimmed, error: 'Cannot start/end with underscore or use double underscores' }
  }
  const lower = trimmed.toLowerCase()
  if (RESERVED_USERNAMES[lower]) {
    return { valid: false, normalized: trimmed, error: 'This username is reserved by the kingdom' }
  }
  const compact = deobfuscateLeet(lower)
  for (const word of PROHIBITED_WORDS) {
    if (lower.includes(word) || compact.includes(word)) {
      return { valid: false, normalized: trimmed, error: 'Username contains prohibited language' }
    }
  }
  return { valid: true, normalized: trimmed, error: null }
}

export interface AchievementDefinition {
  id: string
  category: AchievementCategory
  name: string
  description: string
  unlock_condition: string
  metric_key: AchievementMetricKey
  target_value: number
  reward_title_id: string | null
  reward_title_name: string | null
  sort_order: number
}

export interface PlayerAchievement extends AchievementDefinition {
  unlocked: boolean
  unlocked_at: string | null
  current_value?: number
}

export interface PlayerTitle {
  id: string
  name: string
  achievement_id: string
  achievement_name: string
  unlocked: boolean
  unlocked_at: string | null
}

export interface LifetimeStatistics {
  games_played: number
  total_merges: number
  highest_tier: number
  total_playtime_ms: number
  total_coins_earned: number
  current_coins: number
  average_score: number
  best_score: number
  verified_runs_count: number
}

export interface KingsWardrobeOverview {
  profile: {
    id: string
    username: string | null
    display_name: string
    selected_avatar_id: string
    active_title_id: string | null
    favorite_ball_ids: string[]
    username_changed_at: string | null
    created_at: string
    updated_at: string
  }
  auth_providers: string[]
  unlocked_ball_ids: string[]
  total_available_balls: number
  achievements: PlayerAchievement[]
  titles: PlayerTitle[]
  newly_unlocked_achievements: Array<{
    id: string
    name: string
    reward_title_id: string | null
    reward_title_name: string | null
  }>
  statistics: LifetimeStatistics
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  {
    id: 'first_run',
    category: 'gameplay',
    name: 'First Run',
    description: 'Step into the royal chamber and complete your first game.',
    unlock_condition: 'Complete 1 game',
    metric_key: 'runs',
    target_value: 1,
    reward_title_id: 'royal_initiate',
    reward_title_name: 'Royal Initiate',
    sort_order: 10,
  },
  {
    id: 'regular_player',
    category: 'gameplay',
    name: 'Regular Player',
    description: 'Prove your dedication to the realm across fifty completed runs.',
    unlock_condition: 'Complete 50 games',
    metric_key: 'runs',
    target_value: 50,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 20,
  },
  {
    id: 'veteran',
    category: 'gameplay',
    name: 'Veteran',
    description: 'Stand tested across two hundred and fifty completed battles.',
    unlock_condition: 'Complete 250 games',
    metric_key: 'runs',
    target_value: 250,
    reward_title_id: 'kingdom_veteran',
    reward_title_name: 'Kingdom Veteran',
    sort_order: 30,
  },
  {
    id: 'dedicated',
    category: 'gameplay',
    name: 'Dedicated',
    description: 'Complete one thousand runs inside the royal machine.',
    unlock_condition: 'Complete 1,000 games',
    metric_key: 'runs',
    target_value: 1000,
    reward_title_id: 'the_unstoppable',
    reward_title_name: 'The Unstoppable',
    sort_order: 40,
  },
  {
    id: 'first_merge',
    category: 'merge',
    name: 'First Merge',
    description: 'Combine two matching slimes for the very first time.',
    unlock_condition: 'Complete 1 merge',
    metric_key: 'merges',
    target_value: 1,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 50,
  },
  {
    id: 'merge_apprentice',
    category: 'merge',
    name: 'Merge Apprentice',
    description: 'Master the basics with one hundred successful merges.',
    unlock_condition: 'Complete 100 merges',
    metric_key: 'merges',
    target_value: 100,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 60,
  },
  {
    id: 'merge_expert',
    category: 'merge',
    name: 'Merge Expert',
    description: 'Forge five hundred merges in the royal crucible.',
    unlock_condition: 'Complete 500 merges',
    metric_key: 'merges',
    target_value: 500,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 70,
  },
  {
    id: 'merge_master',
    category: 'merge',
    name: 'Merge Master',
    description: 'Command the arena with two thousand lifetime merges.',
    unlock_condition: 'Complete 2,000 merges',
    metric_key: 'merges',
    target_value: 2000,
    reward_title_id: 'master_merger',
    reward_title_name: 'Master Merger',
    sort_order: 80,
  },
  {
    id: 'first_discovery',
    category: 'collection',
    name: 'First Discovery',
    description: 'Uncover your first new ball beyond the starter trio.',
    unlock_condition: 'Unlock 4 balls in Collection',
    metric_key: 'collection_count',
    target_value: 4,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 90,
  },
  {
    id: 'growing_collection',
    category: 'collection',
    name: 'Growing Collection',
    description: 'Fill the royal archives with eight distinct characters.',
    unlock_condition: 'Unlock 8 balls in Collection',
    metric_key: 'collection_count',
    target_value: 8,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 100,
  },
  {
    id: 'collector',
    category: 'collection',
    name: 'Collector',
    description: 'Discover twelve characters across core and themed runs.',
    unlock_condition: 'Unlock 12 balls in Collection',
    metric_key: 'collection_count',
    target_value: 12,
    reward_title_id: 'the_collector',
    reward_title_name: 'The Collector',
    sort_order: 110,
  },
  {
    id: 'full_collection',
    category: 'collection',
    name: 'Full Collection',
    description: 'Discover every Ball Rush character currently available in the kingdom.',
    unlock_condition: 'Unlock all 14 available balls',
    metric_key: 'collection_count',
    target_value: 14,
    reward_title_id: 'grand_curator',
    reward_title_name: 'Grand Curator',
    sort_order: 120,
  },
  {
    id: 'first_record',
    category: 'score',
    name: 'First Record',
    description: 'Reach one thousand points in a single run.',
    unlock_condition: 'Reach 1,000 points',
    metric_key: 'best_score',
    target_value: 1000,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 130,
  },
  {
    id: 'high_scorer',
    category: 'score',
    name: 'High Scorer',
    description: 'Score ten thousand points in a single royal run.',
    unlock_condition: 'Reach 10,000 points',
    metric_key: 'best_score',
    target_value: 10000,
    reward_title_id: 'ball_champion',
    reward_title_name: 'Ball Champion',
    sort_order: 140,
  },
  {
    id: 'legendary_run',
    category: 'score',
    name: 'Legendary Run',
    description: 'Achieve a legendary twenty-five thousand point run.',
    unlock_condition: 'Reach 25,000 points',
    metric_key: 'best_score',
    target_value: 25000,
    reward_title_id: 'royal_champion',
    reward_title_name: 'Royal Champion',
    sort_order: 150,
  },
  {
    id: 'tier_climber',
    category: 'milestone',
    name: 'Tier Climber',
    description: 'Merge your way up to Tier 5 in a run.',
    unlock_condition: 'Reach Tier 5',
    metric_key: 'best_tier',
    target_value: 5,
    reward_title_id: null,
    reward_title_name: null,
    sort_order: 160,
  },
  {
    id: 'dragon_tamer',
    category: 'milestone',
    name: 'Dragon Tamer',
    description: 'Unlock a Tier 9 collectible champion during a run.',
    unlock_condition: 'Reach Tier 9',
    metric_key: 'best_tier',
    target_value: 9,
    reward_title_id: 'dragon_tamer',
    reward_title_name: 'Dragon Tamer',
    sort_order: 170,
  },
  {
    id: 'maximum_merge',
    category: 'milestone',
    name: 'Maximum Merge',
    description: 'Reach Tier 10, the highest playable merge tier in the realm.',
    unlock_condition: 'Reach Tier 10',
    metric_key: 'best_tier',
    target_value: 10,
    reward_title_id: 'legendary_adventurer',
    reward_title_name: 'Legendary Adventurer',
    sort_order: 180,
  },
] as const

export function getTitleNameById(titleId: string | null | undefined): string | null {
  if (!titleId) return null
  const found = ACHIEVEMENT_CATALOG.find((a) => a.reward_title_id === titleId)
  return found?.reward_title_name ?? null
}

export function formatPlaytime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function buildFallbackOverviewFromSave(
  save: SaveDataV1,
  profile: {
    id: string
    username: string | null
    display_name: string | null
    selected_avatar_id?: string | null
    active_title_id?: string | null
    favorite_ball_ids?: string[] | null
    username_changed_at?: string | null
    created_at?: string | null
    updated_at?: string | null
  } | null,
): KingsWardrobeOverview {
  const unlockedIds = getUnlockedCharacterIdsFromSave(save)
  const collectionCount = unlockedIds.length
  const runs = save.stats.runs
  const merges = save.stats.merges
  const bestScore = save.best
  const bestTier = Math.max(1, save.stats.bestTier)

  const achievements: PlayerAchievement[] = ACHIEVEMENT_CATALOG.map((def) => {
    const val =
      def.metric_key === 'runs' ? runs
        : def.metric_key === 'merges' ? merges
          : def.metric_key === 'collection_count' ? collectionCount
            : def.metric_key === 'best_score' ? bestScore
              : bestTier
    return {
      ...def,
      unlocked: val >= def.target_value,
      unlocked_at: null,
      current_value: val,
    }
  })

  const titles: PlayerTitle[] = achievements
    .filter((a) => a.reward_title_id && a.reward_title_name)
    .map((a) => ({
      id: a.reward_title_id!,
      name: a.reward_title_name!,
      achievement_id: a.id,
      achievement_name: a.name,
      unlocked: a.unlocked,
      unlocked_at: a.unlocked_at,
    }))

  const selectedAvatar = profile?.selected_avatar_id && isValidWardrobeCharacterId(profile.selected_avatar_id)
    ? profile.selected_avatar_id
    : 'core:1'
  const favorites = Array.isArray(profile?.favorite_ball_ids)
    ? profile!.favorite_ball_ids.filter((id) => isValidWardrobeCharacterId(id)).slice(0, 3)
    : []

  const avgScore = save.leaderboard.length > 0
    ? Math.round(save.leaderboard.reduce((acc, e) => acc + e.score, 0) / save.leaderboard.length)
    : 0

  return {
    profile: {
      id: profile?.id ?? 'guest',
      username: profile?.username ?? null,
      display_name: profile?.display_name || profile?.username || 'Royal Guest',
      selected_avatar_id: selectedAvatar,
      active_title_id: profile?.active_title_id ?? null,
      favorite_ball_ids: favorites,
      username_changed_at: profile?.username_changed_at ?? null,
      created_at: profile?.created_at ?? new Date().toISOString(),
      updated_at: profile?.updated_at ?? new Date().toISOString(),
    },
    auth_providers: profile ? ['email'] : [],
    unlocked_ball_ids: unlockedIds,
    total_available_balls: WARDROBE_CHARACTERS.length,
    achievements,
    titles,
    newly_unlocked_achievements: [],
    statistics: {
      games_played: runs,
      total_merges: merges,
      highest_tier: bestTier,
      total_playtime_ms: 0,
      total_coins_earned: save.coins,
      current_coins: save.coins,
      average_score: avgScore,
      best_score: bestScore,
      verified_runs_count: save.leaderboard.length,
    },
  }
}

export function countAllCollectionBookSlotsDiscovered(save: SaveDataV1): number {
  let discovered = 0
  for (let tier = 1; tier <= 8; tier++) {
    if (save.discovered[String(tier)] != null) discovered++
  }
  for (const tier of COLLECTIBLE_TIERS) {
    for (const slot of collectionSlotsFor(tier)) {
      if (slot.theme && collectionDiscovery(save.variants, tier, slot.theme)) discovered++
    }
  }
  return discovered
}
