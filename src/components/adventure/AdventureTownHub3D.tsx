'use client';

import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { CharacterClassId } from '@/lib/adventure';
import {
  TOWN_SERVICE_DEFINITIONS,
  type TownServiceId,
} from '@/lib/adventureTown';
import styles from './AdventureTownHub3D.module.css';

type MoveDirection = 'up' | 'down' | 'left' | 'right';

export interface AdventureTownHub3DProps {
  classId: CharacterClassId;
  playerName: string;
  townName: string;
  weaponEquipped: boolean;
  onSelectService: (service: TownServiceId) => void;
}

interface ServicePlacement {
  id: TownServiceId;
  position: [number, number, number];
  approach: [number, number, number];
  color: string;
}

const SERVICE_PLACEMENTS: readonly ServicePlacement[] = [
  { id: 'merchant', position: [-5.2, 0, 0.8], approach: [-4.1, 0, 1.2], color: '#a9864d' },
  { id: 'blacksmith', position: [4.4, 0, 2.45], approach: [3.45, 0, 2.55], color: '#7d5541' },
  { id: 'healer', position: [-3.4, 0, -3.5], approach: [-2.5, 0, -2.6], color: '#657d70' },
  { id: 'stash', position: [3.05, 0, -3.15], approach: [2.35, 0, -2.35], color: '#6c5742' },
  { id: 'waypoint', position: [0, 0, -8.1], approach: [0, 0, -6.4], color: '#a68a4e' },
] as const;

const HERO_COLORS: Record<CharacterClassId, { cloth: string; metal: string; accent: string }> = {
  vanguard: { cloth: '#4d2023', metal: '#606669', accent: '#9d854f' },
  ranger: { cloth: '#34463a', metal: '#5b4938', accent: '#8f8155' },
  mystic: { cloth: '#373747', metal: '#315155', accent: '#55918e' },
};

type TownHumanoidRole = CharacterClassId | 'merchant' | 'blacksmith' | 'healer' | 'stash';

interface TownHumanoidPalette {
  cloth: string;
  leather: string;
  metal: string;
  accent: string;
  skin: string;
  hair: string;
}

const NPC_COLORS: Record<'merchant' | 'blacksmith' | 'healer' | 'stash', TownHumanoidPalette> = {
  merchant: { cloth: '#4f4130', leather: '#332b24', metal: '#6d6047', accent: '#9b814c', skin: '#8f6755', hair: '#29231f' },
  blacksmith: { cloth: '#3f2c29', leather: '#29231f', metal: '#575e5d', accent: '#8b4d34', skin: '#825b4d', hair: '#201c1a' },
  healer: { cloth: '#3f514b', leather: '#30352f', metal: '#716e5d', accent: '#829d8b', skin: '#986f5d', hair: '#443d37' },
  stash: { cloth: '#393b3e', leather: '#332d28', metal: '#65635c', accent: '#8b744a', skin: '#85604f', hair: '#252321' },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function Headwear({ role, palette }: { role: TownHumanoidRole; palette: TownHumanoidPalette }) {
  if (role === 'vanguard') {
    return (
      <>
        <mesh castShadow position={[0, 0.055, -0.01]} scale={[1.02, 0.82, 1.03]}>
          <sphereGeometry args={[0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.7]} />
          <meshStandardMaterial color={palette.metal} metalness={0.58} roughness={0.5} />
        </mesh>
        <mesh castShadow position={[0, 0.005, 0.19]}>
          <boxGeometry args={[0.035, 0.22, 0.035]} />
          <meshStandardMaterial color={palette.metal} metalness={0.65} roughness={0.42} />
        </mesh>
        <mesh castShadow position={[0, 0.115, -0.19]}>
          <coneGeometry args={[0.055, 0.2, 6]} />
          <meshStandardMaterial color={palette.accent} metalness={0.5} roughness={0.48} />
        </mesh>
      </>
    );
  }
  if (role === 'ranger' || role === 'mystic' || role === 'healer') {
    return (
      <>
        <mesh castShadow position={[0, 0.045, -0.03]} scale={[1.08, 1.06, 1.05]}>
          <sphereGeometry args={[0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.73]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.94} />
        </mesh>
        <mesh castShadow position={[0, -0.16, -0.16]} scale={[1.15, 1, 0.45]}>
          <coneGeometry args={[0.23, 0.42, 9]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.95} />
        </mesh>
      </>
    );
  }
  if (role === 'merchant') {
    return (
      <>
        <mesh castShadow position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.035, 12]} />
          <meshStandardMaterial color={palette.leather} roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, 0.245, -0.01]}>
          <cylinderGeometry args={[0.14, 0.18, 0.14, 10]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.94} />
        </mesh>
        <mesh position={[0.14, 0.19, 0.04]} rotation={[0.15, 0, -0.55]}>
          <boxGeometry args={[0.035, 0.22, 0.02]} />
          <meshStandardMaterial color={palette.accent} roughness={0.75} />
        </mesh>
      </>
    );
  }
  if (role === 'stash') {
    return (
      <>
        <mesh castShadow position={[0, 0.11, -0.02]} scale={[1.02, 0.72, 1.03]}>
          <sphereGeometry args={[0.205, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.7]} />
          <meshStandardMaterial color={palette.leather} roughness={0.96} />
        </mesh>
        <mesh castShadow position={[0.13, 0.2, -0.02]} rotation={[0, 0, -0.38]}>
          <cylinderGeometry args={[0.025, 0.025, 0.24, 6]} />
          <meshStandardMaterial color={palette.metal} metalness={0.5} roughness={0.52} />
        </mesh>
      </>
    );
  }
  return (
    <mesh castShadow position={[0, -0.14, 0.15]} rotation={[Math.PI / 2, 0, 0]} scale={[0.9, 1.2, 0.8]}>
      <coneGeometry args={[0.12, 0.26, 8]} />
      <meshStandardMaterial color={palette.hair} roughness={0.98} />
    </mesh>
  );
}

function TorsoEquipment({ role, palette, weaponEquipped }: { role: TownHumanoidRole; palette: TownHumanoidPalette; weaponEquipped: boolean }) {
  if (role === 'vanguard') {
    return (
      <>
        <mesh castShadow position={[0, 1.68, 0.175]} scale={[0.96, 1, 0.35]}>
          <dodecahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial color={palette.metal} metalness={0.5} roughness={0.52} />
        </mesh>
        <mesh position={[0, 1.67, 0.285]}>
          <boxGeometry args={[0.045, 0.43, 0.025]} />
          <meshStandardMaterial color={palette.accent} metalness={0.58} roughness={0.45} />
        </mesh>
        <mesh castShadow position={[0, 1.5, -0.2]} rotation={[0.08, 0, 0]}>
          <boxGeometry args={[0.5, 0.78, 0.055]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.96} />
        </mesh>
      </>
    );
  }
  if (role === 'ranger') {
    return (
      <>
        <mesh position={[0, 1.62, 0.24]} rotation={[0, 0, -0.57]}>
          <boxGeometry args={[0.065, 0.68, 0.035]} />
          <meshStandardMaterial color={palette.leather} roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 1.47, -0.2]} rotation={[0.1, 0, 0]}>
          <boxGeometry args={[0.48, 0.86, 0.045]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.97} />
        </mesh>
        {weaponEquipped && (
          <group position={[-0.2, 1.62, -0.27]} rotation={[0.25, 0, 0.28]}>
            <mesh castShadow><cylinderGeometry args={[0.075, 0.09, 0.62, 8]} /><meshStandardMaterial color={palette.leather} roughness={0.94} /></mesh>
            {[-0.055, 0, 0.055].map((x) => (
              <mesh key={x} position={[x, 0.43, 0]}><cylinderGeometry args={[0.009, 0.009, 0.38, 5]} /><meshStandardMaterial color="#7b6749" roughness={0.88} /></mesh>
            ))}
          </group>
        )}
      </>
    );
  }
  if (role === 'mystic') {
    return (
      <>
        <mesh castShadow position={[0, 1.24, -0.015]}>
          <cylinderGeometry args={[0.22, 0.34, 0.82, 10]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.95} />
        </mesh>
        <mesh position={[0, 1.6, 0.255]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.095, 0.018, 5, 10]} />
          <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.45} metalness={0.4} roughness={0.42} />
        </mesh>
      </>
    );
  }
  if (role === 'merchant') {
    return (
      <>
        <mesh castShadow position={[-0.27, 1.42, -0.2]} rotation={[0.06, 0, -0.08]}>
          <boxGeometry args={[0.35, 0.62, 0.22]} />
          <meshStandardMaterial color={palette.leather} roughness={0.96} />
        </mesh>
        <mesh castShadow position={[0, 1.58, 0.24]} rotation={[0, 0, -0.62]}>
          <boxGeometry args={[0.065, 0.68, 0.035]} />
          <meshStandardMaterial color={palette.accent} roughness={0.8} />
        </mesh>
        {[-0.24, 0.25].map((x) => (
          <mesh key={x} castShadow position={[x, 1.18, 0.19]}><capsuleGeometry args={[0.07, 0.12, 4, 7]} /><meshStandardMaterial color={palette.leather} roughness={0.98} /></mesh>
        ))}
      </>
    );
  }
  if (role === 'blacksmith') {
    return (
      <>
        <mesh castShadow position={[0, 1.44, 0.235]}>
          <boxGeometry args={[0.43, 0.82, 0.055]} />
          <meshStandardMaterial color={palette.leather} roughness={0.96} />
        </mesh>
        <mesh position={[0, 1.45, 0.275]}>
          <boxGeometry args={[0.055, 0.76, 0.025]} />
          <meshStandardMaterial color={palette.accent} roughness={0.74} />
        </mesh>
        <mesh castShadow position={[0, 1.78, 0.22]}>
          <torusGeometry args={[0.28, 0.025, 6, 12, Math.PI]} />
          <meshStandardMaterial color={palette.metal} metalness={0.55} roughness={0.48} />
        </mesh>
      </>
    );
  }
  if (role === 'healer') {
    return (
      <>
        <mesh castShadow position={[0, 1.26, -0.01]}>
          <cylinderGeometry args={[0.22, 0.34, 0.8, 10]} />
          <meshStandardMaterial color={palette.cloth} roughness={0.97} />
        </mesh>
        {[-0.09, 0.09].map((x) => (
          <mesh key={x} position={[x, 1.48, 0.245]}><boxGeometry args={[0.055, 0.78, 0.025]} /><meshStandardMaterial color={palette.accent} roughness={0.82} /></mesh>
        ))}
        <mesh position={[0, 1.64, 0.275]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.08, 0.016, 5, 10]} />
          <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.35} />
        </mesh>
      </>
    );
  }
  return (
    <>
      <mesh castShadow position={[0.16, 1.45, -0.23]} rotation={[0.08, 0, 0.06]}>
        <boxGeometry args={[0.48, 0.72, 0.25]} />
        <meshStandardMaterial color={palette.leather} roughness={0.97} />
      </mesh>
      <mesh position={[0, 1.56, 0.24]} rotation={[0, 0, 0.58]}>
        <boxGeometry args={[0.06, 0.72, 0.035]} />
        <meshStandardMaterial color={palette.metal} metalness={0.42} roughness={0.58} />
      </mesh>
      <group position={[-0.22, 1.21, 0.2]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.095, 0.018, 5, 10]} /><meshStandardMaterial color={palette.accent} metalness={0.68} roughness={0.38} /></mesh>
        {[-0.05, 0.02, 0.08].map((x, index) => (
          <mesh key={x} position={[x, -0.11 - index * 0.025, 0]} rotation={[0, 0, index * 0.15 - 0.1]}><boxGeometry args={[0.025, 0.22, 0.018]} /><meshStandardMaterial color={palette.accent} metalness={0.66} roughness={0.4} /></mesh>
        ))}
      </group>
    </>
  );
}

function HeldEquipment({ role, palette, side, weaponEquipped }: { role: TownHumanoidRole; palette: TownHumanoidPalette; side: -1 | 1; weaponEquipped: boolean }) {
  if (!weaponEquipped && (role === 'vanguard' || role === 'ranger' || role === 'mystic')) return null;
  if (role === 'vanguard' && side === -1) {
    return (
      <group position={[0, -0.68, 0.18]} rotation={[Math.PI / 2, 0, 0.05]}>
        <mesh castShadow><cylinderGeometry args={[0.26, 0.3, 0.075, 10]} /><meshStandardMaterial color={palette.metal} metalness={0.58} roughness={0.46} /></mesh>
        <mesh position={[0, -0.045, 0]}><torusGeometry args={[0.2, 0.025, 6, 12]} /><meshStandardMaterial color={palette.accent} metalness={0.62} roughness={0.4} /></mesh>
        <mesh position={[0, -0.085, 0]}><coneGeometry args={[0.07, 0.13, 6]} /><meshStandardMaterial color={palette.accent} metalness={0.6} roughness={0.42} /></mesh>
      </group>
    );
  }
  if (role === 'vanguard' && side === 1) {
    return (
      <group position={[0, -0.98, 0.08]} rotation={[0.03, 0, -0.26]}>
        <mesh castShadow position={[0, 0.03, 0]}><cylinderGeometry args={[0.033, 0.04, 0.28, 7]} /><meshStandardMaterial color="#554438" roughness={0.76} /></mesh>
        <mesh castShadow position={[0, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.27, 0.045, 0.065]} /><meshStandardMaterial color={palette.accent} metalness={0.65} roughness={0.38} /></mesh>
        <mesh castShadow position={[0, 0.49, 0]}><coneGeometry args={[0.09, 0.68, 4]} /><meshStandardMaterial color="#a2a7a5" metalness={0.76} roughness={0.3} /></mesh>
        <mesh castShadow position={[0, -0.13, 0]}><sphereGeometry args={[0.055, 7, 5]} /><meshStandardMaterial color={palette.accent} metalness={0.62} roughness={0.42} /></mesh>
      </group>
    );
  }
  if (role === 'ranger' && side === -1) {
    return (
      <group position={[0, -0.73, 0.15]}>
        <mesh castShadow rotation={[0, 0, -0.22]}><torusGeometry args={[0.43, 0.025, 5, 20, Math.PI * 1.55]} /><meshStandardMaterial color={palette.accent} roughness={0.7} /></mesh>
        <mesh rotation={[0, 0, -0.04]}><cylinderGeometry args={[0.008, 0.008, 0.78, 5]} /><meshStandardMaterial color="#a99f83" roughness={0.82} /></mesh>
        <mesh position={[0, -0.14, 0.01]}><boxGeometry args={[0.06, 0.2, 0.045]} /><meshStandardMaterial color={palette.leather} roughness={0.9} /></mesh>
      </group>
    );
  }
  if (role === 'mystic' && side === 1) {
    return (
      <group position={[0, -0.92, 0.1]}>
        <mesh castShadow position={[0, -0.04, 0]}><cylinderGeometry args={[0.03, 0.04, 1.82, 7]} /><meshStandardMaterial color={palette.leather} roughness={0.86} /></mesh>
        <mesh castShadow position={[0, 0.93, 0]} rotation={[0.2, 0.2, 0]}><octahedronGeometry args={[0.14, 0]} /><meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={1.1} roughness={0.28} /></mesh>
        <pointLight color={palette.accent} intensity={0.35} distance={1.8} position={[0, 0.93, 0]} />
      </group>
    );
  }
  if (role === 'blacksmith' && side === 1) {
    return (
      <group position={[0, -0.98, 0.08]} rotation={[0, 0, -0.18]}>
        <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.038, 0.045, 0.7, 7]} /><meshStandardMaterial color="#56443a" roughness={0.78} /></mesh>
        <mesh castShadow position={[0, 0.61, 0]} rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.36, 0.17, 0.16]} /><meshStandardMaterial color={palette.metal} metalness={0.62} roughness={0.43} /></mesh>
        <mesh position={[0.21, 0.61, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.08, 0.2, 5]} /><meshStandardMaterial color={palette.metal} metalness={0.6} roughness={0.44} /></mesh>
      </group>
    );
  }
  if (role === 'healer' && side === 1) {
    return (
      <group position={[0, -0.92, 0.1]}>
        <mesh castShadow position={[0, -0.04, 0]}><cylinderGeometry args={[0.028, 0.04, 1.8, 7]} /><meshStandardMaterial color={palette.leather} roughness={0.9} /></mesh>
        <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.13, 0.025, 6, 12]} /><meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.65} metalness={0.28} roughness={0.42} /></mesh>
        <mesh position={[0, 0.9, 0]}><octahedronGeometry args={[0.055, 0]} /><meshStandardMaterial color="#c2d0bb" emissive={palette.accent} emissiveIntensity={0.75} /></mesh>
      </group>
    );
  }
  if (role === 'merchant' && side === 1) {
    return (
      <group position={[0, -1, 0.1]}>
        <mesh position={[0, -0.16, 0]}><cylinderGeometry args={[0.012, 0.012, 0.34, 5]} /><meshStandardMaterial color={palette.metal} metalness={0.62} roughness={0.45} /></mesh>
        <mesh position={[0, -0.32, 0]} rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.34, 0.025, 0.025]} /><meshStandardMaterial color={palette.metal} metalness={0.64} roughness={0.42} /></mesh>
        {[-0.15, 0.15].map((x) => (
          <group key={x} position={[x, -0.47, 0]}><mesh><cylinderGeometry args={[0.01, 0.01, 0.24, 5]} /><meshStandardMaterial color={palette.metal} metalness={0.6} roughness={0.45} /></mesh><mesh position={[0, -0.14, 0]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.09, 0.05, 10]} /><meshStandardMaterial color={palette.accent} metalness={0.55} roughness={0.45} /></mesh></group>
        ))}
      </group>
    );
  }
  if (role === 'stash' && side === -1) {
    return (
      <group position={[0, -1.02, 0.1]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.09, 0.015, 5, 10]} /><meshStandardMaterial color={palette.accent} metalness={0.68} roughness={0.38} /></mesh>
        {[-0.045, 0.02, 0.07].map((x, index) => (
          <mesh key={x} position={[x, -0.14 - index * 0.025, 0]} rotation={[0, 0, index * 0.16 - 0.12]}><boxGeometry args={[0.022, 0.25, 0.018]} /><meshStandardMaterial color={palette.accent} metalness={0.66} roughness={0.4} /></mesh>
        ))}
      </group>
    );
  }
  return null;
}

function TownHumanoid({
  role,
  palette,
  leftArmRef,
  rightArmRef,
  leftLegRef,
  rightLegRef,
  weaponEquipped = true,
}: {
  role: TownHumanoidRole;
  palette: TownHumanoidPalette;
  leftArmRef?: MutableRefObject<THREE.Group | null>;
  rightArmRef?: MutableRefObject<THREE.Group | null>;
  leftLegRef?: MutableRefObject<THREE.Group | null>;
  rightLegRef?: MutableRefObject<THREE.Group | null>;
  weaponEquipped?: boolean;
}) {
  const isVanguard = role === 'vanguard';
  const isRanger = role === 'ranger';
  const isMystic = role === 'mystic';
  const isBlacksmith = role === 'blacksmith';
  const isHealer = role === 'healer';
  const shoulderWidth = isVanguard || isBlacksmith ? 0.4 : 0.37;
  const bodyScale: [number, number, number] = isBlacksmith ? [1.05, 1.01, 1.03] : isRanger || isMystic || isHealer ? [0.97, 1, 0.97] : [1, 1, 1];
  const gloveColor = isVanguard || isRanger || isBlacksmith ? palette.leather : palette.skin;
  const armoredShoulder = isVanguard || isBlacksmith;

  return (
    <group scale={bodyScale}>
      <mesh castShadow position={[0, 1.14, 0]}>
        <cylinderGeometry args={[0.22, 0.25, 0.32, 10]} />
        <meshStandardMaterial color={palette.leather} roughness={0.92} />
      </mesh>
      <mesh castShadow position={[0, 1.42, 0]}>
        <cylinderGeometry args={[0.27, 0.21, 0.38, 10]} />
        <meshStandardMaterial color={palette.cloth} roughness={0.92} />
      </mesh>
      <mesh castShadow position={[0, 1.69, 0]}>
        <cylinderGeometry args={[0.34, 0.26, 0.36, 10]} />
        <meshStandardMaterial color={palette.cloth} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.235, 0.025, 6, 12]} />
        <meshStandardMaterial color={palette.accent} metalness={0.42} roughness={0.5} />
      </mesh>
      <TorsoEquipment role={role} palette={palette} weaponEquipped={weaponEquipped} />
      <mesh castShadow position={[0, 2, 0]}>
        <cylinderGeometry args={[0.085, 0.1, 0.18, 9]} />
        <meshStandardMaterial color={palette.skin} roughness={0.94} />
      </mesh>
      <group position={[0, 2.28, 0]}>
        <mesh castShadow scale={[0.92, 1.13, 0.92]}>
          <sphereGeometry args={[0.185, 12, 9]} />
          <meshStandardMaterial color={palette.skin} roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, 0.07, -0.035]} scale={[0.95, 0.63, 0.96]}>
          <sphereGeometry args={[0.19, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
          <meshStandardMaterial color={palette.hair} roughness={0.98} />
        </mesh>
        <mesh castShadow position={[0, -0.025, 0.177]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.028, 0.075, 6]} />
          <meshStandardMaterial color={palette.skin} roughness={0.92} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={`eye-${side}`} position={[side * 0.064, 0.035, 0.17]}>
            <boxGeometry args={[0.042, 0.012, 0.012]} />
            <meshStandardMaterial color="#171713" roughness={0.6} />
          </mesh>
        ))}
        <Headwear role={role} palette={palette} />
      </group>
      {([-1, 1] as const).map((side) => (
        <group
          key={`arm-${side}`}
          ref={side < 0 ? leftArmRef : rightArmRef}
          position={[side * shoulderWidth, 1.82, 0]}
        >
          <mesh castShadow position={[0, -0.045, 0]} scale={[1.08, 0.82, 0.95]}>
            <sphereGeometry args={[0.125, 9, 7]} />
            <meshStandardMaterial color={armoredShoulder ? palette.metal : palette.cloth} metalness={armoredShoulder ? 0.42 : 0.04} roughness={0.67} />
          </mesh>
          <mesh castShadow position={[0, -0.25, 0]}>
            <capsuleGeometry args={[0.085, 0.3, 4, 8]} />
            <meshStandardMaterial color={palette.cloth} roughness={0.86} />
          </mesh>
          <mesh castShadow position={[0, -0.5, 0]}><sphereGeometry args={[0.085, 8, 6]} /><meshStandardMaterial color={palette.leather} roughness={0.88} /></mesh>
          <mesh castShadow position={[0, -0.7, 0.015]}><capsuleGeometry args={[0.073, 0.28, 4, 8]} /><meshStandardMaterial color={palette.leather} roughness={0.88} /></mesh>
          <group position={[0, -0.98, 0.035]}>
            <mesh castShadow scale={[1.05, 1.15, 0.82]}><capsuleGeometry args={[0.062, 0.09, 4, 7]} /><meshStandardMaterial color={gloveColor} roughness={0.94} /></mesh>
            {[-0.038, 0, 0.038].map((x) => (
              <mesh key={x} castShadow position={[x, -0.105, 0.015]}><capsuleGeometry args={[0.014, 0.075, 3, 5]} /><meshStandardMaterial color={gloveColor} roughness={0.95} /></mesh>
            ))}
          </group>
          <HeldEquipment role={role} palette={palette} side={side} weaponEquipped={weaponEquipped} />
        </group>
      ))}
      {([-1, 1] as const).map((side) => (
        <group
          key={`leg-${side}`}
          ref={side < 0 ? leftLegRef : rightLegRef}
          position={[side * 0.16, 1.13, 0]}
        >
          <mesh castShadow position={[0, -0.25, 0]}><capsuleGeometry args={[0.105, 0.34, 4, 8]} /><meshStandardMaterial color={palette.cloth} roughness={0.92} /></mesh>
          <mesh castShadow position={[0, -0.55, 0.015]}><sphereGeometry args={[0.1, 8, 6]} /><meshStandardMaterial color={palette.leather} roughness={0.92} /></mesh>
          <mesh castShadow position={[0, -0.78, 0]}><capsuleGeometry args={[0.09, 0.34, 4, 8]} /><meshStandardMaterial color={palette.leather} roughness={0.94} /></mesh>
          <mesh castShadow position={[0, -1.035, 0.095]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.09, 0.18, 4, 8]} /><meshStandardMaterial color="#242321" roughness={0.97} /></mesh>
          {(isVanguard || isBlacksmith) && <mesh position={[0, -0.55, 0.09]}><boxGeometry args={[0.14, 0.15, 0.035]} /><meshStandardMaterial color={palette.metal} metalness={0.4} roughness={0.58} /></mesh>}
        </group>
      ))}
    </group>
  );
}

function TownHero({
  classId,
  rootRef,
  movingRef,
  weaponEquipped,
}: {
  classId: CharacterClassId;
  rootRef: MutableRefObject<THREE.Group | null>;
  movingRef: MutableRefObject<boolean>;
  weaponEquipped: boolean;
}) {
  const leftLeg = useRef<THREE.Group | null>(null);
  const rightLeg = useRef<THREE.Group | null>(null);
  const leftArm = useRef<THREE.Group | null>(null);
  const rightArm = useRef<THREE.Group | null>(null);
  const palette = HERO_COLORS[classId];
  const bodyPalette: TownHumanoidPalette = {
    ...palette,
    leather: classId === 'ranger' ? '#493728' : '#3b302a',
    skin: classId === 'mystic' ? '#a87562' : '#b38165',
    hair: classId === 'vanguard' ? '#33251f' : '#292723',
  };

  useFrame(({ clock }) => {
    const phase = clock.elapsedTime * (movingRef.current ? 9 : 2.1);
    const stride = movingRef.current ? Math.sin(phase) * 0.62 : Math.sin(phase) * 0.035;
    if (leftLeg.current) leftLeg.current.rotation.x = stride;
    if (rightLeg.current) rightLeg.current.rotation.x = -stride;
    if (leftArm.current) leftArm.current.rotation.x = -stride * 0.7;
    if (rightArm.current) rightArm.current.rotation.x = stride * 0.7;
    if (rootRef.current) rootRef.current.position.y = movingRef.current ? Math.abs(Math.sin(phase)) * 0.035 : Math.sin(phase) * 0.018;
  });

  return (
    <group ref={rootRef} position={[0, 0, 3.8]}>
      <TownHumanoid
        role={classId}
        palette={bodyPalette}
        leftArmRef={leftArm}
        rightArmRef={rightArm}
        leftLegRef={leftLeg}
        rightLegRef={rightLeg}
        weaponEquipped={weaponEquipped}
      />
    </group>
  );
}

function TownNpc({
  placement,
  onApproach,
}: {
  placement: ServicePlacement;
  onApproach: (placement: ServicePlacement) => void;
}) {
  const root = useRef<THREE.Group | null>(null);
  const leftLeg = useRef<THREE.Group | null>(null);
  const rightLeg = useRef<THREE.Group | null>(null);
  const leftArm = useRef<THREE.Group | null>(null);
  const rightArm = useRef<THREE.Group | null>(null);
  const definition = TOWN_SERVICE_DEFINITIONS.find((service) => service.id === placement.id)!;
  useFrame(({ clock }) => {
    const phase = clock.elapsedTime * 1.35 + placement.position[0];
    if (root.current) root.current.position.y = Math.sin(phase) * 0.012;
    if (leftArm.current) leftArm.current.rotation.x = Math.sin(phase * 0.72) * 0.025;
    if (rightArm.current) rightArm.current.rotation.x = -Math.sin(phase * 0.72) * 0.025;
    if (leftLeg.current) leftLeg.current.rotation.x = Math.sin(phase * 0.55) * 0.008;
    if (rightLeg.current) rightLeg.current.rotation.x = -Math.sin(phase * 0.55) * 0.008;
  });
  const interactive = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onApproach(placement);
  };
  if (placement.id === 'stash') {
    return (
      <group position={placement.position} onClick={interactive} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
        <group ref={root} position={[-0.58, 0, 0.12]} rotation={[0, 0.15, 0]}>
          <TownHumanoid
            role="stash"
            palette={NPC_COLORS.stash}
            leftArmRef={leftArm}
            rightArmRef={rightArm}
            leftLegRef={leftLeg}
            rightLegRef={rightLeg}
          />
        </group>
        <group position={[0.62, 0, -0.02]}>
          <mesh castShadow position={[0, 0.37, 0]}>
            <boxGeometry args={[1.02, 0.66, 0.72]} />
            <meshStandardMaterial color="#40372f" roughness={0.94} />
          </mesh>
          <mesh castShadow position={[0, 0.74, -0.02]} scale={[1, 0.58, 1]}>
            <cylinderGeometry args={[0.37, 0.37, 1.02, 10, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color={placement.color} roughness={0.92} />
          </mesh>
          {[-0.32, 0.32].map((x) => (
            <mesh key={x} castShadow position={[x, 0.5, 0.37]}><boxGeometry args={[0.075, 0.82, 0.045]} /><meshStandardMaterial color="#5b554b" metalness={0.54} roughness={0.5} /></mesh>
          ))}
          <mesh castShadow position={[0, 0.54, 0.39]}>
            <boxGeometry args={[0.16, 0.2, 0.07]} />
            <meshStandardMaterial color="#8b744a" metalness={0.67} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.515, 0.435]}><circleGeometry args={[0.025, 8]} /><meshStandardMaterial color="#171713" roughness={0.72} /></mesh>
        </group>
        <Html center position={[0, 2.85, 0]}><div className={styles.serviceLabel}>{definition.name}<span>{definition.role}</span></div></Html>
      </group>
    );
  }
  if (placement.id === 'waypoint') {
    return (
      <group position={placement.position} onClick={interactive} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
        <mesh castShadow position={[-1.2, 1.55, 0]}>
          <boxGeometry args={[0.55, 3.1, 0.7]} />
          <meshStandardMaterial color="#5c554a" roughness={0.95} />
        </mesh>
        <mesh castShadow position={[1.2, 1.55, 0]}>
          <boxGeometry args={[0.55, 3.1, 0.7]} />
          <meshStandardMaterial color="#5c554a" roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 3.05, 0]}>
          <boxGeometry args={[2.9, 0.52, 0.72]} />
          <meshStandardMaterial color="#5c554a" roughness={0.95} />
        </mesh>
        <mesh position={[0, 1.5, 0.05]}>
          <planeGeometry args={[1.85, 2.45]} />
          <meshBasicMaterial color="#caa554" transparent opacity={0.15} side={THREE.DoubleSide} />
        </mesh>
        <Html center position={[0, 3.75, 0]}><div className={styles.serviceLabel}>{definition.name}<span>{definition.role}</span></div></Html>
      </group>
    );
  }
  return (
    <group ref={root} position={placement.position} onClick={interactive} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      <TownHumanoid
        role={placement.id}
        palette={NPC_COLORS[placement.id]}
        leftArmRef={leftArm}
        rightArmRef={rightArm}
        leftLegRef={leftLeg}
        rightLegRef={rightLeg}
      />
      <Html center position={[0, 2.85, 0]}><div className={styles.serviceLabel}>{definition.name}<span>{definition.role}</span></div></Html>
    </group>
  );
}

function TownBuildings() {
  return (
    <group>
      {[
        [-7.5, -1.5, 3.9, 4.4, '#3f382f'],
        [7.4, -1.1, 4.3, 4.8, '#463830'],
        [-6.2, -6.2, 3.2, 3.6, '#3a3b35'],
        [6.5, -6.2, 3.1, 3.8, '#42382f'],
      ].map(([x, z, width, depth, color], index) => (
        <group key={`building-${index}`} position={[x as number, 0, z as number]}>
          <mesh castShadow receiveShadow position={[0, 1.45, 0]}>
            <boxGeometry args={[width as number, 2.9, depth as number]} />
            <meshStandardMaterial color={color as string} roughness={0.92} />
          </mesh>
          <mesh castShadow position={[0, 3.25, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[(width as number) * 0.78, 1.8, 4]} />
            <meshStandardMaterial color="#282724" roughness={0.96} />
          </mesh>
        </group>
      ))}
      <mesh castShadow receiveShadow position={[5.1, 0.55, 1.8]}>
        <boxGeometry args={[1.65, 1.1, 0.8]} />
        <meshStandardMaterial color="#393631" metalness={0.22} roughness={0.78} />
      </mesh>
      <pointLight color="#e0793d" intensity={2.2} distance={5.5} position={[5.1, 1.8, 1.8]} />
      <mesh position={[5.1, 1.08, 1.8]}>
        <dodecahedronGeometry args={[0.24, 0]} />
        <meshStandardMaterial color="#e2763a" emissive="#e2763a" emissiveIntensity={3} />
      </mesh>
      <mesh receiveShadow castShadow position={[0, 0.42, 0.4]}>
        <cylinderGeometry args={[1.05, 1.18, 0.82, 14]} />
        <meshStandardMaterial color="#5b5b52" roughness={0.96} />
      </mesh>
      <mesh position={[0, 0.86, 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.78, 16]} />
        <meshStandardMaterial color="#24464f" metalness={0.08} roughness={0.38} />
      </mesh>
    </group>
  );
}

function TownScene({
  classId,
  weaponEquipped,
  heldDirections,
  onSelectService,
}: {
  classId: CharacterClassId;
  weaponEquipped: boolean;
  heldDirections: MutableRefObject<Set<MoveDirection>>;
  onSelectService: (service: TownServiceId) => void;
}) {
  const { camera } = useThree();
  const hero = useRef<THREE.Group | null>(null);
  const moving = useRef(false);
  const target = useRef(new THREE.Vector3(0, 0, 3.8));
  const cameraTarget = useRef(new THREE.Vector3());
  const pendingService = useRef<TownServiceId | null>(null);
  const callbackRef = useRef(onSelectService);
  callbackRef.current = onSelectService;

  useFrame((_, delta) => {
    const root = hero.current;
    if (!root) return;
    const horizontal = Number(heldDirections.current.has('right')) - Number(heldDirections.current.has('left'));
    const vertical = Number(heldDirections.current.has('down')) - Number(heldDirections.current.has('up'));
    const keyboardLength = Math.hypot(horizontal, vertical);
    let moveX = horizontal;
    let moveZ = vertical;
    if (keyboardLength > 0) {
      moveX /= keyboardLength;
      moveZ /= keyboardLength;
      target.current.set(root.position.x, 0, root.position.z);
      pendingService.current = null;
    } else {
      const dx = target.current.x - root.position.x;
      const dz = target.current.z - root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.08) {
        moveX = dx / distance;
        moveZ = dz / distance;
      } else {
        moveX = 0;
        moveZ = 0;
        if (pendingService.current) {
          const service = pendingService.current;
          pendingService.current = null;
          callbackRef.current(service);
        }
      }
    }
    moving.current = Math.abs(moveX) + Math.abs(moveZ) > 0.01;
    if (moving.current) {
      const step = Math.min(4.6 * delta, Math.hypot(target.current.x - root.position.x, target.current.z - root.position.z) || 4.6 * delta);
      root.position.x = clamp(root.position.x + moveX * step, -8.7, 8.7);
      root.position.z = clamp(root.position.z + moveZ * step, -7.2, 7.4);
      root.rotation.y = Math.atan2(moveX, moveZ);
    }
    cameraTarget.current.set(root.position.x + 8.2, 10.5, root.position.z + 8.2);
    camera.position.lerp(cameraTarget.current, 1 - Math.exp(-delta * 5.8));
    camera.lookAt(root.position.x, 0.55, root.position.z);
  });

  const walkToGround = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    pendingService.current = null;
    target.current.set(clamp(event.point.x, -8.7, 8.7), 0, clamp(event.point.z, -7.2, 7.4));
  };
  const approachService = (placement: ServicePlacement) => {
    target.current.set(...placement.approach);
    pendingService.current = placement.id;
  };

  return (
    <>
      <color attach="background" args={['#11130f']} />
      <fog attach="fog" args={['#11130f', 14, 32]} />
      <ambientLight intensity={0.82} color="#d7d0b8" />
      <directionalLight castShadow intensity={2.1} color="#f0d89a" position={[6, 11, 5]} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <hemisphereLight args={['#718c80', '#272218', 0.8]} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} onPointerDown={walkToGround}>
        <planeGeometry args={[22, 20]} />
        <meshStandardMaterial color="#4f5143" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, -2.2]} onPointerDown={walkToGround}>
        <planeGeometry args={[3.6, 16]} />
        <meshStandardMaterial color="#756448" roughness={0.98} />
      </mesh>
      <TownBuildings />
      {SERVICE_PLACEMENTS.map((placement) => <TownNpc key={placement.id} placement={placement} onApproach={approachService} />)}
      <TownHero classId={classId} rootRef={hero} movingRef={moving} weaponEquipped={weaponEquipped} />
    </>
  );
}

export default function AdventureTownHub3D({
  classId,
  playerName,
  townName,
  weaponEquipped,
  onSelectService,
}: AdventureTownHub3DProps) {
  const heldDirections = useRef(new Set<MoveDirection>());
  useEffect(() => {
    const keyMap: Record<string, MoveDirection> = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    };
    const down = (event: KeyboardEvent) => {
      const direction = keyMap[event.code];
      if (!direction) return;
      heldDirections.current.add(direction);
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      const direction = keyMap[event.code];
      if (direction) heldDirections.current.delete(direction);
    };
    const clear = () => heldDirections.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      document.body.style.cursor = '';
    };
  }, []);

  const setDirection = (direction: MoveDirection, pressed: boolean) => {
    if (pressed) heldDirections.current.add(direction);
    else heldDirections.current.delete(direction);
  };

  return (
    <section className={styles.shell} data-testid="adventure-town-hub" aria-label={`${townName} 마을` }>
      <div className={styles.canvas}>
        <Canvas shadows="basic" orthographic camera={{ position: [8.2, 10.5, 12], zoom: 48, near: 0.1, far: 80 }} dpr={[1, 1.5]}>
          <TownScene classId={classId} weaponEquipped={weaponEquipped} heldDirections={heldDirections} onSelectService={onSelectService} />
        </Canvas>
      </div>
      <div className={styles.hint}>{townName} · {playerName}</div>
      <div className={styles.directionPad} aria-label="마을 이동 조작">
        {([
          ['up', styles.up, ArrowUp, '위 이동'],
          ['left', styles.left, ArrowLeft, '왼쪽 이동'],
          ['right', styles.right, ArrowRight, '오른쪽 이동'],
          ['down', styles.down, ArrowDown, '아래 이동'],
        ] as const).map(([direction, positionClass, Icon, label]) => (
          <button
            key={direction}
            type="button"
            className={`${styles.directionButton} ${positionClass}`}
            aria-label={label}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDirection(direction, true);
            }}
            onPointerUp={() => setDirection(direction, false)}
            onPointerCancel={() => setDirection(direction, false)}
          >
            <Icon size={20} />
          </button>
        ))}
      </div>
    </section>
  );
}
