import { Droplets, FlaskConical, Mountain, Package, Sprout, Wrench } from 'lucide-react';

export const EXPENSE_CATEGORIES = [
  { value: 'seeds', label: 'Seeds', icon: Sprout },
  { value: 'soil', label: 'Soil', icon: Mountain },
  { value: 'tools', label: 'Tools', icon: Wrench },
  { value: 'water', label: 'Water', icon: Droplets },
  { value: 'fertilizer', label: 'Fertilizer', icon: FlaskConical },
  { value: 'other', label: 'Other', icon: Package },
];

export const categoryMeta = (value) =>
  EXPENSE_CATEGORIES.find((c) => c.value === value) ?? EXPENSE_CATEGORIES.at(-1);

export const PLANT_STATUSES = [
  { value: 'planted', label: 'Planted' },
  { value: 'growing', label: 'Growing' },
  { value: 'harvested', label: 'Harvested' },
  { value: 'removed', label: 'Removed' },
];

export const isActiveStatus = (status) => status === 'planted' || status === 'growing';
