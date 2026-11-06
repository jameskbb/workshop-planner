/**
 * Create / edit a custom object with the full metadata of the brief: name, category, W/D/H, weight,
 * mobile/static, wall/floor/ceiling mounting, notes, electrical requirement, dust port, working
 * clearances, hazard tags, image and color. Saved to the cross-project "My objects" library; when
 * the object is used in the open project its placed copies can be updated too.
 */
import { ImagePlus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { saveCustomDefinition, useCustomLibrary } from '@/app/services';
import { LengthInput } from '@/components/LengthInput';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, Switch, Textarea } from '@/components/ui';
import type { AppCommand } from '@/domain/commands';
import { findDefinition, getScenario } from '@/domain/resolve';
import { OBJECT_CATEGORIES, ObjectDefinitionSchema, type ClearanceZone, type Hazards, type ObjectCategory, type ObjectDefinition, type PlacedObject } from '@/domain/schema';
import { inches, lb } from '@/domain/units';
import { useFormatters } from '@/hooks/useFormatters';
import { transact, useProjectStore } from '@/stores/projectStore';
import { editorActions } from '@/stores/editorStore';
import { uiActions } from '@/stores/uiStore';
import { categoryColors } from '@/styles/tokens';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import { ZoneListEditor } from '@/features/clearances/ZoneListEditor';
import { addObjectFromDefinition } from '@/features/objects/register';

export const CATEGORY_LABEL: Record<ObjectCategory, string> = {
  'work-surface': 'Work surface',
  'stationary-tool': 'Stationary tool',
  storage: 'Storage',
  misc: 'Miscellaneous',
  'dust-collection': 'Dust collection',
};

type PortSide = 'none' | 'back' | 'front' | 'left' | 'right' | 'top';

interface Draft {
  id: string;
  name: string;
  category: ObjectCategory;
  width: number;
  depth: number;
  height: number;
  weightText: string;
  /** Weight is typed in kg (metric projects) instead of lb. */
  kgUnits: boolean;
  mobile: boolean;
  mount: 'floor' | 'wall' | 'ceiling';
  elevation: number;
  notes: string;
  voltage: 'none' | '120' | '240';
  amperage: number;
  dedicated: boolean;
  portSide: PortSide;
  portDiameter: number;
  clearances: ClearanceZone[];
  hazards: Hazards;
  image?: string;
  color?: string;
  base?: ObjectDefinition;
}

function portSideOf(def: ObjectDefinition): PortSide {
  const p = def.dustPort;
  if (!p) return 'none';
  if (Math.abs(p.x) < 1 && Math.abs(p.y) < 1) return 'top';
  if (Math.abs(p.y) >= Math.abs(p.x)) return p.y < 0 ? 'back' : 'front';
  return p.x < 0 ? 'left' : 'right';
}

function draftFrom(def: ObjectDefinition | undefined, placed: PlacedObject | undefined, kgUnits: boolean): Draft {
  const weightKg = placed?.weightKg ?? def?.weightKg;
  const el = placed?.electrical ?? def?.electrical;
  return {
    id: def?.source === 'custom' && !placed ? def.id : `custom:${newId()}`,
    name: placed ? (placed.label ?? placed.name) : (def?.name ?? 'My object'),
    category: def?.category ?? 'storage',
    width: placed?.width ?? def?.width ?? inches(48),
    depth: placed?.depth ?? def?.depth ?? inches(24),
    height: placed?.height ?? def?.height ?? inches(36),
    weightText: weightKg !== undefined ? String(kgUnits ? Math.round(weightKg * 10) / 10 : Math.round(weightKg / 0.45359237)) : '',
    kgUnits,
    mobile: (placed?.mobility ?? def?.mobility) === 'mobile',
    mount: placed?.mount ?? def?.mount ?? 'floor',
    elevation: placed?.elevation ?? def?.defaultElevation ?? 0,
    notes: (placed?.notes || def?.notes) ?? '',
    voltage: el ? (String(el.voltage) as '120' | '240') : 'none',
    amperage: el?.amperage ?? 15,
    dedicated: el?.dedicated ?? false,
    portSide: def ? portSideOf(def) : 'none',
    portDiameter: def?.dustPort?.diameter ?? inches(4),
    clearances: structuredClone(placed?.clearances ?? def?.clearances ?? []),
    hazards: { hot: false, finishing: false, flammable: false, sparks: false, ...(def?.hazards ?? {}) },
    image: def?.image,
    color: placed?.color ?? def?.color,
    base: def,
  };
}

function portPosition(side: PortSide, w: number, d: number): { x: number; y: number } {
  switch (side) {
    case 'back':
      return { x: 0, y: -d / 2 };
    case 'front':
      return { x: 0, y: d / 2 };
    case 'left':
      return { x: -w / 2, y: 0 };
    case 'right':
      return { x: w / 2, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

export function draftToDefinition(d: Draft): ObjectDefinition {
  const pounds = Number(d.weightText);
  return ObjectDefinitionSchema.parse({
    ...(d.base && d.base.source === 'custom' ? { states: d.base.states, defaultStateId: d.base.defaultStateId, components: d.base.components, tags: d.base.tags, subcategory: d.base.subcategory } : {}),
    id: d.id,
    name: d.name.trim() || 'My object',
    category: d.category,
    width: d.width,
    depth: d.depth,
    height: d.height,
    ...(d.weightText.trim() && Number.isFinite(pounds) && pounds >= 0 ? { weightKg: d.kgUnits ? pounds : lb(pounds) } : {}),
    mobility: d.mobile ? 'mobile' : 'static',
    mount: d.mount,
    defaultElevation: d.mount === 'floor' ? 0 : d.elevation,
    ...(d.voltage !== 'none' ? { electrical: { voltage: Number(d.voltage) as 120 | 240, amperage: d.amperage, dedicated: d.dedicated } } : {}),
    ...(d.portSide !== 'none' ? { dustPort: { diameter: d.portDiameter, ...portPosition(d.portSide, d.width, d.depth) } } : {}),
    clearances: d.clearances,
    hazards: d.hazards,
    ...(d.image ? { image: d.image } : {}),
    ...(d.color ? { color: d.color } : {}),
    notes: d.notes,
    approximate: false,
    source: 'custom',
    layer: d.category === 'storage' ? 'storage' : d.category === 'dust-collection' ? 'dust' : d.category === 'misc' ? 'general' : 'woodworking',
    updatedAt: nowIso(),
  });
}

/** Downscale an uploaded image to ≤ 256 px and return a data URL (kept small inside the library). */
async function imageToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image this browser can read.'));
      i.src = url;
    });
    const s = Math.min(1, 256 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Field({ label, children, htmlFor, className }: { label: string; children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="text-2xs text-ink-muted">
        {label}
      </Label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export function CustomObjectDialog({ definitionId, fromObjectId }: { definitionId?: string; fromObjectId?: string }) {
  const project = useProjectStore((s) => s.project);
  const library = useCustomLibrary((s) => s.definitions);
  const fmt = useFormatters();
  const initial = useMemo(() => {
    const placed = fromObjectId && project ? getScenario(project).objects.find((o) => o.id === fromObjectId) : undefined;
    const def = definitionId ? library.find((d) => d.id === definitionId) : placed && project ? findDefinition(project, placed.definitionId) : undefined;
    return draftFrom(def, placed, fmt.system === 'metric');
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [updatePlaced, setUpdatePlaced] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = !!definitionId;
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const placedCopies = useMemo(() => (project && editing ? project.scenarios.flatMap((s) => s.objects.filter((o) => o.definitionId === definitionId).map((o) => ({ s: s.id, o }))) : []), [project, editing, definitionId]);

  const save = async (addToPlan: boolean) => {
    let def: ObjectDefinition;
    try {
      def = draftToDefinition(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Some values are invalid.');
      return;
    }
    await saveCustomDefinition(def);
    if (project && editing && placedCopies.length && updatePlaced) {
      const cmds: AppCommand[] = [{ type: 'definition.upsert', payload: { definition: def } }];
      for (const { s, o } of placedCopies) {
        cmds.push({
          type: 'object.update',
          payload: { scenarioId: s, id: o.id, patch: { width: def.width, depth: def.depth, height: def.height, mobility: def.mobility, mount: def.mount, ...(def.mount !== 'floor' ? {} : { elevation: 0 }) } },
        });
      }
      const r = transact(`Update ${def.name}`, cmds);
      if (!r.ok) uiActions.flash(r.error, 'error');
    } else if (project && project.definitions.some((x) => x.id === def.id)) {
      transact(`Update ${def.name}`, [{ type: 'definition.upsert', payload: { definition: def } }]);
    }
    editorActions.closeDialog();
    uiActions.flash(`${editing ? 'Updated' : 'Saved'} “${def.name}” in My objects, available in every project.`);
    if (addToPlan) addObjectFromDefinition(def);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      set({ image: await imageToDataUrl(f) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.');
    }
  };

  const hazard = (k: keyof Hazards, label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
      <input type="checkbox" checked={d.hazards[k]} onChange={(e) => set({ hazards: { ...d.hazards, [k]: e.target.checked } })} /> {label}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && editorActions.closeDialog()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="custom-object-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Edit “${initial.name}”` : 'New custom object'}</DialogTitle>
            <DialogDescription>Your own measured item. It is saved to My objects and can be used in any project.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 py-3">
            <div className="space-y-2">
              <Field label="Name" htmlFor="co-name">
                <Input id="co-name" value={d.name} onChange={(e) => set({ name: e.target.value })} data-testid="co-name" autoFocus />
              </Field>
              <Field label="Category">
                <Select ariaLabel="Category" value={d.category} onValueChange={(v) => set({ category: v as ObjectCategory })} options={OBJECT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Width">
                  <LengthInput aria-label="Width" value={d.width} allowZero={false} onCommit={(width) => set({ width })} data-testid="co-width" />
                </Field>
                <Field label="Depth">
                  <LengthInput aria-label="Depth" value={d.depth} allowZero={false} onCommit={(depth) => set({ depth })} data-testid="co-depth" />
                </Field>
                <Field label="Height">
                  <LengthInput aria-label="Height" value={d.height} allowZero={false} onCommit={(height) => set({ height })} data-testid="co-height" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={d.kgUnits ? 'Weight (kg)' : 'Weight (lb)'} htmlFor="co-weight">
                  <Input id="co-weight" className="num" inputMode="decimal" value={d.weightText} onChange={(e) => set({ weightText: e.target.value })} placeholder="e.g. 350" data-testid="co-weight" />
                </Field>
                <Field label="Mobility">
                  <label className="flex h-7 items-center gap-2 text-xs text-ink">
                    <Switch checked={d.mobile} onCheckedChange={(mobile) => set({ mobile })} aria-label="Mobile (on wheels)" data-testid="co-mobile" /> {d.mobile ? 'Mobile (on wheels)' : 'Static'}
                  </label>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Mounting">
                  <Select ariaLabel="Mounting" value={d.mount} onValueChange={(v) => set({ mount: v as Draft['mount'], ...(v !== 'floor' && d.elevation === 0 ? { elevation: inches(54) } : {}) })} options={[{ value: 'floor', label: 'Floor standing' }, { value: 'wall', label: 'Wall mounted' }, { value: 'ceiling', label: 'Ceiling hung' }]} />
                </Field>
                {d.mount !== 'floor' && (
                  <Field label="Bottom height">
                    <LengthInput aria-label="Mounting height of the bottom" value={d.elevation} onCommit={(elevation) => set({ elevation })} />
                  </Field>
                )}
              </div>
              <Field label="Electrical requirement">
                <div className="grid grid-cols-3 gap-2">
                  <Select ariaLabel="Voltage" value={d.voltage} onValueChange={(v) => set({ voltage: v as Draft['voltage'] })} options={[{ value: 'none', label: 'None' }, { value: '120', label: '120 V' }, { value: '240', label: '240 V' }]} />
                  {d.voltage !== 'none' && (
                    <>
                      <Select ariaLabel="Amperage" value={String(d.amperage)} onValueChange={(v) => set({ amperage: Number(v) })} options={[5, 10, 12, 15, 20, 30, 40, 50].map((a) => ({ value: String(a), label: `${a} A` }))} />
                      <label className="flex items-center gap-1 text-2xs text-ink-muted">
                        <input type="checkbox" checked={d.dedicated} onChange={(e) => set({ dedicated: e.target.checked })} /> Dedicated
                      </label>
                    </>
                  )}
                </div>
              </Field>
              <Field label="Dust collection port">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    ariaLabel="Dust port position"
                    value={d.portSide}
                    onValueChange={(v) => set({ portSide: v as PortSide })}
                    options={[
                      { value: 'none', label: 'No port' },
                      { value: 'back', label: 'Back' },
                      { value: 'front', label: 'Front' },
                      { value: 'left', label: 'Left side' },
                      { value: 'right', label: 'Right side' },
                      { value: 'top', label: 'Center / top' },
                    ]}
                  />
                  {d.portSide !== 'none' && <LengthInput aria-label="Dust port diameter" value={d.portDiameter} allowZero={false} onCommit={(portDiameter) => set({ portDiameter })} />}
                </div>
              </Field>
              <Field label="Tags for safety checks">
                <div className="grid grid-cols-2 gap-1">
                  {hazard('hot', 'Hot / open flame')}
                  {hazard('sparks', 'Throws sparks')}
                  {hazard('flammable', 'Flammable')}
                  {hazard('finishing', 'Finishing / solvents')}
                </div>
              </Field>
            </div>
            <div className="space-y-2">
              <Field label="Working clearances">
                <ZoneListEditor zones={d.clearances} onChange={(clearances) => set({ clearances })} testId="co-zones" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Color">
                  <div className="flex items-center gap-1">
                    <input type="color" aria-label="Custom color" value={d.color ?? categoryColors[d.category].fill} onChange={(e) => set({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
                    {d.color && (
                      <Button size="sm" variant="ghost" onClick={() => set({ color: undefined })}>
                        Default
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label="Image">
                  <div className="flex items-center gap-1">
                    {d.image ? <img src={d.image} alt="" className="size-10 rounded border border-line object-cover" /> : null}
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                      <ImagePlus /> {d.image ? 'Replace' : 'Upload'}
                    </Button>
                    {d.image && (
                      <Button size="icon-sm" variant="ghost" aria-label="Remove image" onClick={() => set({ image: undefined })}>
                        <X />
                      </Button>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="co-image" />
                  </div>
                </Field>
              </div>
              <Field label="Notes" htmlFor="co-notes">
                <Textarea id="co-notes" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Model, where it came from, quirks…" />
              </Field>
              {editing && placedCopies.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={updatePlaced} onChange={(e) => setUpdatePlaced(e.target.checked)} /> Also update the {placedCopies.length} placed cop{placedCopies.length === 1 ? 'y' : 'ies'} in this project
                </label>
              )}
            </div>
          </div>
          {error && <p className="pb-2 text-xs text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => editorActions.closeDialog()}>
              Cancel
            </Button>
            {!editing && project && (
              <Button variant="outline" onClick={() => void save(true)} data-testid="co-save-add">
                Save & add to plan
              </Button>
            )}
            <Button type="submit" variant="primary" data-testid="co-save">
              Save to My objects
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
