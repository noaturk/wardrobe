// Pure, JSX-free "describe the occasion" matching so it can be unit tested with `node --test`.
// Deliberately local keyword matching (no OpenAI call) to keep this free, same as weather-outfits.mjs.
import { buildOutfitSuggestions } from "./outfit-suggestions.mjs";

function itemText(item) {
  return [item.name, item.subcategory, item.brand, ...(item.tags || [])].filter(Boolean).join(" ").toLocaleLowerCase("hr-HR");
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

const OCCASION_BUCKETS = [
  {
    trigger: ["posao", "ured", "sastanak", "intervju", "work", "office", "meeting", "interview", "prezentacij"],
    boost: ["odijelo", "suit", "košulj", "shirt", "blazer", "elegant", "formal", "chino", "oxford", "bluza"],
    penalty: ["trenirk", "sport", "kratke hlače", "shorts", "natikač", "flip"],
  },
  {
    trigger: ["vjenčanj", "svečan", "gala", "wedding", "proslav", "matural"],
    boost: ["elegant", "svečan", "haljin", "dress", "odijelo", "suit", "blazer", "štikl", "heel"],
    penalty: ["trenirk", "sport", "casual", "kratke hlače", "shorts"],
  },
  {
    trigger: ["izlazak", "spoj", "večer", "date", "dinner", "party", "žurk", "klub"],
    boost: ["elegant", "smart", "chic", "blazer", "košulj", "shirt", "haljin", "dress"],
    penalty: ["trenirk", "sportsk", "athletic", "planinar"],
  },
  {
    trigger: ["teretan", "trening", "sport", "gym", "workout", "trčanj", "running", "planinar", "hiking"],
    boost: ["sport", "trenirk", "athletic", "tenisic", "sneaker", "legging", "dres"],
    penalty: ["odijelo", "suit", "elegant", "formal", "štikl", "heel", "haljin"],
  },
  {
    trigger: ["opušten", "casual", "kava", "coffee", "shopping", "vikend", "weekend"],
    boost: ["casual", "majic", "t-shirt", "traperic", "jeans", "sneaker", "tenisic", "hoodie", "duksic"],
    penalty: [],
  },
  {
    trigger: ["putovanj", "let", "avion", "travel", "flight"],
    boost: ["udobn", "comfort", "sloj", "layer", "hoodie", "tenisic", "sneaker"],
    penalty: ["štikl", "heel", "svečan"],
  },
];

const NAMES = ["Najbolje za priliku", "Alternativa za priliku", "Još jedna opcija", "Dodatni izbor"];

function matchingBuckets(occasionText) {
  const text = occasionText.toLocaleLowerCase("hr-HR");
  return OCCASION_BUCKETS.filter((bucket) => includesAny(text, bucket.trigger));
}

function itemOccasionScore(item, buckets) {
  const text = itemText(item);
  return buckets.reduce((score, bucket) => score
    + (includesAny(text, bucket.boost) ? 4 : 0)
    - (includesAny(text, bucket.penalty) ? 5 : 0), 0);
}

function combinationOccasionScore(items, buckets) {
  return items.reduce((total, item) => total + itemOccasionScore(item, buckets), 0);
}

export function buildOccasionOutfitSuggestions(items, occasionText) {
  const trimmed = (occasionText || "").trim();
  if (!trimmed) return [];
  const buckets = matchingBuckets(trimmed);
  if (!buckets.length) return [];
  return buildOutfitSuggestions(items)
    .map((suggestion, index) => ({ suggestion, index, score: combinationOccasionScore(suggestion.items, buckets) }))
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, 4)
    .map(({ suggestion }, index) => ({
      ...suggestion,
      id: `occasion-${suggestion.id}`,
      name: NAMES[index % NAMES.length],
      reason: `Odabrano prema opisu: "${trimmed}".`,
      isOccasionPick: true,
    }));
}
