/**
 * Generic vehicle templates. Dimensions are approximate class averages (not specific models);
 * users confirm/override length, width, height, mirror width and wheelbase.
 */
import { newId } from '@/utils/id';
import { feetInches, inches } from '@/domain/units';
import type { Vehicle, VehicleDoor } from '@/domain/schema';
import type { PoseData } from '@/domain/schema/common';

export interface VehicleTemplate {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  mirrorWidth: number;
  foldedMirrorWidth: number;
  wheelbase: number;
  frontOverhang: number;
  turningRadius: number;
  frontDoorLength: number;
  rearDoorLength: number | null;
  rearAccess: Vehicle['rearAccess'];
  hoodAccessDepth: number;
}

const t = (x: VehicleTemplate) => x;

export const VEHICLE_TEMPLATES: readonly VehicleTemplate[] = [
  t({ id: 'compact-car', name: 'Compact car', length: inches(179), width: inches(70), height: inches(56), mirrorWidth: inches(78), foldedMirrorWidth: inches(73), wheelbase: inches(106), frontOverhang: inches(35), turningRadius: feetInches(17, 9), frontDoorLength: inches(42), rearDoorLength: inches(33), rearAccess: { kind: 'trunk', depth: inches(24) }, hoodAccessDepth: inches(24) }),
  t({ id: 'sedan', name: 'Sedan', length: inches(193), width: inches(72.5), height: inches(57), mirrorWidth: inches(82), foldedMirrorWidth: inches(76), wheelbase: inches(111), frontOverhang: inches(38), turningRadius: feetInches(18, 8), frontDoorLength: inches(44), rearDoorLength: inches(35), rearAccess: { kind: 'trunk', depth: inches(24) }, hoodAccessDepth: inches(24) }),
  t({ id: 'sports-car', name: 'Sports car', length: inches(189), width: inches(75), height: inches(54), mirrorWidth: inches(82), foldedMirrorWidth: inches(78), wheelbase: inches(107), frontOverhang: inches(38), turningRadius: feetInches(19, 0), frontDoorLength: inches(50), rearDoorLength: null, rearAccess: { kind: 'trunk', depth: inches(24) }, hoodAccessDepth: inches(24) }),
  t({ id: 'midsize-suv', name: 'Midsize SUV', length: inches(195), width: inches(76), height: inches(69), mirrorWidth: inches(85), foldedMirrorWidth: inches(79), wheelbase: inches(113), frontOverhang: inches(38), turningRadius: feetInches(19, 3), frontDoorLength: inches(44), rearDoorLength: inches(38), rearAccess: { kind: 'hatch', depth: inches(36) }, hoodAccessDepth: inches(24) }),
  t({ id: 'full-size-suv', name: 'Full-size SUV', length: inches(211), width: inches(81), height: inches(76), mirrorWidth: inches(93), foldedMirrorWidth: inches(84), wheelbase: inches(121), frontOverhang: inches(40), turningRadius: feetInches(20, 4), frontDoorLength: inches(46), rearDoorLength: inches(40), rearAccess: { kind: 'hatch', depth: inches(40) }, hoodAccessDepth: inches(24) }),
  t({ id: 'pickup-truck', name: 'Pickup truck (regular cab)', length: inches(210), width: inches(80), height: inches(75), mirrorWidth: inches(96), foldedMirrorWidth: inches(86), wheelbase: inches(122), frontOverhang: inches(38), turningRadius: feetInches(21, 0), frontDoorLength: inches(48), rearDoorLength: null, rearAccess: { kind: 'tailgate', depth: inches(30) }, hoodAccessDepth: inches(24) }),
  t({ id: 'crew-cab-pickup', name: 'Crew-cab pickup', length: inches(232), width: inches(80), height: inches(77), mirrorWidth: inches(96), foldedMirrorWidth: inches(86), wheelbase: inches(145), frontOverhang: inches(38), turningRadius: feetInches(23, 8), frontDoorLength: inches(46), rearDoorLength: inches(40), rearAccess: { kind: 'tailgate', depth: inches(30) }, hoodAccessDepth: inches(24) }),
];

export function vehicleTemplate(id: string): VehicleTemplate {
  const tpl = VEHICLE_TEMPLATES.find((v) => v.id === id);
  if (!tpl) throw new Error(`Unknown vehicle template "${id}"`);
  return tpl;
}

/** Door layout derived from the template (hinges near the A- and B-pillars). */
function doorsFor(tpl: VehicleTemplate): VehicleDoor[] {
  const frontHinge = tpl.frontOverhang + inches(22);
  const doors: VehicleDoor[] = [
    { id: 'driver-front', hingeFromFront: frontHinge, length: tpl.frontDoorLength, openAngle: 65 },
    { id: 'passenger-front', hingeFromFront: frontHinge, length: tpl.frontDoorLength, openAngle: 65 },
  ];
  if (tpl.rearDoorLength) {
    const rearHinge = frontHinge + tpl.frontDoorLength + inches(2);
    doors.push(
      { id: 'driver-rear', hingeFromFront: rearHinge, length: tpl.rearDoorLength, openAngle: 70 },
      { id: 'passenger-rear', hingeFromFront: rearHinge, length: tpl.rearDoorLength, openAngle: 70 },
    );
  }
  return doors;
}

/** A new vehicle from a template at a pose (front faces local +y; rotation 180 = nose north). */
export function createVehicle(templateId: string, pose: PoseData, overrides: Partial<Vehicle> = {}): Vehicle {
  const tpl = vehicleTemplate(templateId);
  return {
    id: newId(),
    name: tpl.name,
    templateId: tpl.id,
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    length: tpl.length,
    width: tpl.width,
    height: tpl.height,
    mirrorWidth: tpl.mirrorWidth,
    foldedMirrorWidth: tpl.foldedMirrorWidth,
    mirrorsFolded: false,
    wheelbase: tpl.wheelbase,
    frontOverhang: tpl.frontOverhang,
    turningRadius: tpl.turningRadius,
    driverSide: 'left',
    doors: doorsFor(tpl),
    rearAccess: tpl.rearAccess,
    hoodAccessDepth: tpl.hoodAccessDepth,
    desiredClearance: { driver: inches(30), passenger: inches(18), front: inches(24), rear: inches(30) },
    state: 'parked',
    locked: false,
    hidden: false,
    notes: '',
    ...overrides,
  };
}
