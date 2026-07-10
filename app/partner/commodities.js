// commodities.js — curated US freight commodity list → default equipment.
// Used by the post-load wizard: datalist autocomplete + equipment suggestion.
// Equipment codes must match the wizard's Equipment options.
// This is a practical coverage list (not exhaustive); the keyword inference in
// app.js and free-text custom entry cover anything not listed here.

const _R = ['Ice cream', 'Frozen food', 'Frozen vegetables', 'Frozen fruit', 'Frozen meals', 'Frozen pizza', 'Frozen chicken', 'Frozen fish', 'Frozen meat', 'Fresh produce', 'Produce', 'Lettuce', 'Spinach', 'Kale', 'Broccoli', 'Cauliflower', 'Celery', 'Carrots', 'Fresh tomatoes', 'Potatoes', 'Onions', 'Bell peppers', 'Cucumbers', 'Mushrooms', 'Apples', 'Oranges', 'Bananas', 'Grapes', 'Strawberries', 'Blueberries', 'Raspberries', 'Blackberries', 'Mixed berries', 'Melons', 'Watermelon', 'Cantaloupe', 'Avocados', 'Lemons', 'Limes', 'Pineapples', 'Mangoes', 'Peaches', 'Cherries', 'Citrus fruit', 'Meat', 'Beef', 'Ground beef', 'Pork', 'Poultry', 'Chicken', 'Turkey', 'Bacon', 'Sausage', 'Deli meats', 'Hot dogs', 'Seafood', 'Fresh fish', 'Shrimp', 'Salmon', 'Lobster', 'Crab', 'Tuna', 'Dairy', 'Milk', 'Cheese', 'Butter', 'Yogurt', 'Heavy cream', 'Eggs', 'Ice', 'Fresh flowers', 'Cut flowers', 'Live plants', 'Potted plants', 'Nursery stock', 'Floral', 'Pharmaceuticals', 'Vaccines', 'Insulin', 'Blood products', 'Medical specimens', 'Fresh juice', 'Refrigerated beverages', 'Perishable food', 'Cold cuts', 'Prepared meals', 'Bagged salad', 'Fresh herbs'];

const _V = ['Packaged food', 'Canned goods', 'Canned vegetables', 'Canned soup', 'Cereal', 'Snacks', 'Chips', 'Cookies', 'Crackers', 'Candy', 'Chocolate (packaged)', 'Coffee', 'Tea', 'Bottled water', 'Soft drinks', 'Soda', 'Bottled juice', 'Beer', 'Wine', 'Liquor', 'Spirits', 'Paper products', 'Toilet paper', 'Paper towels', 'Printing paper', 'Copy paper', 'Office supplies', 'Books', 'Magazines', 'Newspapers', 'Electronics', 'Computers', 'Laptops', 'Televisions', 'Cell phones', 'Appliances', 'Washers', 'Dryers', 'Microwaves', 'Small appliances', 'Clothing', 'Apparel', 'Textiles', 'Fabric', 'Footwear', 'Shoes', 'Boxed furniture', 'Mattresses', 'Plastics', 'Plastic products', 'Plastic bottles', 'Household goods', 'Toys', 'Games', 'Sporting goods', 'Exercise equipment', 'Auto parts', 'Tires', 'Packaged batteries', 'Tools', 'Power tools', 'Hardware', 'Fasteners', 'Cleaning supplies', 'Detergent', 'Soap', 'Cosmetics', 'Health and beauty', 'Personal care', 'Diapers', 'Pet food', 'Pet supplies', 'Retail goods', 'Consumer goods', 'General merchandise', 'Packaging materials', 'Cardboard', 'Boxes', 'Flour', 'Sugar', 'Rice', 'Pasta', 'Dry beans', 'Grains', 'Bagged grain', 'Spices', 'Nuts', 'Cooking oil', 'Condiments', 'Baby food', 'Bottled beverages', 'Vitamins', 'Supplements', 'Medical supplies', 'PPE', 'Face masks', 'Tobacco', 'Cigarettes', 'Stationery', 'Carpet', 'Rugs', 'Bedding', 'Linens', 'Furniture parts', 'Electronics parts', 'Printed materials'];

const _F = ['Steel', 'Steel coils', 'Steel plates', 'Steel beams', 'Steel pipe', 'Structural steel', 'Rebar', 'Metal', 'Aluminum', 'Copper', 'Brass', 'Scrap metal', 'Sheet metal', 'Metal coils', 'Pipe', 'PVC pipe', 'Steel tubing', 'Tubing', 'Conduit', 'Lumber', 'Timber', 'Plywood', 'OSB board', 'Particle board', 'Drywall', 'Sheetrock', 'Building materials', 'Construction materials', 'Roofing', 'Shingles', 'Roofing materials', 'Metal roofing', 'Concrete', 'Cement', 'Bagged cement', 'Precast concrete', 'Concrete blocks', 'Concrete pipe', 'Bricks', 'Cinder blocks', 'Pavers', 'Masonry', 'Stone', 'Granite', 'Marble', 'Stone slabs', 'Landscaping stone', 'Ceramic tile', 'Plate glass', 'Windows', 'Doors', 'Insulation', 'Vinyl siding', 'Decking', 'Fencing', 'Fence panels', 'Guardrail', 'Utility poles', 'Telephone poles', 'Wire coils', 'Cable reels', 'Wire mesh', 'Machinery', 'Industrial machinery', 'Generators', 'Transformers', 'Commercial HVAC units', 'Storage tanks', 'Water tanks', 'Steel containers', 'Large crates', 'Scaffolding', 'Roof trusses', 'I-beams', 'Girders', 'Bulk sand', 'Gravel', 'Aggregate', 'Asphalt', 'Sod', 'Landscaping materials', 'Boats', 'Modular homes', 'Empty trailers'];

const _S = ['Excavators', 'Bulldozers', 'Backhoes', 'Wheel loaders', 'Skid steers', 'Forklifts', 'Cranes', 'Boom lifts', 'Scissor lifts', 'Farm tractors', 'Combines', 'Harvesters', 'Agricultural machinery', 'Farm equipment', 'Construction equipment', 'Heavy equipment', 'Heavy machinery', 'Paving equipment', 'Road rollers', 'Compactors', 'CNC machines', 'Industrial equipment', 'Graders', 'Trenchers'];

const _B = ['Local delivery', 'Last mile freight', 'Final mile delivery', 'White glove delivery', 'Household moves'];

const _H = ['Gasoline', 'Diesel fuel', 'Propane', 'Fuel', 'Petroleum products', 'Paint', 'Industrial chemicals', 'Chemicals', 'Cleaning chemicals', 'Solvents', 'Corrosive materials', 'Acids', 'Lithium batteries', 'Car batteries', 'Fertilizer', 'Pesticides', 'Aerosols', 'Compressed gas', 'Flammable liquids', 'Ammunition', 'Fireworks'];

export const COMMODITIES = [].concat(
  _R.map(function (n) { return [n, 'Reefer']; }),
  _S.map(function (n) { return [n, 'Step Deck']; }),
  _F.map(function (n) { return [n, 'Flatbed']; }),
  _B.map(function (n) { return [n, 'Box Truck']; }),
  _V.map(function (n) { return [n, 'Dry Van']; }),
  _H.map(function (n) { return [n, 'Dry Van']; })
);

// exact -> starts-with -> includes ; returns { name, eq } or null
export function lookupCommodity(text) {
  var t = (text || '').toLowerCase().trim();
  if (t.length < 2) return null;
  var i, n;
  for (i = 0; i < COMMODITIES.length; i++) { if (COMMODITIES[i][0].toLowerCase() === t) return { name: COMMODITIES[i][0], eq: COMMODITIES[i][1] }; }
  for (i = 0; i < COMMODITIES.length; i++) { n = COMMODITIES[i][0].toLowerCase(); if (n.indexOf(t) === 0) return { name: COMMODITIES[i][0], eq: COMMODITIES[i][1] }; }
  for (i = 0; i < COMMODITIES.length; i++) { n = COMMODITIES[i][0].toLowerCase(); if (n.indexOf(t) >= 0 || t.indexOf(n) === 0) return { name: COMMODITIES[i][0], eq: COMMODITIES[i][1] }; }
  return null;
}

// top matching commodity names for the datalist (starts-with first, then includes)
export function suggestCommodities(text, limit) {
  var t = (text || '').toLowerCase().trim();
  var lim = limit || 15;
  if (!t) return [];
  var starts = [], incl = [], i, n;
  for (i = 0; i < COMMODITIES.length; i++) {
    n = COMMODITIES[i][0];
    var ln = n.toLowerCase();
    if (ln.indexOf(t) === 0) starts.push(n);
    else if (ln.indexOf(t) >= 0) incl.push(n);
  }
  return starts.concat(incl).slice(0, lim);
}
