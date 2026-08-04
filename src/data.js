// ---- Style vocabulary ----------------------------------------------------

export const VIBES = ['Minimal', 'Chic', 'Street', 'Boho', 'Sporty', 'Classic']
export const OCCASIONS = ['Everyday', 'Work', 'Date Night', 'Weekend', 'Party', 'Travel']

// ---- Curated looks for the Discover feed ---------------------------------

export const LOOKS = [
  {
    id: 'look-monochrome-muse',
    name: 'Monochrome Muse',
    vibe: 'Minimal',
    occasion: 'Work',
    gradient: ['#232526', '#414345'],
    items: [
      { emoji: '🧥', label: 'Ivory longline coat' },
      { emoji: '👕', label: 'Fine-knit turtleneck' },
      { emoji: '👖', label: 'Tailored charcoal trousers' },
      { emoji: '👞', label: 'Leather loafers' },
    ],
    note: 'One palette, four textures. Let the tailoring do the talking.',
  },
  {
    id: 'look-golden-hour',
    name: 'Golden Hour',
    vibe: 'Boho',
    occasion: 'Weekend',
    gradient: ['#f7971e', '#ffd200'],
    items: [
      { emoji: '👗', label: 'Flowy midi dress' },
      { emoji: '🧢', label: 'Woven sun hat' },
      { emoji: '👡', label: 'Strappy sandals' },
      { emoji: '👜', label: 'Rattan tote' },
    ],
    note: 'Sunset tones and easy layers made for long afternoons.',
  },
  {
    id: 'look-city-static',
    name: 'City Static',
    vibe: 'Street',
    occasion: 'Everyday',
    gradient: ['#8e2de2', '#4a00e0'],
    items: [
      { emoji: '🧥', label: 'Oversized bomber' },
      { emoji: '👕', label: 'Graphic tee' },
      { emoji: '👖', label: 'Wide-leg cargos' },
      { emoji: '👟', label: 'Chunky sneakers' },
    ],
    note: 'Volume on volume — balance the silhouette with a crisp sneaker.',
  },
  {
    id: 'look-first-impression',
    name: 'First Impression',
    vibe: 'Chic',
    occasion: 'Date Night',
    gradient: ['#c31432', '#240b36'],
    items: [
      { emoji: '👗', label: 'Satin slip dress' },
      { emoji: '🧥', label: 'Cropped blazer' },
      { emoji: '👠', label: 'Kitten heels' },
      { emoji: '💎', label: 'Statement earrings' },
    ],
    note: 'Satin catches candlelight. Keep jewelry to one bold piece.',
  },
  {
    id: 'look-court-side',
    name: 'Court Side',
    vibe: 'Sporty',
    occasion: 'Weekend',
    gradient: ['#11998e', '#38ef7d'],
    items: [
      { emoji: '🧥', label: 'Retro track jacket' },
      { emoji: '👕', label: 'Ribbed tank' },
      { emoji: '🩳', label: 'Pleated tennis skirt' },
      { emoji: '👟', label: 'Court sneakers' },
    ],
    note: 'Sport heritage, styled off the court. White socks, always.',
  },
  {
    id: 'look-boardroom-soft',
    name: 'Boardroom, Softened',
    vibe: 'Classic',
    occasion: 'Work',
    gradient: ['#606c88', '#3f4c6b'],
    items: [
      { emoji: '🧥', label: 'Unstructured blazer' },
      { emoji: '👔', label: 'Poplin shirt' },
      { emoji: '👖', label: 'Pressed chinos' },
      { emoji: '👞', label: 'Suede derbies' },
    ],
    note: 'Classic pieces, relaxed fits. Authority without the armor.',
  },
  {
    id: 'look-neon-nights',
    name: 'Neon Nights',
    vibe: 'Street',
    occasion: 'Party',
    gradient: ['#fc466b', '#3f5efb'],
    items: [
      { emoji: '🧥', label: 'Iridescent windbreaker' },
      { emoji: '👕', label: 'Mesh top' },
      { emoji: '👖', label: 'Coated black denim' },
      { emoji: '👢', label: 'Platform boots' },
    ],
    note: 'Reflective fabrics love a dance floor. Wear the shine.',
  },
  {
    id: 'look-terminal-chic',
    name: 'Terminal Chic',
    vibe: 'Minimal',
    occasion: 'Travel',
    gradient: ['#bdc3c7', '#2c3e50'],
    items: [
      { emoji: '🧥', label: 'Knit cardigan' },
      { emoji: '👕', label: 'Boxy white tee' },
      { emoji: '👖', label: 'Relaxed jeans' },
      { emoji: '👟', label: 'Slip-on sneakers' },
      { emoji: '🕶️', label: 'Oval sunglasses' },
    ],
    note: 'Everything soft, nothing fussy. Airport floors to city streets.',
  },
  {
    id: 'look-garden-party',
    name: 'Garden Party',
    vibe: 'Boho',
    occasion: 'Party',
    gradient: ['#56ab2f', '#a8e063'],
    items: [
      { emoji: '👗', label: 'Floral wrap dress' },
      { emoji: '🧣', label: 'Silk hair scarf' },
      { emoji: '👡', label: 'Block-heel mules' },
      { emoji: '👜', label: 'Beaded mini bag' },
    ],
    note: 'Prints bloom outdoors. Pick one flower tone and echo it twice.',
  },
  {
    id: 'look-quiet-luxury',
    name: 'Quiet Luxury',
    vibe: 'Chic',
    occasion: 'Everyday',
    gradient: ['#d1913c', '#ffd194'],
    items: [
      { emoji: '🧥', label: 'Camel wrap coat' },
      { emoji: '👕', label: 'Cashmere crewneck' },
      { emoji: '👖', label: 'Cream straight-leg pants' },
      { emoji: '👜', label: 'Structured leather bag' },
    ],
    note: 'No logos, all texture. Camel and cream never argue.',
  },
  {
    id: 'look-morning-run',
    name: 'Morning Run Club',
    vibe: 'Sporty',
    occasion: 'Everyday',
    gradient: ['#00b4db', '#0083b0'],
    items: [
      { emoji: '👕', label: 'Technical half-zip' },
      { emoji: '🩳', label: 'Running shorts' },
      { emoji: '🧢', label: 'Performance cap' },
      { emoji: '👟', label: 'Cushioned trainers' },
    ],
    note: 'Fast fabrics in one cool tone — looks sharp at the café after.',
  },
  {
    id: 'look-heritage-check',
    name: 'Heritage Check',
    vibe: 'Classic',
    occasion: 'Date Night',
    gradient: ['#5d4157', '#a8caba'],
    items: [
      { emoji: '🧥', label: 'Checked wool overshirt' },
      { emoji: '👕', label: 'Merino polo' },
      { emoji: '👖', label: 'Dark selvedge denim' },
      { emoji: '👢', label: 'Chelsea boots' },
    ],
    note: 'A pattern with history, grounded by clean denim and boots.',
  },
]

// ---- Outfit builder catalog ----------------------------------------------

export const CATALOG = {
  top: [
    { id: 'top-1', emoji: '👕', name: 'Boxy White Tee', color: 'White', vibes: ['Minimal', 'Street', 'Sporty'] },
    { id: 'top-2', emoji: '👔', name: 'Crisp Poplin Shirt', color: 'Blue', vibes: ['Classic', 'Chic'] },
    { id: 'top-3', emoji: '🧶', name: 'Cashmere Crewneck', color: 'Cream', vibes: ['Chic', 'Minimal', 'Classic'] },
    { id: 'top-4', emoji: '👚', name: 'Silk Camisole', color: 'Champagne', vibes: ['Chic', 'Boho'] },
    { id: 'top-5', emoji: '🎽', name: 'Ribbed Tank', color: 'Black', vibes: ['Sporty', 'Street', 'Minimal'] },
    { id: 'top-6', emoji: '👕', name: 'Graphic Tee', color: 'Washed Black', vibes: ['Street'] },
    { id: 'top-7', emoji: '🧵', name: 'Crochet Top', color: 'Terracotta', vibes: ['Boho'] },
  ],
  bottom: [
    { id: 'bot-1', emoji: '👖', name: 'Relaxed Jeans', color: 'Mid Indigo', vibes: ['Minimal', 'Street', 'Classic'] },
    { id: 'bot-2', emoji: '👖', name: 'Tailored Trousers', color: 'Charcoal', vibes: ['Classic', 'Chic', 'Minimal'] },
    { id: 'bot-3', emoji: '🩳', name: 'Pleated Skirt', color: 'Ivory', vibes: ['Chic', 'Sporty'] },
    { id: 'bot-4', emoji: '👖', name: 'Wide-Leg Cargos', color: 'Olive', vibes: ['Street', 'Sporty'] },
    { id: 'bot-5', emoji: '👗', name: 'Flowy Maxi Skirt', color: 'Rust', vibes: ['Boho'] },
    { id: 'bot-6', emoji: '👖', name: 'Cream Straight-Legs', color: 'Cream', vibes: ['Chic', 'Minimal', 'Classic'] },
  ],
  shoes: [
    { id: 'sho-1', emoji: '👟', name: 'Clean White Sneakers', color: 'White', vibes: ['Minimal', 'Sporty', 'Street', 'Classic'] },
    { id: 'sho-2', emoji: '👞', name: 'Leather Loafers', color: 'Espresso', vibes: ['Classic', 'Chic', 'Minimal'] },
    { id: 'sho-3', emoji: '👠', name: 'Kitten Heels', color: 'Black', vibes: ['Chic'] },
    { id: 'sho-4', emoji: '👢', name: 'Chelsea Boots', color: 'Chestnut', vibes: ['Classic', 'Boho', 'Street'] },
    { id: 'sho-5', emoji: '👡', name: 'Strappy Sandals', color: 'Tan', vibes: ['Boho', 'Chic'] },
    { id: 'sho-6', emoji: '👟', name: 'Chunky Runners', color: 'Neon Mix', vibes: ['Street', 'Sporty'] },
  ],
  layer: [
    { id: 'lay-0', emoji: '🚫', name: 'No Layer', color: '—', vibes: VIBES },
    { id: 'lay-1', emoji: '🧥', name: 'Oversized Blazer', color: 'Stone', vibes: ['Chic', 'Classic', 'Minimal'] },
    { id: 'lay-2', emoji: '🧥', name: 'Denim Jacket', color: 'Light Wash', vibes: ['Street', 'Boho', 'Classic'] },
    { id: 'lay-3', emoji: '🧥', name: 'Camel Wrap Coat', color: 'Camel', vibes: ['Chic', 'Classic'] },
    { id: 'lay-4', emoji: '🧥', name: 'Retro Track Jacket', color: 'Green/White', vibes: ['Sporty', 'Street'] },
    { id: 'lay-5', emoji: '🧶', name: 'Chunky Cardigan', color: 'Oat', vibes: ['Boho', 'Minimal'] },
  ],
  accessory: [
    { id: 'acc-0', emoji: '🚫', name: 'Keep It Bare', color: '—', vibes: VIBES },
    { id: 'acc-1', emoji: '🕶️', name: 'Oval Sunglasses', color: 'Black', vibes: ['Minimal', 'Street', 'Chic'] },
    { id: 'acc-2', emoji: '👜', name: 'Structured Bag', color: 'Tan', vibes: ['Chic', 'Classic'] },
    { id: 'acc-3', emoji: '🧢', name: 'Six-Panel Cap', color: 'Navy', vibes: ['Sporty', 'Street'] },
    { id: 'acc-4', emoji: '🧣', name: 'Silk Scarf', color: 'Print', vibes: ['Boho', 'Chic', 'Classic'] },
    { id: 'acc-5', emoji: '💎', name: 'Statement Earrings', color: 'Gold', vibes: ['Chic', 'Boho'] },
    { id: 'acc-6', emoji: '⌚', name: 'Minimal Watch', color: 'Silver', vibes: ['Minimal', 'Classic'] },
  ],
}

export const SLOT_LABELS = { top: 'Top', bottom: 'Bottom', shoes: 'Shoes', layer: 'Layer', accessory: 'Accessory' }
export const SLOT_ORDER = ['layer', 'top', 'bottom', 'shoes', 'accessory']

// ---- Style quiz ----------------------------------------------------------

export const PERSONAS = {
  Minimal: {
    title: 'The Minimalist',
    emoji: '⬜',
    tagline: 'Fewer, better things.',
    description:
      'You build around a tight palette and impeccable fits. Your superpower is restraint — every piece earns its place, and your looks feel effortless because they are considered.',
    tips: ['Invest in fabric over logos', 'Master the tonal outfit', 'One silhouette statement per look'],
  },
  Chic: {
    title: 'The Modern Romantic',
    emoji: '🥂',
    tagline: 'Polished, with a pulse.',
    description:
      'You love elevated pieces that catch the light — silk, satin, structured tailoring. You dress like every day might turn into an occasion, and somehow it often does.',
    tips: ['Mix one luxe texture into daywear', 'Keep jewelry deliberate', 'A great coat is your best accessory'],
  },
  Street: {
    title: 'The Trendsetter',
    emoji: '🛹',
    tagline: 'The street is the runway.',
    description:
      'You play with proportion, graphics, and attitude. Your looks are conversations — bold sneakers, oversized layers, and details people notice twice.',
    tips: ['Balance oversized with fitted', 'Let sneakers anchor the palette', 'Confidence is the finishing layer'],
  },
  Boho: {
    title: 'The Free Spirit',
    emoji: '🌾',
    tagline: 'Dressed by the sun.',
    description:
      'Flowing fabrics, warm earth tones, and pieces with a story. You collect texture — crochet, rattan, silk scarves — and wear it like the weather is always golden hour.',
    tips: ['Layer natural textures', 'Echo one warm tone twice', 'Vintage is your secret weapon'],
  },
  Sporty: {
    title: 'The Athleisurist',
    emoji: '🎾',
    tagline: 'Built to move, styled to stay.',
    description:
      'Performance fabrics and clean lines follow you from the track to the café. You make technical wear look intentional — sharp, comfortable, and always ready.',
    tips: ['One tonal color story per look', 'Crisp white sneakers, always clean', 'Track jackets double as blazers'],
  },
  Classic: {
    title: 'The Timeless One',
    emoji: '🏛️',
    tagline: 'Trends visit. Style stays.',
    description:
      'Oxford shirts, good denim, honest leather. You dress in pieces that looked right thirty years ago and will look right in thirty more — quality is your aesthetic.',
    tips: ['Buy once, buy well', 'Fit is nine-tenths of style', 'Let patina tell your story'],
  },
}

export const QUIZ = [
  {
    question: 'It’s Saturday morning. What are you reaching for?',
    answers: [
      { text: 'A soft tee and my most perfect jeans', weights: { Minimal: 2, Classic: 1 } },
      { text: 'Track jacket — I’m out the door moving', weights: { Sporty: 2, Street: 1 } },
      { text: 'A flowy dress and my favorite scarf', weights: { Boho: 2, Chic: 1 } },
      { text: 'Something with a little shine, why not', weights: { Chic: 2, Street: 1 } },
    ],
  },
  {
    question: 'Your dream shopping destination?',
    answers: [
      { text: 'A quiet atelier with ten perfect pieces', weights: { Minimal: 2, Chic: 1 } },
      { text: 'A vintage market at golden hour', weights: { Boho: 2, Classic: 1 } },
      { text: 'A sneaker drop with a line around the block', weights: { Street: 2, Sporty: 1 } },
      { text: 'A heritage store that smells like leather', weights: { Classic: 2, Minimal: 1 } },
    ],
  },
  {
    question: 'Pick a color story.',
    answers: [
      { text: 'Black, white, and every grey between', weights: { Minimal: 2, Street: 1 } },
      { text: 'Camel, cream, and gold', weights: { Chic: 2, Classic: 1 } },
      { text: 'Rust, sage, and sun-faded denim', weights: { Boho: 2 } },
      { text: 'Court green, navy, and bright white', weights: { Sporty: 2, Classic: 1 } },
    ],
  },
  {
    question: 'The compliment you secretly love?',
    answers: [
      { text: '“You always look so put-together.”', weights: { Classic: 2, Chic: 1 } },
      { text: '“Where did you even FIND that?”', weights: { Boho: 2, Street: 1 } },
      { text: '“I could never pull that off.”', weights: { Street: 2, Chic: 1 } },
      { text: '“You make it look easy.”', weights: { Minimal: 2, Sporty: 1 } },
    ],
  },
  {
    question: 'Your ideal weekend plan?',
    answers: [
      { text: 'Gallery, espresso, long walk home', weights: { Minimal: 2, Chic: 1 } },
      { text: 'Morning run, farmers market, sunshine', weights: { Sporty: 2, Boho: 1 } },
      { text: 'Rooftop party till the lights come on', weights: { Street: 2, Chic: 1 } },
      { text: 'Picnic with people I love', weights: { Boho: 2, Classic: 1 } },
    ],
  },
]

// ---- Starter wardrobe -----------------------------------------------------

export const STARTER_WARDROBE = [
  { id: 'w-1', emoji: '👕', name: 'White Tee', category: 'Tops', color: 'White' },
  { id: 'w-2', emoji: '👖', name: 'Blue Jeans', category: 'Bottoms', color: 'Indigo' },
  { id: 'w-3', emoji: '👟', name: 'White Sneakers', category: 'Shoes', color: 'White' },
  { id: 'w-4', emoji: '🧥', name: 'Denim Jacket', category: 'Outerwear', color: 'Light Wash' },
]

export const WARDROBE_CATEGORIES = ['Tops', 'Bottoms', 'Shoes', 'Outerwear', 'Dresses', 'Accessories']
export const EMOJI_CHOICES = ['👕', '👔', '👚', '🎽', '🧶', '👖', '🩳', '👗', '🧥', '🧣', '🧤', '🧦', '👟', '👞', '👠', '👡', '👢', '🥾', '👜', '🎒', '🧢', '👒', '🕶️', '💎', '⌚', '🥻', '🩱']
