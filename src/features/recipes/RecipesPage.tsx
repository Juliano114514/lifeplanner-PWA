import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { compareRecipeRequests, materialKey, recipeDraftSchema, type Recipe, type RecipeDraft, type RecipeMaterial, type RecipeRequest } from '../../../shared/recipe';
import { enqueuePlanner, materializePlanner, type Account } from '../../data/store';
import { Modal, PageHeading, SectionHeading } from '../planner/PlannerUi';

const materialText = (value: RecipeMaterial) => value.amount ? `${value.name} · ${value.amount}` : value.name;
const toDraft = (recipe?: Recipe): RecipeDraft => recipe ? {
  id: recipe.id, name: recipe.name, ingredients: recipe.ingredients, seasonings: recipe.seasonings, steps: recipe.steps,
} : { id: crypto.randomUUID(), name: '', ingredients: [], seasonings: [], steps: [] };

function MaterialTags({ values, label, compact = false }: { values: RecipeMaterial[]; label: string; compact?: boolean }) {
  const measure = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(values.length);
  useLayoutEffect(() => {
    if (!compact || !measure.current) return;
    const element = measure.current;
    const update = () => {
      const width = element.clientWidth;
      if (!width) return;
      const children = Array.from(element.children) as HTMLElement[];
      const widths = children.slice(0, -1).map(child => child.getBoundingClientRect().width);
      const reserve = children.at(-1)?.getBoundingClientRect().width ?? 0;
      const fit = (withCounter: boolean) => {
        let row = 1, used = 0, count = 0;
        for (const size of widths) {
          const next = used ? used + 6 + size : size;
          if (next > width) { row++; used = 0; }
          if (row > 2 || (withCounter && row === 2 && (used ? used + 6 : 0) + size + 6 + reserve > width)) break;
          used = (used ? used + 6 : 0) + size; count++;
        }
        return count;
      };
      setLimit(fit(false) === values.length ? values.length : fit(true));
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); update();
    return () => observer.disconnect();
  }, [compact, values]);
  const shown = compact ? limit : values.length;
  return <div className="recipe-material-group"><span className="recipe-material-label">{label}</span>
    <div className="recipe-tag-area"><div className="recipe-tags">
      {values.slice(0, shown).map((value, index) => <span className="recipe-tag" key={index} title={materialText(value)}>{materialText(value)}</span>)}
      {shown < values.length && <span className="recipe-tag recipe-more">+{values.length - shown}</span>}
      {!values.length && <span className="muted">待补充</span>}
    </div>{compact && <div className="recipe-tags recipe-tags-measure" ref={measure} aria-hidden="true">
      {values.map((value, index) => <span className="recipe-tag" key={index}>{materialText(value)}</span>)}
      <span className="recipe-tag recipe-more">+{values.length}</span>
    </div>}</div>
  </div>;
}

function RecipeCard({ recipe, onOpen, avatars, action, completed = false }: {
  recipe: Recipe; onOpen: () => void; avatars?: ReactNode; action: ReactNode; completed?: boolean;
}) {
  return <article className={`recipe-card ${avatars ? 'recipe-request-card' : ''} ${completed ? 'recipe-eaten-card' : ''}`}>
    {avatars}<button type="button" className="recipe-card-content" onClick={onOpen} aria-label={`查看菜谱：${recipe.name}`}>
      <strong>{recipe.name}</strong><MaterialTags label="食材" values={recipe.ingredients} compact /><MaterialTags label="调味料" values={recipe.seasonings} compact />
    </button><div className="recipe-card-action">{action}</div>
  </article>;
}

export function RecipesPage({ account, sync, onEditing }: { account: Account; sync: () => void; onEditing: (value: boolean) => void }) {
  const [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'all' | 'requests'>('all');
  const [editor, setEditor] = useState<Recipe | 'new' | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const planner = materializePlanner(account);
  const userId = account.identity.user.id;
  const recipes = planner.recipes.filter(value => value.deletedAt === undefined);
  const recipesById = new Map(recipes.map(value => [value.id, value]));
  const pendingByRecipe = new Map(planner.recipeRequests.filter(value => value.completedAt === null).map(value => [value.recipeId, value]));
  const selected = recipes.find(value => value.id === selectedId);
  const blocked = busy || !!account.plannerConflict;
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = recipes.filter(recipe => {
    const names = [recipe.name, ...recipe.ingredients.map(value => value.name), ...recipe.seasonings.map(value => value.name)].map(value => value.toLocaleLowerCase());
    return words.every(word => names.some(name => name.includes(word)));
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const matchingIds = new Set(matches.map(value => value.id));
  const requests = planner.recipeRequests.filter(value => matchingIds.has(value.recipeId));
  const pendingRequests = requests.filter(value => value.completedAt === null).sort(compareRecipeRequests);
  const eatenRequests = requests.filter(value => value.completedAt !== null).sort(compareRecipeRequests);
  useEffect(() => { onEditing(editor !== null); return () => onEditing(false); }, [editor, onEditing]);
  function edit(recipe?: Recipe) { setEditorVersion(planner.version); setEditor(recipe ?? 'new'); }
  async function run(operation: Parameters<typeof enqueuePlanner>[1], expectedVersion?: number) {
    if (acting.current) throw new Error('正在保存，请稍候');
    acting.current = true; setBusy(true);
    try { await enqueuePlanner(account.identity.user.id, operation, expectedVersion); setError(''); sync(); }
    finally { acting.current = false; setBusy(false); }
  }
  function act(operation: Parameters<typeof enqueuePlanner>[1]) {
    if (blocked || acting.current) return;
    void run(operation).catch(reason => setError(reason instanceof Error ? reason.message : '操作失败'));
  }
  function requestCard(request: RecipeRequest) {
    const recipe = recipesById.get(request.recipeId);
    if (!recipe) return null;
    const eaten = request.completedAt !== null;
    const avatars = <div className="recipe-request-avatars" aria-label="想吃的人">{request.requesterIds.map(id => {
      const member = account.identity.members.find(value => value.id === id);
      const profile = id === userId ? account.profile ?? account.identity.user.profile : member?.profile;
      const name = profile?.name || member?.name || '成员';
      return <span key={id} className="avatar" title={`${name}想吃`} aria-label={`${name}想吃`}>{profile?.avatar ? <img src={profile.avatar} alt="" /> : name.slice(0, 1)}</span>;
    })}</div>;
    return <RecipeCard key={request.id} recipe={recipe} avatars={avatars} completed={eaten} onOpen={() => setSelectedId(recipe.id)} action={<>
      <label className="recipe-eaten-control"><input type="checkbox" className="task-checkbox" checked={eaten} disabled={blocked}
        aria-label={`${eaten ? '撤销吃到' : '吃到了'}：${recipe.name}`} onChange={event => act({ type: 'setRecipeEaten', requestId: request.id, eaten: event.target.checked })} /><span>吃到了</span></label>
      {!eaten && request.requesterIds.includes(userId) && <button type="button" className="text-button recipe-cancel-want" disabled={blocked} onClick={() => act({ type: 'cancelRecipeWant', requestId: request.id })}>取消想吃</button>}
    </>} />;
  }
  async function remove(recipe: Recipe) {
    if (blocked || !window.confirm(`删除菜谱「${recipe.name}」？相关想吃及已吃记录也会移除。删除后无法恢复，将同步到其他设备。`)) return;
    try { await run({ type: 'deleteRecipe', id: recipe.id }); setSelectedId(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败'); }
  }
  return <>
    <PageHeading title="菜谱" action={<button className="primary" disabled={blocked} onClick={() => edit()}>新增菜谱<span>＋</span></button>} />
    <div className="recipe-toolbar"><div className="segmented recipe-tabs" aria-label="菜谱视图">{([['all', '全部菜谱'], ['requests', '谁想吃']] as const).map(([value, label]) =>
      <button key={value} type="button" className={tab === value ? 'selected' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      <div className="recipe-search"><input type="search" aria-label="搜索菜谱" placeholder="搜索菜名、食材或调味料" value={query} onChange={event => setQuery(event.target.value)} />
        <button className="text-button" disabled={!query} onClick={() => setQuery('')}>清空</button></div></div>
    {error && <p className="notice error-text" role="alert">{error}</p>}
    {account.plannerPending.some(value => ['saveRecipe', 'deleteRecipe', 'recipePin', 'recipeStatus', 'archiveRecipe', 'wantRecipe', 'cancelRecipeWant', 'setRecipeEaten'].includes(value.command.operation.type)) && <p className="hint">菜谱有待同步的修改</p>}
    {tab === 'all' ? <><p className="hint" role="status">{words.length ? `找到 ${matches.length} 道菜` : `共 ${recipes.length} 道菜`}</p>
      <div className="recipe-grid">{matches.map(recipe => {
        const pending = pendingByRecipe.get(recipe.id), wanted = pending?.requesterIds.includes(userId);
        return <RecipeCard key={recipe.id} recipe={recipe} onOpen={() => setSelectedId(recipe.id)} action={
          <button type="button" className={`recipe-want-button ${wanted ? 'selected' : ''}`} disabled={blocked} aria-pressed={!!wanted}
            onClick={() => act(wanted && pending ? { type: 'cancelRecipeWant', requestId: pending.id }
              : { type: 'wantRecipe', recipeId: recipe.id, requestId: pending?.id ?? crypto.randomUUID() })}>{wanted ? <><span>已想吃</span><span className="recipe-want-cancel"> · 取消</span></> : '我想吃'}</button>} />;
      })}</div>
      {!matches.length && <p className="empty">{recipes.length ? '没有匹配的菜谱，换个关键词或清空搜索试试。' : '先记下菜名，再慢慢补全材料和做法。'}</p>}
    </> : <><p className="hint" role="status">待吃全部保留，吃到后保留最近 10 条。{words.length ? `当前匹配 ${requests.length} 条记录。` : ''}</p>
      <section className="recipe-request-section"><SectionHeading title="想吃" count={pendingRequests.length} /><div className="recipe-grid">{pendingRequests.map(requestCard)}</div>
        {!pendingRequests.length && <p className="empty">{words.length ? '没有匹配的待吃记录。' : '去全部菜谱点一下“我想吃”，一起安排下一顿。'}</p>}</section>
      <section className="recipe-request-section"><SectionHeading title="吃到了" count={eatenRequests.length} /><div className="recipe-grid">{eatenRequests.map(requestCard)}</div>
        {!eatenRequests.length && <p className="empty">{words.length ? '没有匹配的已吃记录。' : '吃到后打个勾，最近的记录会留在这里。'}</p>}</section>
    </>}
    {selectedId && !editor && <Modal title={selected?.name ?? '菜谱已删除'} wide onClose={() => setSelectedId(null)}>
      {selected ? <><div className="recipe-detail"><MaterialTags label="食材" values={selected.ingredients} /><MaterialTags label="调味料" values={selected.seasonings} />
        <section><h3>做法</h3>{selected.steps.length ? <ol className="recipe-steps">{selected.steps.map((step, index) => <li key={index}>{step}</li>)}</ol> : <p className="muted">待补充</p>}</section></div>
        <div className="editor-footer"><button className="danger-text" disabled={blocked} onClick={() => void remove(selected)}>删除</button>
          <button className="primary" disabled={blocked} onClick={() => edit(selected)}>编辑菜谱</button></div>
        {error && <p className="error-text" role="alert">{error}</p>}</> : <p>这道菜已被删除，请关闭后查看其他菜谱。</p>}
    </Modal>}
    {editor && <RecipeEditor key={editor === 'new' ? 'new' : editor.id} initial={editor === 'new' ? undefined : editor} recipes={recipes}
      blocked={blocked || (editor !== 'new' && !recipes.some(value => value.id === editor.id))} onClose={() => setEditor(null)}
      onSave={async draft => { await run({ type: 'saveRecipe', draft }, editorVersion); setEditor(null); setSelectedId(draft.id); }} />}
  </>;
}

function MaterialEditor({ label, values, suggestions, onChange }: { label: string; values: RecipeMaterial[]; suggestions: string[]; onChange: (values: RecipeMaterial[]) => void }) {
  const id = useId();
  function update(index: number, change: Partial<RecipeMaterial>) { onChange(values.map((value, position) => position === index ? { ...value, ...change } : value)); }
  return <fieldset className="recipe-material-editor"><legend>{label}</legend>
    <datalist id={id}>{suggestions.map(value => <option key={value} value={value} />)}</datalist>
    <div className="recipe-material-entries">{values.map((value, index) => <div className="recipe-material-entry" key={index}>
      <label>名称<input required maxLength={100} list={id} value={value.name} placeholder={label === '食材' ? '如：鸡蛋' : '如：盐'} onChange={event => update(index, { name: event.target.value })} /></label>
      <label>用量（可选）<input maxLength={100} value={value.amount} placeholder="如：2个 / 适量" onChange={event => update(index, { amount: event.target.value })} /></label>
      <button type="button" className="text-button danger-text" aria-label={`移除${label}：${value.name || `第${index + 1}项`}`} onClick={() => onChange(values.filter((_, position) => position !== index))}>移除</button>
    </div>)}</div>
    <button type="button" className="text-button" disabled={values.length >= 100} onClick={() => onChange([...values, { name: '', amount: '' }])}>＋ 添加{label}</button>
  </fieldset>;
}

function RecipeEditor({ initial, recipes, blocked, onClose, onSave }: { initial?: Recipe; recipes: Recipe[]; blocked: boolean; onClose: () => void; onSave: (draft: RecipeDraft) => Promise<void> }) {
  const [original] = useState(() => toDraft(initial));
  const [draft, setDraft] = useState(original), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const update = <K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const suggestions = (key: 'ingredients' | 'seasonings') => [...new Map(recipes.flatMap(recipe => recipe[key]).map(value => [materialKey(value.name), value.name])).values()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  function close() { if (!submitting.current && (!dirty || window.confirm('有未保存的菜谱修改，确认放弃？'))) onClose(); }
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  function moveStep(index: number, offset: number) {
    const steps = [...draft.steps];
    [steps[index], steps[index + offset]] = [steps[index + offset], steps[index]];
    update('steps', steps);
  }
  async function submit() {
    if (submitting.current || blocked) return;
    const parsed = recipeDraftSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查菜谱内容'); return; }
    submitting.current = true; setSaving(true); setError('');
    try { await onSave(parsed.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal title={initial ? '编辑菜谱' : '新增菜谱'} wide onClose={close}><form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className="recipe-editor-fields" disabled={saving || blocked}>
      <label>菜名<input autoFocus required maxLength={200} value={draft.name} onChange={event => update('name', event.target.value)} /></label>
      <MaterialEditor label="食材" values={draft.ingredients} suggestions={suggestions('ingredients')} onChange={values => update('ingredients', values)} />
      <MaterialEditor label="调味料" values={draft.seasonings} suggestions={suggestions('seasonings')} onChange={values => update('seasonings', values)} />
      <fieldset className="recipe-step-editor"><legend>做法</legend>{draft.steps.map((step, index) => <div className="recipe-step-entry" key={index}>
        <label>步骤 {index + 1}<textarea required rows={3} maxLength={10000} value={step} onChange={event => update('steps', draft.steps.map((value, position) => position === index ? event.target.value : value))} /></label>
        <div className="actions"><button type="button" disabled={index === 0} aria-label={`步骤${index + 1}上移`} onClick={() => moveStep(index, -1)}>上移</button>
          <button type="button" disabled={index === draft.steps.length - 1} aria-label={`步骤${index + 1}下移`} onClick={() => moveStep(index, 1)}>下移</button>
          <button type="button" className="danger-text" aria-label={`删除步骤${index + 1}`} onClick={() => update('steps', draft.steps.filter((_, position) => position !== index))}>删除步骤</button></div>
      </div>)}<button type="button" className="text-button" disabled={draft.steps.length >= 100} onClick={() => update('steps', [...draft.steps, ''])}>＋ 添加步骤</button></fieldset>
    </fieldset>
    {blocked && !saving && <p className="notice">暂时无法保存，请先处理同步冲突或确认菜谱是否已删除。填写的内容会保留在此窗口。</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="editor-footer"><button type="button" className="text-button" disabled={saving} onClick={close}>取消</button><button className="primary" disabled={saving || blocked}>{saving ? '保存中…' : '保存'}</button></div>
  </form></Modal>;
}
