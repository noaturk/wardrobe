// Pure, JSX-free outfit suggestion logic so it can be unit tested with `node --test`.
// The Outfit Planner (outfit-planner.jsx) re-exports these to keep a single source of truth.

export const CATEGORY_LABELS = {
  upperbody: "top",
  wholebody_up: "jacket",
  lowerbody: "bottom",
  accessories_up: "accessory",
  shoes: "shoes",
};

export function rgb(hex = "") {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  return [1, 3, 5].map((offset) => Number.parseInt(match[1].slice(offset - 1, offset + 1), 16));
}

export function describePalette(items) {
  const colors = items.map((item) => rgb(item.color)).filter(Boolean);
  if (colors.length < 2) return "A practical mix built from different wardrobe categories.";
  const neutral = colors.filter((color) => Math.max(...color) - Math.min(...color) < 42).length;
  const distances = colors.slice(1).map((color, index) => Math.sqrt(color.reduce((sum, channel, channelIndex) => sum + ((channel - colors[index][channelIndex]) ** 2), 0)));
  const average = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  if (neutral === colors.length) return "A calm tonal combination with easy neutral balance.";
  if (average > 165) return "A stronger color contrast that keeps each piece visually distinct.";
  return "A balanced palette with enough contrast to feel intentional.";
}

export function suggestionName(items, index) {
  const hasJacket = items.some((item) => item.part === "wholebody_up");
  const hasAccessory = items.some((item) => item.part === "accessories_up");
  const names = hasJacket ? ["Layered balance", "Clean layers", "Structured mix"] : hasAccessory ? ["Finished details", "Accent look", "Everyday polish"] : ["Easy everyday", "Clean contrast", "Simple balance"];
  return names[index % names.length];
}

export function buildOutfitSuggestions(items) {
  const groups = items.reduce((result, item) => {
    (result[item.part] ||= []).push(item);
    return result;
  }, {});
  const tops = groups.upperbody || [];
  const bottoms = groups.lowerbody || [];
  const jackets = groups.wholebody_up || [];
  const shoes = groups.shoes || [];
  const accessories = groups.accessories_up || [];
  const combinations = [];
  const seen = new Set();
  const add = (parts) => {
    const unique = [...new Map(parts.filter(Boolean).map((item) => [item.id, item])).values()];
    if (unique.length < 2) return;
    const key = unique.map((item) => item.id).sort().join(":");
    if (seen.has(key)) return;
    seen.add(key);
    combinations.push(unique);
  };

  for (const [topIndex, top] of tops.entries()) {
    for (const [bottomIndex, bottom] of bottoms.entries()) {
      const offset = topIndex + bottomIndex;
      add([top, bottom, shoes[offset % Math.max(1, shoes.length)], accessories[offset % Math.max(1, accessories.length)]]);
      if (jackets.length) add([top, bottom, jackets[offset % jackets.length], shoes[(offset + 1) % Math.max(1, shoes.length)]]);
      if (combinations.length >= 8) break;
    }
    if (combinations.length >= 8) break;
  }

  if (!combinations.length) {
    for (let first = 0; first < items.length; first += 1) {
      for (let second = first + 1; second < items.length; second += 1) {
        if (items[first].part !== items[second].part) add([items[first], items[second]]);
        if (combinations.length >= 8) break;
      }
    }
  }

  return combinations.slice(0, 8).map((combination, index) => ({
    id: combination.map((item) => item.id).join("-"),
    name: suggestionName(combination, index),
    reason: describePalette(combination),
    items: combination,
  }));
}
