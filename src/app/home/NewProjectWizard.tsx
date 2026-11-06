/**
 * New Project wizard: 1 name · 2 units · 3 room shape · 4 ceiling height · 5 garage doors ·
 * 6 permanent obstructions · 7 vehicle · 8 begin. "Start blank" skips it at any point.
 */
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { services } from '@/app/services';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Select } from '@/components/ui';
import { wallLetter } from '@/domain/roomEdit';
import { ROOM_TEMPLATES, templateDefaults } from '@/domain/roomTemplates';
import { feetInches } from '@/domain/units';
import { makeFormatters, type Formatters } from '@/hooks/useFormatters';
import { roomWalls, type Point } from '@/geometry';
import { cn } from '@/utils/cn';
import { OutlinePreview, TemplatePicker, WallLengthsEditor, buildFromRows, buildTemplate, type TemplateChoice, type WallRow } from '@/features/room/RoomShapeDialogs';
import { VEHICLE_TEMPLATES } from '@/features/objects/library';
import { OBSTRUCTIONS, addDefaultDoor, buildWizardProject, validateAnswers, type ObstructionId, type WizardDoor } from '@/features/projects/wizardBuild';

const STEPS = ['Name', 'Units', 'Room shape', 'Ceiling', 'Garage doors', 'Obstructions', 'Vehicle', 'Begin'] as const;

type ShapeMode = 'template' | 'lengths' | 'draw';

function LengthField({ label, value, onChange, fmt, testId }: { label: string; value: number; onChange(mm: number): void; fmt: Formatters; testId?: string }) {
  const [text, setText] = useState(fmt.length(value));
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  // A value changed from outside (a door re-spaced by "Add a garage door", "From wall start"
  // following a width edit) shows up unless the person is typing in this very field.
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setText(fmt.length(value));
    setErr(null);
  }, [value, fmt]);
  return (
    <div>
      <Label className="text-xs text-ink-muted">{label}</Label>
      <Input
        ref={ref}
        className={cn('num mt-1 h-8', err && 'border-danger')}
        value={text}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const r = fmt.parse(e.target.value, { allowZero: false });
          if (r.ok) {
            setErr(null);
            onChange(r.mm);
          } else setErr(r.error);
        }}
        onBlur={() => !err && setText(fmt.length(value))}
      />
      {err && <p className="mt-0.5 text-2xs text-danger">{err}</p>}
    </div>
  );
}

export function NewProjectWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange(o: boolean): void; onCreated(id: string): void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('My garage');
  const [units, setUnits] = useState<'imperial' | 'metric'>('imperial');
  const fmt = useMemo(() => makeFormatters({ unitSystem: units, imperialPrecision: 16, metricUnit: 'mm' }), [units]);
  const [shape, setShape] = useState<ShapeMode>('template');
  const [tpl, setTpl] = useState<TemplateChoice>(() => ({ id: 'two-car', params: templateDefaults(ROOM_TEMPLATES[3]!, 'imperial'), includeOpenings: true }));
  const [rows, setRows] = useState<WallRow[]>([
    { length: '', turn: '0' },
    { length: '', turn: '90' },
    { length: '', turn: '90' },
  ]);
  const [closeAuto, setCloseAuto] = useState(true);
  const [ceiling, setCeiling] = useState(feetInches(9, 0));
  const [thickness, setThickness] = useState(139.7);
  const [doors, setDoors] = useState<WizardDoor[] | null>(null);
  const [obstructions, setObstructions] = useState<ObstructionId[]>([]);
  const [vehicle, setVehicle] = useState<{ templateId: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const outline: { points: Point[]; error: string | null; templateDoors: WizardDoor[] } = useMemo(() => {
    if (shape === 'draw') return { points: [], error: null, templateDoors: [] };
    if (shape === 'template') {
      const b = buildTemplate(tpl);
      return { points: b.points, error: b.error, templateDoors: b.openings.map((o) => ({ wallIndex: o.wallIndex, offset: o.offset, width: o.width, height: feetInches(7, 0) })) };
    }
    const b = buildFromRows(rows, closeAuto, 90, fmt);
    return { points: b.points, error: b.error, templateDoors: [] };
  }, [shape, tpl, rows, closeAuto, fmt]);

  const effectiveDoors = doors ?? outline.templateDoors;
  const walls = outline.points.length >= 3 ? roomWalls(outline.points) : [];

  const reset = () => {
    setStep(0);
    setError(null);
    setDoors(null);
  };

  const create = async (blank: boolean) => {
    setError(null);
    const answers = blank
      ? { name: name.trim() || 'My garage', unitSystem: units, points: [], ceilingHeight: ceiling, wallThickness: thickness, doors: [], obstructions: [], vehicle: null }
      : { name, unitSystem: units, points: outline.points, ceilingHeight: ceiling, wallThickness: thickness, doors: outline.points.length ? effectiveDoors : [], obstructions: outline.points.length ? obstructions : [], vehicle };
    const problem = validateAnswers(answers);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const p = buildWizardProject(answers);
      await services.repo.saveProject(p);
      onOpenChange(false);
      reset();
      onCreated(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stepError = (): string | null => {
    if (step === 0 && !name.trim()) return 'Give the project a name.';
    if (step === 2 && shape !== 'draw' && outline.error) return outline.error;
    if (step === 3 && !(ceiling > 1000)) return 'The ceiling should be at least about 3′ (1 m) high.';
    if (step === 4) return validateAnswers({ name, unitSystem: units, points: outline.points, ceilingHeight: ceiling, wallThickness: thickness, doors: effectiveDoors, obstructions: [], vehicle: null });
    return null;
  };
  const next = () => {
    const e = stepError();
    if (e) return setError(e);
    setError(null);
    if (step === STEPS.length - 1) return void create(false);
    setStep((s) => s + 1);
  };

  const setDoor = (i: number, patch: Partial<WizardDoor>) => setDoors(effectiveDoors.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="w-[min(94vw,880px)] p-0" data-testid="new-project-wizard">
        <div className="grid min-h-[480px] grid-cols-[180px_1fr]">
          <nav className="border-r border-line bg-panel-2 p-3" aria-label="Setup steps">
            <DialogTitle className="mb-3 text-sm font-semibold text-ink">New project</DialogTitle>
            <ol className="space-y-0.5">
              {STEPS.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    disabled={i > step}
                    onClick={() => i < step && setStep(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs', i === step ? 'bg-select/20 text-ink' : i < step ? 'text-ink-muted hover:bg-panel-3' : 'text-ink-faint')}
                  >
                    <span className={cn('grid size-4 place-items-center rounded-full text-[10px]', i < step ? 'bg-ok/80 text-white' : i === step ? 'bg-select text-white' : 'border border-line')}>{i < step ? <Check className="size-2.5" /> : i + 1}</span>
                    {s}
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-2xs text-ink-faint">Everything can be changed later.</p>
          </nav>
          <form
            className="flex min-w-0 flex-col p-5"
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            <DialogDescription className="sr-only">Set up a new garage project step by step, or start blank.</DialogDescription>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {step === 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">What should we call this project?</h3>
                  <Input autoFocus className="h-9" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" data-testid="wizard-name" />
                  <p className="text-xs text-ink-muted">For example “Home Garage” or “Shop (after the move)”.</p>
                </div>
              )}
              {step === 1 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">Which units do you measure in?</h3>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Units">
                    {(['imperial', 'metric'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        role="radio"
                        aria-checked={units === u}
                        data-testid={`wizard-units-${u}`}
                        onClick={() => {
                          setUnits(u);
                          setTpl((t) => ({ ...t, params: templateDefaults(ROOM_TEMPLATES.find((x) => x.id === t.id)!, u) }));
                        }}
                        className={cn('rounded-md border p-3 text-left', units === u ? 'border-select bg-select/10' : 'border-line hover:bg-panel-2')}
                      >
                        <div className="text-sm text-ink">{u === 'imperial' ? 'Feet & inches' : 'Metric'}</div>
                        <div className="num text-xs text-ink-muted">{u === 'imperial' ? `21' 6", 48", 4.5 ft` : '6550 mm, 65.5 cm, 6.55 m'}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-muted">You can type any unit anywhere; this sets how measurements are shown.</p>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-ink">What shape is the garage?</h3>
                  <div className="flex gap-1" role="radiogroup" aria-label="How to create the room">
                    {(
                      [
                        ['template', 'Common shape'],
                        ['lengths', 'Type wall lengths'],
                        ['draw', "I'll draw it"],
                      ] as Array<[ShapeMode, string]>
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={shape === m}
                        data-testid={`wizard-shape-${m}`}
                        onClick={() => {
                          setShape(m);
                          setDoors(null);
                        }}
                        className={cn('h-8 rounded-md border px-3 text-xs', shape === m ? 'border-select bg-select/15 text-ink' : 'border-line text-ink-muted hover:bg-panel-2')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {shape === 'template' && (
                    <TemplatePicker
                      value={tpl}
                      fmt={fmt}
                      onChange={(v) => {
                        setTpl(v);
                        setDoors(null);
                      }}
                    />
                  )}
                  {shape === 'lengths' && <WallLengthsEditor rows={rows} setRows={setRows} closeAuto={closeAuto} setCloseAuto={setCloseAuto} fmt={fmt} />}
                  {shape === 'draw' && <p className="rounded-md border border-line bg-panel-2 p-3 text-xs text-ink-muted">You'll get an empty plan with the Wall tool ready: click the corners of your garage, typing exact lengths as you go.</p>}
                </div>
              )}
              {step === 3 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-ink">How high is the ceiling?</h3>
                  <div className="grid max-w-sm grid-cols-2 gap-3">
                    <LengthField label="Ceiling height" value={ceiling} onChange={setCeiling} fmt={fmt} testId="wizard-ceiling" />
                    <LengthField label="Wall thickness" value={thickness} onChange={setThickness} fmt={fmt} />
                  </div>
                  <p className="text-xs text-ink-muted">Used for tall cabinets, wall storage and garage-door clearance. Measure to the lowest joist or beam if there is no finished ceiling.</p>
                </div>
              )}
              {step === 4 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-ink">Garage doors</h3>
                  {walls.length === 0 ? (
                    <p className="text-xs text-ink-muted">Add garage doors from the Fixed features panel after you draw the room.</p>
                  ) : (
                    <>
                      {effectiveDoors.length === 0 && <p className="text-xs text-ink-muted">No garage door yet.</p>}
                      {effectiveDoors.map((d, i) => (
                        <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_auto] items-end gap-2 rounded-md border border-line p-2">
                          <div>
                            <Label className="text-xs text-ink-muted">Wall</Label>
                            <Select
                              className="mt-1 h-8"
                              ariaLabel={`Garage door ${i + 1} wall`}
                              value={String(d.wallIndex)}
                              onValueChange={(v) => setDoor(i, { wallIndex: Number(v), offset: walls[Number(v)]!.length / 2 })}
                              options={walls.map((w) => ({ value: String(w.index), label: `${wallLetter(w.index)} · ${w.name} (${fmt.length(w.length)})` }))}
                            />
                          </div>
                          <LengthField key={`w-${i}-${d.wallIndex}`} label="Width" value={d.width} onChange={(width) => setDoor(i, { width })} fmt={fmt} />
                          <LengthField key={`h-${i}`} label="Height" value={d.height} onChange={(height) => setDoor(i, { height })} fmt={fmt} />
                          <LengthField key={`o-${i}-${d.wallIndex}`} label="From wall start" value={d.offset - d.width / 2} onChange={(v) => setDoor(i, { offset: v + d.width / 2 })} fmt={fmt} />
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove garage door ${i + 1}`} onClick={() => setDoors(effectiveDoors.filter((_, j) => j !== i))}>
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          // Each extra door goes on the next free run, never on top of the last one (R-008);
                          // doors that share the front wall are re-spaced to make room for it.
                          const next = addDefaultDoor(outline.points, units === 'imperial' ? feetInches(9, 0) : 2700, feetInches(7, 0), effectiveDoors);
                          setDoors(next.length > effectiveDoors.length ? next : [...effectiveDoors, { wallIndex: 0, offset: walls[0]!.length / 2, width: Math.min(walls[0]!.length - 200, 2743.2), height: feetInches(7, 0) }]);
                        }}
                        data-testid="wizard-add-door"
                      >
                        <Plus /> Add a garage door
                      </Button>
                      <div className="rounded-md border border-line bg-panel-2 p-2">
                        <OutlinePreview points={outline.points} openings={effectiveDoors.map((d) => ({ ...d, kind: 'garage-door' as const }))} fmt={fmt} />
                      </div>
                    </>
                  )}
                </div>
              )}
              {step === 5 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-ink">Anything permanent in the way?</h3>
                  {walls.length === 0 ? (
                    <p className="text-xs text-ink-muted">Add fixed features from the Fixed features panel after you draw the room.</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        {OBSTRUCTIONS.map((o) => {
                          const on = obstructions.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              onClick={() => setObstructions(on ? obstructions.filter((x) => x !== o.id) : [...obstructions, o.id])}
                              className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs', on ? 'border-select bg-select/10 text-ink' : 'border-line text-ink-muted hover:bg-panel-2')}
                              data-testid={`wizard-obstruction-${o.id}`}
                            >
                              <span className={cn('grid size-4 place-items-center rounded border', on ? 'border-select bg-select text-white' : 'border-line')}>{on && <Check className="size-3" />}</span>
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-ink-muted">They're added along the walls with typical sizes. Drag each one to where it really is and type its exact size.</p>
                    </>
                  )}
                </div>
              )}
              {step === 6 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-ink">Do you park a vehicle here?</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => setVehicle(null)} className={cn('rounded-md border px-2 py-1.5 text-left text-xs', !vehicle ? 'border-select bg-select/10 text-ink' : 'border-line text-ink-muted hover:bg-panel-2')} data-testid="wizard-vehicle-none">
                      No vehicle
                    </button>
                    {VEHICLE_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setVehicle({ templateId: t.id, name: vehicle?.name ?? '' })}
                        className={cn('flex justify-between rounded-md border px-2 py-1.5 text-left text-xs', vehicle?.templateId === t.id ? 'border-select bg-select/10 text-ink' : 'border-line text-ink-muted hover:bg-panel-2')}
                        data-testid={`wizard-vehicle-${t.id}`}
                      >
                        {t.name}
                        <span className="num text-ink-faint">{fmt.length(t.length)}</span>
                      </button>
                    ))}
                  </div>
                  {vehicle && (
                    <div className="max-w-sm">
                      <Label className="text-xs text-ink-muted">Name (optional)</Label>
                      <Input className="mt-1 h-8" placeholder="e.g. 2024 Subaru WRX" value={vehicle.name} onChange={(e) => setVehicle({ ...vehicle, name: e.target.value })} aria-label="Vehicle name" />
                      <p className="mt-1 text-2xs text-ink-faint">Sizes are class averages: confirm your vehicle's length, width and mirror width in the inspector.</p>
                    </div>
                  )}
                  {vehicle && walls.length === 0 && <p className="text-xs text-warn">The vehicle is added once the room exists. You can add it from the Vehicles panel after drawing.</p>}
                </div>
              )}
              {step === 7 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-ink">Ready to lay out “{name.trim()}”</h3>
                  <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-xs">
                    <dt className="text-ink-muted">Units</dt>
                    <dd>{units === 'imperial' ? 'Feet & inches' : 'Metric'}</dd>
                    <dt className="text-ink-muted">Room</dt>
                    <dd>{outline.points.length ? `${outline.points.length} walls` : 'Draw it on the plan'}</dd>
                    <dt className="text-ink-muted">Ceiling</dt>
                    <dd className="num">{fmt.length(ceiling)}</dd>
                    <dt className="text-ink-muted">Garage doors</dt>
                    <dd>{outline.points.length ? effectiveDoors.length : 'None'}</dd>
                    <dt className="text-ink-muted">Obstructions</dt>
                    <dd>{outline.points.length && obstructions.length ? obstructions.map((o) => OBSTRUCTIONS.find((x) => x.id === o)?.label).join(', ') : 'None'}</dd>
                    <dt className="text-ink-muted">Vehicle</dt>
                    <dd>{vehicle ? vehicle.name || VEHICLE_TEMPLATES.find((t) => t.id === vehicle.templateId)?.name : 'None'}</dd>
                  </dl>
                  {outline.points.length > 0 && (
                    <div className="rounded-md border border-line bg-panel-2 p-2">
                      <OutlinePreview points={outline.points} openings={effectiveDoors.map((d) => ({ ...d, kind: 'garage-door' as const }))} fmt={fmt} />
                    </div>
                  )}
                  <p className="text-xs text-ink-muted">Next: add your tools, cabinets and benches from the Object library, then turn on clearances to see what really fits.</p>
                </div>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-2 text-xs text-danger" data-testid="wizard-error">
                {error}
              </p>
            )}
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
              <Button variant="ghost" onClick={() => void create(true)} disabled={busy} data-testid="wizard-start-blank" title="Create an empty project and draw the room yourself">
                Start blank
              </Button>
              <div className="ml-auto flex gap-2">
                {step > 0 && (
                  <Button variant="outline" onClick={() => (setError(null), setStep((s) => s - 1))}>
                    <ChevronLeft /> Back
                  </Button>
                )}
                <Button type="submit" variant="primary" disabled={busy} data-testid={step === STEPS.length - 1 ? 'wizard-create' : 'wizard-next'}>
                  {step === STEPS.length - 1 ? (
                    <>Create project</>
                  ) : (
                    <>
                      Next <ChevronRight />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
