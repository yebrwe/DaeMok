import {
  Activity,
  BadgeHelp,
  Beef,
  BowArrow,
  Bug,
  Clover,
  Crown,
  Droplet,
  Flame,
  FlameKindling,
  Gem,
  Landmark,
  Mountain,
  PawPrint,
  Shield,
  Shirt,
  Sparkles,
  Sprout,
  Sun,
  Sword,
  Swords,
  TreePine,
  Trees,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'badge-flame': Flame,
  beef: Beef,
  'bow-arrow': BowArrow,
  bug: Bug,
  clover: Clover,
  crown: Crown,
  droplet: Droplet,
  flame: Flame,
  'flame-kindling': FlameKindling,
  gem: Gem,
  landmark: Landmark,
  mountain: Mountain,
  'paw-print': PawPrint,
  shield: Shield,
  shirt: Shirt,
  sparkles: Sparkles,
  sprout: Sprout,
  sun: Sun,
  sword: Sword,
  swords: Swords,
  'tree-pine': TreePine,
  trees: Trees,
  volcano: Flame,
  'wand-sparkles': WandSparkles,
};

interface AdventureIconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export default function AdventureIcon({ name, size = 20, strokeWidth = 1.8, className }: AdventureIconProps) {
  const Icon = ICONS[name] ?? BadgeHelp;
  return <Icon aria-hidden="true" className={className} size={size} strokeWidth={strokeWidth} />;
}
