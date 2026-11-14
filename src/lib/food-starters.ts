// src/lib/food-starters.ts — A MENU TO START FROM, for food and drink (design canvas "Food setup"; lib/food-setup).
// Each kind of food business gets a short, common menu, with what goes into each item and the ingredients it uses, so
// the business sees from its first day what each item costs to make (its ingredients and packaging: not time, waste or
// rent). Ingredient costs are typical US prices for a container (a gallon of milk, a 5 lb bag of beans), kept marked as
// typical (typicalCost) until the business puts in what it pays. Menu items come with no price and off the menu: a price is only ever suggested (what keeps the
// item's cost at a usual share of its price), never offered to guests until the business sets one. Allergens are only
// "likely" (from the ingredients' usual contents): the business checks them against its own products and saves them.
// Pure (screens and the server).
import type { AllergenKey } from '@/lib/allergens';

export type FoodKind = 'cafe' | 'truck' | 'counter' | 'restaurant' | 'bar';
/** An ingredient as bought: one container (`container` says what it is) costs `cost`; it's measured in ml or g
 *  (`size` of them in a container) or counted (`uses` in a container, each called `useUnit`). */
export type StarterIngredient = { key: string; name: string; category: string; container: string; cost: number;
  how: 'size' | 'uses'; size?: number; unit?: 'ml' | 'g'; uses?: number; useUnit?: string; allergens?: AllergenKey[] };
/** A menu item: its section, the station that makes it, its course with table service (null: none set), how long it
 *  takes, the share of its price its cost usually is (`target`), and what goes into one [ingredient key, amount]. */
export type StarterItem = { key: string; name: string; section: string; station: string; course: number | null; makeSeconds: number; target: number; recipe: [string, number][] };

const sz = (key: string, name: string, category: string, container: string, cost: number, size: number, unit: 'ml' | 'g', allergens?: AllergenKey[]): StarterIngredient =>
  ({ key, name, category, container, cost, how: 'size', size, unit, ...(allergens ? { allergens } : {}) });
const ct = (key: string, name: string, category: string, container: string, cost: number, uses: number, useUnit: string, allergens?: AllergenKey[]): StarterIngredient =>
  ({ key, name, category, container, cost, how: 'uses', uses, useUnit, ...(allergens ? { allergens } : {}) });
// Breads usually carry soy as well; a bun or bagel often has sesame on it. Still only "likely": the business checks.
const BREAD: AllergenKey[] = ['wheat', 'gluten', 'soy'];

/** Every ingredient a starter menu uses, once (a café and a counter share the same milk). */
export const STARTER_INGREDIENTS: StarterIngredient[] = [
  sz('beans', 'Espresso beans', 'Coffee', '5 lb bag', 65, 2268, 'g'),
  sz('drip', 'Drip coffee beans', 'Coffee', '5 lb bag', 50, 2268, 'g'),
  sz('milk', 'Whole milk', 'Dairy', '1 gallon', 4.6, 3785, 'ml', ['milk']),
  sz('choc', 'Chocolate sauce', 'Syrups', '64 oz bottle', 14, 1893, 'ml', ['milk']),
  sz('vanilla', 'Vanilla syrup', 'Syrups', '750 ml bottle', 9, 750, 'ml'),
  sz('chai', 'Chai concentrate', 'Tea', '32 oz carton', 6.5, 946, 'ml'),
  ct('tea', 'Black tea bags', 'Tea', 'box of 100', 12, 100, 'bags'),
  ct('icedtea', 'Iced tea bags, gallon size', 'Tea', 'box of 24', 14, 24, 'bags'),
  ct('hotcup', 'Hot cups and lids, 12 oz', 'Packaging', '50 sets', 9, 50, 'each'),
  ct('coldcup', 'Cold cups, lids and straws, 16 oz', 'Packaging', '50 sets', 11, 50, 'each'),
  ct('box', 'Takeout boxes', 'Packaging', 'case of 250', 38, 250, 'each'),
  ct('croissant', 'Croissants, bake from frozen', 'Bakery', 'case of 48', 45, 48, 'each', [...BREAD, 'milk', 'eggs']),
  ct('bagel', 'Bagels', 'Bakery', 'dozen', 7, 12, 'each', [...BREAD, 'sesame']),
  ct('bread', 'Sourdough loaf', 'Bakery', 'loaf, 16 slices', 5.5, 16, 'slices', BREAD),
  ct('muffin', 'English muffins', 'Bakery', 'pack of 12', 4.5, 12, 'each', BREAD),
  ct('bun', 'Burger buns', 'Bakery', 'pack of 12', 5.5, 12, 'each', [...BREAD, 'sesame']),
  ct('cookie', 'Cookies, bake from frozen dough', 'Bakery', 'case of 120', 55, 120, 'each', [...BREAD, 'milk', 'eggs']),
  ct('cake', 'Chocolate cake, bought in', 'Bakery', 'cake, 14 slices', 34, 14, 'slices', [...BREAD, 'milk', 'eggs']),
  sz('creamcheese', 'Cream cheese', 'Dairy', '3 lb tub', 11, 1361, 'g', ['milk']),
  sz('butter', 'Butter', 'Dairy', '1 lb', 5, 454, 'g', ['milk']),
  ct('cheddar', 'Cheddar slices', 'Dairy', '160 slices', 26, 160, 'slices', ['milk']),
  ct('american', 'American cheese slices', 'Dairy', '120 slices', 22, 120, 'slices', ['milk']),
  sz('parmesan', 'Parmesan', 'Dairy', '5 lb wedge', 48, 2268, 'g', ['milk']),
  ct('eggs', 'Eggs', 'Dairy', '15 dozen case', 48, 180, 'each', ['eggs']),
  ct('avocado', 'Avocados', 'Produce', 'case of 48', 58, 48, 'each'),
  sz('lettuce', 'Romaine lettuce', 'Produce', 'case, about 30 lb', 42, 13608, 'g'),
  sz('greens', 'Mixed greens', 'Produce', '3 lb bag', 13, 1361, 'g'),
  sz('tomato', 'Tomatoes', 'Produce', '25 lb case', 38, 11340, 'g'),
  sz('onion', 'Onions', 'Produce', '50 lb sack', 32, 22680, 'g'),
  sz('potatoes', 'Potatoes', 'Produce', '50 lb sack', 28, 22680, 'g'),
  ct('lemons', 'Lemons', 'Produce', 'case of 115', 42, 115, 'each'),
  ct('limes', 'Limes', 'Produce', 'case of 200', 38, 200, 'each'),
  sz('bacon', 'Bacon', 'Meat', '15 lb case', 85, 6804, 'g'),
  sz('beef', 'Ground beef, 80/20', 'Meat', '10 lb', 58, 4536, 'g'),
  sz('chicken', 'Chicken breast', 'Meat', '40 lb case', 120, 18144, 'g'),
  ct('wholechicken', 'Whole chickens', 'Meat', 'case of 12', 62, 24, 'halves'),
  sz('steak', 'Sirloin steak', 'Meat', '10 lb', 95, 4536, 'g'),
  sz('wings', 'Chicken wings', 'Meat', '40 lb case', 130, 18144, 'g'),
  sz('salmon', 'Salmon fillets', 'Seafood', '10 lb', 115, 4536, 'g', ['fish']),
  sz('fries', 'Fries, frozen', 'Frozen', '6 bags of 5 lb', 48, 13608, 'g'),
  sz('oil', 'Fryer oil', 'Pantry', '35 lb jug', 48, 15876, 'g'),
  sz('mayo', 'Mayonnaise', 'Pantry', '1 gallon', 16, 3500, 'g', ['eggs']),
  sz('sugar', 'Sugar', 'Pantry', '25 lb bag', 16, 11340, 'g'),
  sz('rice', 'Rice', 'Pantry', '25 lb bag', 24, 11340, 'g'),
  sz('blackbeans', 'Black beans, canned', 'Pantry', 'large can', 6.5, 3000, 'g'),
  sz('salsa', 'Salsa', 'Pantry', '1 gallon', 14, 3785, 'ml'),
  sz('oliveoil', 'Olive oil', 'Pantry', '3 liter tin', 32, 3000, 'ml'),
  sz('vinegar', 'Red wine vinegar', 'Pantry', '1 gallon', 9, 3785, 'ml'),
  sz('pasta', 'Spaghetti', 'Pantry', '20 lb case', 26, 9072, 'g', ['wheat', 'gluten']),
  sz('crushedtom', 'Crushed tomatoes', 'Pantry', 'large can', 6, 2835, 'g'),
  sz('wingsauce', 'Wing sauce', 'Pantry', '1 gallon', 18, 3785, 'ml', ['milk']),
  ct('soda', 'Soda, cans', 'Drinks', 'case of 24', 11, 24, 'cans'),
  ct('water', 'Bottled water', 'Drinks', 'case of 24', 6, 24, 'bottles'),
  sz('wine', 'House wine', 'Wine', '750 ml bottle', 9, 750, 'ml'),
  sz('beer', 'Draft beer', 'Beer', 'half-barrel keg', 185, 58674, 'ml', ['gluten']),
  sz('tequila', 'Tequila', 'Spirits', '1 liter', 26, 1000, 'ml'),
  sz('orangeliq', 'Orange liqueur', 'Spirits', '1 liter', 14, 1000, 'ml'),
  sz('bourbon', 'Bourbon', 'Spirits', '1 liter', 30, 1000, 'ml'),
  sz('gin', 'Gin', 'Spirits', '1 liter', 25, 1000, 'ml'),
  sz('limejuice', 'Lime juice', 'Mixers', '1 liter', 8, 1000, 'ml'),
  sz('syrup', 'Simple syrup', 'Mixers', '1 liter', 7, 1000, 'ml'),
  sz('bitters', 'Aromatic bitters', 'Mixers', '16 oz bottle', 26, 473, 'ml'),
  ct('tonic', 'Tonic water, cans', 'Mixers', 'case of 24', 15, 24, 'cans'),
];
export const INGREDIENT_BY_KEY = new Map(STARTER_INGREDIENTS.map((i) => [i.key, i]));

const it = (key: string, name: string, section: string, station: string, course: number | null, makeSeconds: number, target: number, recipe: [string, number][]): StarterItem =>
  ({ key, name, section, station, course, makeSeconds, target, recipe });
// Things several kinds of business sell the same way.
const CHEESEBURGER = (station: string, boxed: boolean) => it('cheeseburger', 'Cheeseburger', 'Mains', station, 3, 420, 0.3,
  [['beef', 113], ['bun', 1], ['american', 1], ['lettuce', 15], ['tomato', 25], ['onion', 10], ['mayo', 15], ...(boxed ? [['box', 1] as [string, number]] : [])]);
const CHICKEN_SANDWICH = (station: string, boxed: boolean) => it('chickensandwich', 'Chicken sandwich', 'Mains', station, 3, 480, 0.3,
  [['chicken', 170], ['bun', 1], ['lettuce', 15], ['tomato', 25], ['mayo', 15], ['oil', 15], ...(boxed ? [['box', 1] as [string, number]] : [])]);
const FRIES = (station: string, boxed: boolean, course: number | null) => it('fries', 'Fries', boxed ? 'Sides' : 'Starters', station, course, 240, 0.25,
  [['fries', 150], ['oil', 15], ...(boxed ? [['box', 1] as [string, number]] : [])]);
const SODA = (station: string, course: number | null) => it('soda', 'Soda', 'Drinks', station, course, 20, 0.3, [['soda', 1]]);
const LEMONADE = (station: string) => it('lemonade', 'Lemonade', 'Drinks', station, 1, 90, 0.2, [['lemons', 1.5], ['sugar', 30], ['coldcup', 1]]);
const WINE = it('housewine', 'House wine, glass', 'Wine', 'Bar', 1, 30, 0.3, [['wine', 150]]);
const BEER = it('draftbeer', 'Draft beer, pint', 'Beer', 'Bar', 1, 30, 0.25, [['beer', 473]]);

/** The starter menu for each kind of food business. */
export const FOOD_STARTERS: Record<FoodKind, StarterItem[]> = {
  cafe: [
    it('espresso', 'Espresso', 'Coffee', 'Bar', null, 60, 0.2, [['beans', 18], ['hotcup', 1]]),
    it('americano', 'Americano', 'Coffee', 'Bar', null, 75, 0.2, [['beans', 18], ['hotcup', 1]]),
    it('latte', 'Latte', 'Coffee', 'Bar', null, 120, 0.2, [['beans', 18], ['milk', 240], ['hotcup', 1]]),
    it('cappuccino', 'Cappuccino', 'Coffee', 'Bar', null, 120, 0.2, [['beans', 18], ['milk', 150], ['hotcup', 1]]),
    it('vanillalatte', 'Vanilla latte', 'Coffee', 'Bar', null, 130, 0.25, [['beans', 18], ['milk', 240], ['vanilla', 30], ['hotcup', 1]]),
    it('mocha', 'Mocha', 'Coffee', 'Bar', null, 140, 0.22, [['beans', 18], ['milk', 210], ['choc', 30], ['hotcup', 1]]),
    it('icedlatte', 'Iced latte', 'Coffee', 'Bar', null, 110, 0.22, [['beans', 18], ['milk', 240], ['coldcup', 1]]),
    it('drip', 'Drip coffee', 'Coffee', 'Bar', null, 30, 0.22, [['drip', 20], ['hotcup', 1]]),
    it('chai', 'Chai latte', 'Tea and more', 'Bar', null, 110, 0.3, [['chai', 180], ['milk', 120], ['hotcup', 1]]),
    it('tea', 'Hot tea', 'Tea and more', 'Bar', null, 45, 0.12, [['tea', 1], ['hotcup', 1]]),
    it('croissant', 'Croissant', 'Bakery', 'Kitchen', null, 60, 0.3, [['croissant', 1]]),
    it('bagel', 'Bagel with cream cheese', 'Bakery', 'Kitchen', null, 150, 0.3, [['bagel', 1], ['creamcheese', 40]]),
    it('avotoast', 'Avocado toast', 'Breakfast', 'Kitchen', null, 240, 0.3, [['bread', 2], ['avocado', 0.5], ['butter', 5]]),
    it('breakfastsandwich', 'Breakfast sandwich', 'Breakfast', 'Kitchen', null, 300, 0.3, [['muffin', 1], ['eggs', 1], ['cheddar', 1], ['bacon', 30], ['butter', 5]]),
  ],
  truck: [
    CHEESEBURGER('Kitchen', true), CHICKEN_SANDWICH('Kitchen', true), FRIES('Kitchen', true, 2),
    it('loadedfries', 'Loaded fries', 'Sides', 'Kitchen', 2, 300, 0.28, [['fries', 200], ['oil', 20], ['american', 2], ['bacon', 20], ['box', 1]]),
    LEMONADE('Kitchen'), SODA('Kitchen', 1),
    it('water', 'Bottled water', 'Drinks', 'Kitchen', 1, 15, 0.25, [['water', 1]]),
  ],
  counter: [
    CHEESEBURGER('Kitchen', true), CHICKEN_SANDWICH('Kitchen', true),
    it('grainbowl', 'Grain bowl', 'Mains', 'Kitchen', 3, 300, 0.3, [['rice', 75], ['chicken', 140], ['blackbeans', 80], ['salsa', 60], ['greens', 30], ['box', 1]]),
    it('sidesalad', 'Side salad', 'Sides', 'Kitchen', 2, 120, 0.3, [['greens', 60], ['tomato', 30], ['oliveoil', 15], ['vinegar', 5], ['box', 1]]),
    FRIES('Kitchen', true, 2),
    it('cookie', 'Cookie', 'Sweets', 'Drinks', 4, 30, 0.3, [['cookie', 1]]),
    it('icedtea', 'Iced tea', 'Drinks', 'Drinks', 1, 30, 0.15, [['icedtea', 0.125], ['coldcup', 1]]),
    LEMONADE('Drinks'), SODA('Drinks', 1),
  ],
  restaurant: [
    it('housesalad', 'House salad', 'Starters', 'Kitchen', 2, 240, 0.28, [['greens', 70], ['tomato', 30], ['oliveoil', 15], ['vinegar', 5], ['parmesan', 10]]),
    FRIES('Kitchen', false, 2),
    it('roastchicken', 'Roast half chicken', 'Mains', 'Kitchen', 3, 900, 0.3, [['wholechicken', 1], ['potatoes', 200], ['butter', 15], ['oliveoil', 10]]),
    it('steakfrites', 'Steak frites', 'Mains', 'Kitchen', 3, 840, 0.32, [['steak', 225], ['fries', 150], ['oil', 15], ['butter', 15], ['greens', 20]]),
    it('pomodoro', 'Spaghetti pomodoro', 'Mains', 'Kitchen', 3, 600, 0.25, [['pasta', 120], ['crushedtom', 150], ['oliveoil', 15], ['parmesan', 15], ['butter', 10]]),
    it('salmon', 'Grilled salmon', 'Mains', 'Kitchen', 3, 720, 0.32, [['salmon', 170], ['potatoes', 150], ['greens', 30], ['oliveoil', 10], ['butter', 10]]),
    it('cake', 'Chocolate cake', 'Desserts', 'Kitchen', 4, 120, 0.3, [['cake', 1]]),
    WINE, BEER, SODA('Bar', 1),
  ],
  bar: [
    it('margarita', 'Margarita', 'Cocktails', 'Bar', 1, 120, 0.2, [['tequila', 60], ['orangeliq', 30], ['limejuice', 30], ['syrup', 10], ['limes', 0.25]]),
    it('oldfashioned', 'Old fashioned', 'Cocktails', 'Bar', 1, 120, 0.2, [['bourbon', 60], ['bitters', 2], ['syrup', 7]]),
    it('gintonic', 'Gin and tonic', 'Cocktails', 'Bar', 1, 60, 0.2, [['gin', 45], ['tonic', 1], ['limes', 0.25]]),
    BEER, WINE, SODA('Bar', 1),
    it('wings', 'Wings', 'Snacks', 'Kitchen', 2, 720, 0.3, [['wings', 280], ['wingsauce', 45], ['oil', 20]]),
    FRIES('Kitchen', false, 2),
  ],
};

/** What one use of an ingredient costs: a ml or g of it, or one of what's counted. */
export const perUse = (i: StarterIngredient) => i.cost / ((i.how === 'size' ? i.size : i.uses) || 1);
/** What an ingredient is measured in, as Inventory counts it (lib/product-cost unitLabel). */
export const unitOf = (i: StarterIngredient) => (i.how === 'size' ? i.unit || 'g' : i.useUnit || 'each');
/** What one item costs to make from its starter recipe, to the cent. */
export function starterCost(item: StarterItem): number {
  let c = 0; for (const [k, q] of item.recipe) { const i = INGREDIENT_BY_KEY.get(k); if (i) c += perUse(i) * q; }
  return Math.round(c * 100) / 100;
}
/** The price that keeps an item's cost at `target` of it, up to the next quarter. */
export const suggestPrice = (cost: number, target: number) => (cost > 0 && target > 0 ? Math.ceil((cost / target) * 4 - 1e-9) / 4 : 0);
/** What an item likely contains, from its ingredients (to check against the business's own products). */
export function likelyAllergens(item: StarterItem): AllergenKey[] {
  const out = new Set<AllergenKey>();
  for (const [k] of item.recipe) for (const a of INGREDIENT_BY_KEY.get(k)?.allergens || []) out.add(a);
  return Array.from(out);
}
/** The ingredients a kind's menu uses, each once, in the order they're first used. */
export function ingredientsFor(kind: FoodKind): StarterIngredient[] {
  const seen = new Set<string>(); const out: StarterIngredient[] = [];
  for (const item of FOOD_STARTERS[kind] || []) for (const [k] of item.recipe) { const i = INGREDIENT_BY_KEY.get(k); if (i && !seen.has(k)) { seen.add(k); out.push(i); } }
  return out;
}
