/**
 * StyleNow — smart matching (pure scoring layer).
 *
 * Retrieval happens in Postgres (pgvector HNSW + PostGIS + tag filters).
 * This module re-ranks the shortlist and, critically, explains itself: every
 * score carries the reasons that produced it, which is what makes the feature
 * defensible under GDPR Art. 22 (no opaque automated decisions) and what makes
 * the UI able to say "matched because: balayage specialist, opens Sunday".
 *
 * Personalisation signals are only used when the user granted the
 * `personalisation` consent. Without it the ranker degrades gracefully to
 * distance + rating + availability, which is still a good feed.
 */

export interface MatchCandidate {
  shopId: string;
  distanceM: number;
  ratingAvg: number;
  ratingCount: number;
  priceFromCents: number;
  /** cosine similarity of shop embedding to the user's taste vector, 0..1 */
  semanticSimilarity: number;
  tagOverlap: number;
  /** minutes until the first free slot matching the query, null if none */
  minutesToFirstSlot: number | null;
  languagesSpoken: string[];
  completionRate: number;
  cancellationRate: number;
  isNew: boolean;
  isMobile: boolean;
  chainId?: string | null;
}

export interface MatchQuery {
  maxTravelM: number;
  budgetCents?: number;
  preferredLanguages: string[];
  wantsSoon: boolean;
  personalisationConsent: boolean;
}

export interface MatchScore {
  shopId: string;
  score: number;
  reasons: string[];
  components: Record<string, number>;
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/** Bayesian rating: a 5.0 from two reviews should not beat a 4.7 from three hundred. */
export function shrunkRating(avg: number, count: number, prior = 4.3, weight = 20): number {
  return (avg * count + prior * weight) / (count + weight);
}

export function scoreCandidate(c: MatchCandidate, q: MatchQuery): MatchScore {
  const reasons: string[] = [];

  const proximity = clamp01(1 - c.distanceM / Math.max(q.maxTravelM, 1));
  if (c.distanceM <= 1500) reasons.push('very_close');

  const quality = clamp01((shrunkRating(c.ratingAvg, c.ratingCount) - 3) / 2);
  if (c.ratingAvg >= 4.6 && c.ratingCount >= 25) reasons.push('highly_rated');

  const availability =
    c.minutesToFirstSlot === null ? 0 : clamp01(1 - c.minutesToFirstSlot / (7 * 24 * 60));
  if (q.wantsSoon && c.minutesToFirstSlot !== null && c.minutesToFirstSlot <= 180) {
    reasons.push('free_today');
  }

  const affinity = q.personalisationConsent
    ? clamp01(0.6 * c.semanticSimilarity + 0.4 * c.tagOverlap)
    : 0;
  if (affinity > 0.7) reasons.push('matches_your_style');

  const budgetFit = q.budgetCents
    ? clamp01(1 - Math.max(0, c.priceFromCents - q.budgetCents) / q.budgetCents)
    : 0.5;
  if (q.budgetCents && c.priceFromCents <= q.budgetCents) reasons.push('within_budget');

  const language = c.languagesSpoken.some((l) => q.preferredLanguages.includes(l)) ? 1 : 0;
  if (language && q.preferredLanguages.length) reasons.push('speaks_your_language');

  const reliability = clamp01(c.completionRate - c.cancellationRate * 2);
  if (c.cancellationRate > 0.15) reasons.push('higher_cancellation_rate');

  // New shops get a small exploration bonus so the marketplace does not
  // ossify around incumbents — capped, and disclosed in the UI as "New".
  const freshness = c.isNew ? 0.08 : 0;
  if (c.isNew) reasons.push('new_on_stylenow');

  const weights = q.personalisationConsent
    ? { proximity: 0.24, quality: 0.2, availability: 0.18, affinity: 0.18, budgetFit: 0.1, language: 0.05, reliability: 0.05 }
    : { proximity: 0.3, quality: 0.26, availability: 0.22, affinity: 0, budgetFit: 0.12, language: 0.05, reliability: 0.05 };

  const components = { proximity, quality, availability, affinity, budgetFit, language, reliability };
  const base = (Object.keys(weights) as Array<keyof typeof weights>).reduce(
    (sum, k) => sum + weights[k] * components[k],
    0,
  );

  return {
    shopId: c.shopId,
    score: Number(clamp01(base + freshness).toFixed(4)),
    reasons,
    components,
  };
}

/**
 * Diversity guard: at most `maxPerChain` locations of the same chain in the
 * first `window` results. Without it a chain with eleven branches in one
 * district owns the entire first screen, the feed stops looking like a
 * marketplace, and independents churn off the platform.
 *
 * Demoted results are pushed below the window rather than dropped — a user who
 * genuinely wants that chain still finds every branch by scrolling.
 */
function applyChainDiversity(
  scored: MatchScore[],
  chainOf: Map<string, string | null | undefined>,
  window = 10,
  maxPerChain = 3,
): MatchScore[] {
  const head: MatchScore[] = [];
  const demoted: MatchScore[] = [];
  const seen = new Map<string, number>();

  for (const s of scored) {
    const chain = chainOf.get(s.shopId);
    if (head.length < window && chain) {
      const n = seen.get(chain) ?? 0;
      if (n >= maxPerChain) { demoted.push(s); continue; }
      seen.set(chain, n + 1);
    }
    head.push(s);
  }
  return [...head, ...demoted];
}

export function rank(candidates: MatchCandidate[], q: MatchQuery, limit = 20): MatchScore[] {
  const eligible = candidates.filter((c) => c.distanceM <= q.maxTravelM || c.isMobile);
  const scored = eligible.map((c) => scoreCandidate(c, q)).sort((a, b) => b.score - a.score);
  const chainOf = new Map(eligible.map((c) => [c.shopId, c.chainId]));
  return applyChainDiversity(scored, chainOf).slice(0, limit);
}
