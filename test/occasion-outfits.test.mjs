import test from "node:test";
import assert from "node:assert/strict";
import { buildOccasionOutfitSuggestions } from "../src/occasion-outfits.mjs";

const item = (id, part, name, tags = []) => ({ id, part, name, tags, color: "#808080", image: `/img/${id}.png` });

const wardrobe = [
  item("blazer", "wholebody_up", "Navy blazer", ["formal", "elegant"]),
  item("shirt", "upperbody", "White oxford shirt", ["formal", "košulja"]),
  item("tee", "upperbody", "Graphic t-shirt", ["casual", "majica"]),
  item("chinos", "lowerbody", "Chino trousers", ["formal", "chino"]),
  item("joggers", "lowerbody", "Sport joggers", ["sport", "trenirka"]),
  item("oxfords", "shoes", "Leather oxfords", ["formal"]),
  item("sneakers", "shoes", "Running sneakers", ["sport", "tenisice"]),
];

test("returns nothing for an empty description", () => {
  assert.deepEqual(buildOccasionOutfitSuggestions(wardrobe, ""), []);
  assert.deepEqual(buildOccasionOutfitSuggestions(wardrobe, "   "), []);
});

test("returns nothing when the description matches no known occasion", () => {
  assert.deepEqual(buildOccasionOutfitSuggestions(wardrobe, "asdkjaslkdj"), []);
});

test("a work meeting favors formal pieces over sport pieces", () => {
  const suggestions = buildOccasionOutfitSuggestions(wardrobe, "poslovni sastanak");
  assert.ok(suggestions.length > 0);
  const firstIds = suggestions[0].items.map((piece) => piece.id);
  assert.ok(firstIds.includes("shirt") || firstIds.includes("blazer") || firstIds.includes("chinos"));
  assert.ok(!firstIds.includes("joggers"));
  assert.match(suggestions[0].reason, /poslovni sastanak/);
});

test("a gym session favors sport pieces over formal pieces", () => {
  const suggestions = buildOccasionOutfitSuggestions(wardrobe, "idem u teretanu");
  assert.ok(suggestions.length > 0);
  const firstIds = suggestions[0].items.map((piece) => piece.id);
  assert.ok(firstIds.includes("joggers") || firstIds.includes("sneakers"));
  assert.ok(!firstIds.includes("blazer"));
});
