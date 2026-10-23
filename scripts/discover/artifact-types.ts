export type { CatalogArtifact, CatalogArtifactFile } from '../../shared/types/discover-artifact';
export const catalogCategories = [
 { slug: 'fashion-style', title: 'Fashion & Style', description: 'Expressive stores, considered collections and styles worth sharing.', color: '#e8e0f5' },
 { slug: 'beauty-self-care', title: 'Beauty & Self-care', description: 'Daily rituals, thoughtful ingredients and a little time for yourself.', color: '#f6e0d8' },
 { slug: 'food-drink', title: 'Food & Drink', description: 'Independent makers, remarkable flavors and stories around the table.', color: '#e8edcc' },
 { slug: 'home-living', title: 'Home & Living', description: 'Objects and spaces that make the everyday feel extraordinary.', color: '#e9e1d5' },
 { slug: 'art-digital', title: 'Art & Digital Goods', description: 'Original work, useful resources and creative possibilities.', color: '#d8e6fa' },
 { slug: 'learning-communities', title: 'Learning & Communities', description: 'Share what you know and bring curious people together.', color: '#ede0ef' },
 { slug: 'outdoors-movement', title: 'Outdoors & Movement', description: 'Ideas for moving more, heading out and finding your next adventure.', color: '#dce8de' },
 { slug: 'pets-everyday', title: 'Pets & Everyday Life', description: 'Good companions and small things that make life better.', color: '#f8e7bb' },
] as const;
