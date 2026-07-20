import test from "node:test";
import assert from "node:assert/strict";
import { buildOutfitSuggestions } from "../src/outfit-suggestions.mjs";

const item = (id, part, color = "#808080") => ({ id, part, color, name: id, image: `/img/${id}.png` });

test("returns no suggestions for an empty wardrobe", () => {
  assert.deepEqual(buildOutfitSuggestions([]), []);
});

test("pairs a top with a bottom into a valid combination", () => {
  const suggestions = buildOutfitSuggestions([item("t1", "upperbody"), item("b1", "lowerbody")]);
  assert.equal(suggestions.length, 1);
  const ids = suggestions[0].items.map((piece) => piece.id).sort();
  assert.deepEqual(ids, ["b1", "t1"]);
  assert.ok(suggestions[0].items.length >= 2);
  assert.equal(typeof suggestions[0].name, "string");
  assert.equal(typeof suggestions[0].reason, "string");
});

test("never produces a single-item combination", () => {
  const suggestions = buildOutfitSuggestions([
    item("t1", "upperbody"), item("t2", "upperbody"),
    item("b1", "lowerbody"), item("s1", "shoes"), item("a1", "accessories_up"),
  ]);
  assert.ok(suggestions.length > 0);
  for (const suggestion of suggestions) assert.ok(suggestion.items.length >= 2);
});

test("returns nothing when every piece is the same category", () => {
  const suggestions = buildOutfitSuggestions([item("t1", "upperbody"), item("t2", "upperbody")]);
  assert.deepEqual(suggestions, []);
});

test("caps suggestions at eight and keeps ids unique", () => {
  const wardrobe = [];
  for (let index = 0; index < 6; index += 1) {
    wardrobe.push(item(`t${index}`, "upperbody"));
    wardrobe.push(item(`b${index}`, "lowerbody"));
    wardrobe.push(item(`s${index}`, "shoes"));
  }
  const suggestions = buildOutfitSuggestions(wardrobe);
  assert.ok(suggestions.length <= 8);
  const keys = suggestions.map((suggestion) => suggestion.items.map((piece) => piece.id).sort().join(":"));
  assert.equal(new Set(keys).size, keys.length);
});

test("falls back to cross-category pairs when there is no top+bottom", () => {
  const suggestions = buildOutfitSuggestions([item("j1", "wholebody_up"), item("s1", "shoes")]);
  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0].items.map((piece) => piece.id).sort(), ["j1", "s1"]);
});
