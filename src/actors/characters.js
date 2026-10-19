// Character roster: visual specs for Cobretti, Ingrid, the Night Slasher and his gang.
// Silhouette & colour identity per enemy kind (read at ~130 px in dark neon scenes):
//   thug: huge, bald, shiny vest + chains   knifer: red bandana, denim jacket, long hair
//   gunner: cap, white tee, black leather    bazooka: pink mohawk punk, red leather
//   granny: purple headscarf, long brown coat axeman: hooded cultist with mask
//   biker: beard, blue bandana, fat, vest    grabber: green tracksuit, flat-top
//   bomber: olive army helmet & fatigues
import * as THREE from 'three';
import { Rig } from './rig.js';
import * as Gear from './gear.js';

const SPECS = {
  cobra: {
    height: 1.86, build: { shoulders: 1.08, chest: 1.08, arms: 1.12, legs: 1.0 }, neck: 1.06, muscle: 1.15,
    skin: '#b47a58', hair: '#120d0a', hairStyle: 'swept', brows: '#1a120d',
    face: { jaw: 1.15, chin: 1.12, nose: 1.08, brow: 1.15, cheek: 1.05, cleft: 1, lips: 1.05 },
    top: '#0e0f12', topSleeves: 'short', pants: '#24324f', pantsFit: 'denim', shoes: '#0b0b0c', footwear: 'boot',
    gloves: '#0c0c0d', belt: '#2a1a10', sunglasses: true, match: true, holster: true, watch: true, stubble: true, seed: 7,
  },
  ingrid: {
    height: 1.8, female: true, build: { shoulders: 0.96, chest: 0.94, arms: 0.9, legs: 1.05, hips: 1.0 }, bust: 0.9,
    skin: '#ebc3a6', hair: '#efdca4', hairStyle: 'big', brows: '#9a7a52', eyes: '#4d7398',
    lips: '#b8283f', makeup: true, eyeshadow: '#6a7fa8', face: { jaw: 0.95, chin: 1.05, nose: 0.82, cheek: 1.2, lips: 1.1, width: 1.02 },
    dress: '#f1ece8', dressLength: 0.46, heels: true, footwear: 'pump', shoes: '#a81c34', top: null, topSleeves: 'none',
    necklace: true, seed: 11,
  },
  slasher: {
    height: 1.95, build: { shoulders: 1.06, chest: 1.0, arms: 1.05, legs: 1.05, belly: 0.95 }, neck: 1.05,
    skin: '#c4a08a', hair: '#1d1714', hairStyle: 'long', hairLength: 0.34, glasses: true, glassesTint: '#3a3f44',
    face: { jaw: 1.25, chin: 1.1, nose: 1.18, brow: 1.35, cheek: 1.15, gaunt: 0.75 },
    top: '#24201d', topSleeves: 'long', pants: '#151413', shoes: '#120f0d', footwear: 'boot',
    jacket: '#121110', jacketLong: true, jacketShine: true, coatLength: 0.78, stubble: true, seed: 3,
  },
  thug: {
    height: 1.92, build: { shoulders: 1.2, chest: 1.2, arms: 1.28, legs: 1.05, belly: 1.15 }, neck: 1.3, muscle: 1.3,
    skin: '#7d4e35', hairStyle: 'bald', face: { jaw: 1.3, chin: 1.1, nose: 1.2, brow: 1.4 },
    top: '#1d1d22', topSleeves: 'none', pants: '#2b2f3a', shoes: '#111', footwear: 'combat',
    jacket: '#1a1410', jacketShine: true, vest: true, sunglasses: true, chains: true, belt: '#0c0c0c', seed: 21,
  },
  knifer: {
    height: 1.8, build: { shoulders: 0.95, chest: 0.92, arms: 0.95, legs: 1.0, belly: 0.9 },
    skin: '#c99a76', hair: '#3a2a1c', hairStyle: 'long', hairLength: 0.2, bandana: '#b3161c', stubble: true,
    face: { jaw: 0.95, nose: 1.1, gaunt: 0.4 },
    top: '#7e1c1c', topSleeves: 'short', pants: '#33415f', pantsFit: 'denim', shoes: '#2a201a', footwear: 'boot', jacket: '#4a6590', seed: 31,
  },
  gunner: {
    height: 1.83, build: { shoulders: 1.0, chest: 1.0, arms: 1.0 },
    skin: '#a87458', hair: '#1a1410', hairStyle: 'short', cap: '#15161a', face: { jaw: 1.05 },
    top: '#d8d4cc', topSleeves: 'short', pants: '#1a1c22', shoes: '#0e0e0f', footwear: 'boot', jacket: '#141414', jacketShine: true, seed: 41,
  },
  bazooka: {
    height: 1.76, female: true, build: { shoulders: 1.0, chest: 0.95, arms: 0.95, legs: 1.02 },
    skin: '#d9a98a', hair: '#ff3fa6', hairStyle: 'mohawk', brows: '#2a1a14', lips: '#3a1a2a', makeup: true, top: '#111', topSleeves: 'short',
    pants: '#151515', shoes: '#0b0b0b', footwear: 'combat', jacket: '#a3121f', jacketShine: true, sunglasses: true, seed: 51,
  },
  granny: {
    height: 1.64, female: true, build: { shoulders: 0.95, chest: 1.0, arms: 0.9, legs: 0.95, belly: 1.12 }, bust: 1.1,
    skin: '#dcb7a0', hair: '#c9c6c0', hairStyle: 'short', scarf: '#6b3f8a', glasses: true, glassesTint: '#cfd8de',
    face: { age: 1, cheek: 0.9, lips: 0.8 },
    dress: '#5a4632', dressLength: 0.56, tights: '#a58a72', shoes: '#3a2a20', footwear: 'shoe', top: '#5a4632', topSleeves: 'long', buttons: true, belt: '#3a2a1a', seed: 61,
  },
  axeman: {
    height: 1.86, build: { shoulders: 1.06, chest: 1.05, arms: 1.1 },
    skin: '#b88466', hood: '#1b1a1d', mask: '#26262a', top: '#232327', topSleeves: 'long', pants: '#1b1c20', shoes: '#0c0c0c', footwear: 'combat',
    jacket: '#2a2522', seed: 71,
  },
  biker: {
    height: 1.88, build: { shoulders: 1.12, chest: 1.15, arms: 1.15, belly: 1.25 }, neck: 1.2,
    skin: '#c08b6a', hair: '#3a2716', hairStyle: 'long', hairLength: 0.22, beard: true, bandana: '#1f3f8a', sunglasses: true,
    top: '#3a3a3a', topSleeves: 'none', pants: '#2d3c5c', pantsFit: 'denim', shoes: '#141414', footwear: 'boot',
    jacket: '#101010', jacketShine: true, vest: true, chains: true, belt: '#151515', seed: 81,
  },
  grabber: {
    height: 1.84, build: { shoulders: 1.05, chest: 1.0, arms: 1.05, legs: 1.05 },
    skin: '#6f4430', hairStyle: 'flattop', hair: '#0e0c0b', top: '#1f7a3e', topSleeves: 'long', pants: '#1f7a3e', pantsFit: 'track',
    shoes: '#f0f0f0', footwear: 'sneaker', sunglasses: true, seed: 91,
  },
  bomber: {
    height: 1.8, build: { shoulders: 1.0, chest: 1.05, arms: 1.0, belly: 1.15 },
    skin: '#c4936f', hair: '#5a3a1c', hairStyle: 'short', helmet: '#4a4f2a', stubble: true,
    top: '#6a5a2c', topSleeves: 'long', pants: '#3a3a26', shoes: '#1a140e', footwear: 'combat', belt: '#2a2a1a', seed: 101,
  },
};

const GEAR = {
  pistol: Gear.makePistol,
  smg: Gear.makeSMG,
  knife: Gear.makeKnife,
  slasherKnife: Gear.makeSlasherKnife,
  axe: Gear.makeAxe,
};

/** Builds a character rig. Returns the Rig (rig.root is the scene object). */
export function createCharacter(kind, overrides = {}) {
  const spec = { ...SPECS[kind], ...overrides, kind };
  const rig = new Rig(spec);
  rig.kind = kind;
  const S = rig.scale;
  switch (kind) {
    case 'cobra':
      rig.attach('pistol', Gear.makePistol(), 'hdR');
      rig.attach('smg', Gear.makeSMG(), 'hdR');
      rig.attach('knife', Gear.makeKnife(), 'hdR');
      rig.show('pistol', false); rig.show('smg', false); rig.show('knife', false);
      break;
    case 'slasher':
      rig.attach('blade', Gear.makeSlasherKnife(), 'hdR');
      break;
    case 'knifer':
      rig.attach('knife', Gear.makeKnife(), 'hdR');
      break;
    case 'gunner':
      rig.attach('pistol', Gear.makePistol(), 'hdR');
      break;
    case 'axeman':
      rig.attach('axe', Gear.makeAxe(), 'hdR');
      break;
    case 'bazooka': {
      const tube = Gear.makeBazooka().children[0];
      tube.rotation.set(0, 0, 0);
      // resting on the right shoulder, muzzle forward
      tube.position.set(-0.155 * S, 0.3 * S, 0.06 * S);
      rig.attach('tube', tube, 'chest');
      rig.items.tube.userData.muzzle = tube.children.find((c) => !c.isMesh && c.name === 'muzzle') || tube.children.find((c) => !c.isMesh);
      break;
    }
    case 'granny':
      rig.attach('bag', Gear.makeHandbag(), 'hdL');
      break;
    default:
      break;
  }
  return rig;
}

export function gearFor(name) { return GEAR[name] ? GEAR[name]() : null; }
export const CHARACTER_KINDS = Object.keys(SPECS);
