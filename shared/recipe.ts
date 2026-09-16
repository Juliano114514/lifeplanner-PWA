import { z } from 'zod';
import type { Wish } from './wish';

export const materialKey = (name: string) => name.replace(/\s+/gu, '').toLocaleLowerCase();
const materialSchema = z.object({
  name: z.string().trim().min(1, '请输入材料名称').max(100),
  amount: z.string().trim().max(100),
}).strict();
const materialsSchema = z.array(materialSchema).max(100).refine(
  values => new Set(values.map(value => materialKey(value.name))).size === values.length,
  '同一组材料名称不能重复',
);
export const recipeDraftSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1, '请输入菜名').max(200),
  ingredients: materialsSchema, seasonings: materialsSchema,
  steps: z.array(z.string().trim().min(1, '请填写步骤或移除空步骤').max(10000)).max(100),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 60000, '菜谱内容过长，请精简后保存');
export type RecipeMaterial = z.infer<typeof materialSchema>;
export type RecipeDraft = z.infer<typeof recipeDraftSchema>;
export interface Recipe extends RecipeDraft {
  createdBy: string; updatedBy: string; createdAt: number; updatedAt: number; deletedAt?: number;
}
export interface RecipeRequest {
  id: string; recipeId: string; requesterIds: string[]; createdAt: number; completedAt: number | null;
}
export const compareRecipeRequests = (a: RecipeRequest, b: RecipeRequest) =>
  (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt) || a.id.localeCompare(b.id);

export function normalizeRecipeRequests(requests: RecipeRequest[], recipes: Recipe[]): RecipeRequest[] {
  const activeRecipeIds = new Set(recipes.filter(value => value.deletedAt === undefined).map(value => value.id));
  const visible = requests.filter(value => activeRecipeIds.has(value.recipeId) && value.requesterIds.length > 0);
  return [...visible.filter(value => value.completedAt === null),
    ...visible.filter(value => value.completedAt !== null).sort(compareRecipeRequests).slice(0, 10)];
}

// Older snapshots and mutation receipts still contain wish-shaped recipes.
// Pick fields explicitly so obsolete business data cannot return through replay.
export function normalizeRecipe(value: Recipe | Wish): Recipe {
  return {
    id: value.id, name: value.name,
    ingredients: 'ingredients' in value ? value.ingredients : [],
    seasonings: 'seasonings' in value ? value.seasonings : [],
    steps: 'steps' in value ? value.steps : [],
    createdBy: value.createdBy, updatedBy: value.updatedBy,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(value.deletedAt == null ? {} : { deletedAt: value.deletedAt }),
  };
}
