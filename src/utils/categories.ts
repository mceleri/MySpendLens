import {
  LucideIcon,
  ShoppingCart,
  UtensilsCrossed,
  Car,
  HeartPulse,
  ShoppingBag,
  Zap,
  HelpCircle,
  ArrowDownLeft,
  Coffee,
  Plane,
  Dumbbell,
  PawPrint,
  Film,
  BookOpen,
  Smartphone,
  Home,
  Gift,
  Tag,
  GraduationCap,
  Music,
  ShieldCheck,
} from 'lucide-react';

export interface CategoryMeta {
  name: string;
  label: string;
  labelIt: string; // for compatibility
  color: string;
  bgLight: string;
  borderLight: string;
  badgeClass: string;
  icon: LucideIcon;
  examples: string;
}

export interface CategoryDefinition {
  id: string;
  name: string;
  color: string;
  iconName: string;
  examples: string;
  isSystem?: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt?: number;
}

export const AVAILABLE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  ShoppingCart,
  UtensilsCrossed,
  Car,
  HeartPulse,
  ShoppingBag,
  Zap,
  ArrowDownLeft,
  Coffee,
  Plane,
  Dumbbell,
  PawPrint,
  Film,
  BookOpen,
  Smartphone,
  Home,
  Gift,
  Tag,
  GraduationCap,
  Music,
  ShieldCheck,
  HelpCircle,
};

export const PRESET_CATEGORY_COLORS = [
  '#3b82f6', // Royal Blue
  '#10b981', // Emerald Green
  '#f97316', // Tangerine Orange
  '#ef4444', // Crimson Red
  '#a855f7', // Purple
  '#eab308', // Amber Gold
  '#06b6d4', // Cyan Sky
  '#ec4899', // Hot Pink
  '#b45309', // Terracotta Bronze
  '#4338ca', // Deep Indigo
  '#9f1239', // Wine Burgundy
  '#64748b', // Slate Gray
];

export function resolveCategoryIcon(iconName?: string): LucideIcon {
  if (!iconName) return HelpCircle;
  return AVAILABLE_CATEGORY_ICONS[iconName] || HelpCircle;
}

export const DEFAULT_CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: 'groceries',
    name: 'Groceries',
    color: '#10b981',
    iconName: 'ShoppingCart',
    examples: 'spesa alimentare al supermercato, ipermercato, prodotti alimentari, market, cibo, Esselunga, Mercadona, Conad, Carrefour, Coop, Lidl, alimentari',
    isActive: true,
    createdAt: 1,
  },
  {
    id: 'dining-out',
    name: 'Dining Out',
    color: '#f97316',
    iconName: 'UtensilsCrossed',
    examples: 'ristorante, cena fuori, pranzo al ristorante, pizzeria, trattoria, bar, caffetteria, McDonald, Burger King, 100 Montaditos, fast food, aperitivo, pub',
    isActive: true,
    createdAt: 2,
  },
  {
    id: 'transport-auto',
    name: 'Transport & Auto',
    color: '#06b6d4',
    iconName: 'Car',
    examples: 'rifornimento carburante, benzina, diesel, stazione di servizio, Repsol, Eni Station, Q8, IP, biglietto treno Trenitalia, Renfe, metro, pedaggio Telepass, taxi',
    isActive: true,
    createdAt: 3,
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    color: '#ef4444',
    iconName: 'HeartPulse',
    examples: 'farmacia, acquisto medicinali, farmaci, prodotti sanitari, parafarmacia, dottore, clinica medica, esami del sangue, dentista, salute, ottica',
    isActive: true,
    createdAt: 4,
  },
  {
    id: 'shopping',
    name: 'Shopping',
    color: '#a855f7',
    iconName: 'ShoppingBag',
    examples: 'shopping abbigliamento, vestiti, scarpe, Zara, Mango, Decathlon abbigliamento sportivo, Sephora profumeria make up, acquisti moda, elettronica, MediaWorld, Amazon',
    isActive: true,
    createdAt: 5,
  },
  {
    id: 'utilities',
    name: 'Utilities',
    color: '#eab308',
    iconName: 'Zap',
    examples: 'bolletta utenze domestiche, fornitura energia elettrica e gas, Enel Energia, Iberdrola, A2A, Naturgy, Edison, canone telefono fibra TIM Vodafone',
    isActive: true,
    createdAt: 6,
  },
  {
    id: 'income',
    name: 'Income',
    color: '#22c55e',
    iconName: 'ArrowDownLeft',
    examples: 'stipendio, accredito bonifico in entrata, rimborso, dividendi, accredito contanti',
    isSystem: true,
    isActive: true,
    createdAt: 7,
  },
];

export const CATEGORIES_META: Record<string, CategoryMeta> = {
  Groceries: {
    name: 'Groceries',
    label: 'Groceries',
    labelIt: 'Groceries',
    color: '#10b981',
    bgLight: 'rgba(16, 185, 129, 0.12)',
    borderLight: 'rgba(16, 185, 129, 0.3)',
    badgeClass: 'category-groceries',
    icon: ShoppingCart,
    examples: 'Esselunga, Mercadona, Conad, Carrefour, Lidl, Coop',
  },
  'Dining Out': {
    name: 'Dining Out',
    label: 'Dining Out',
    labelIt: 'Dining Out',
    color: '#f97316',
    bgLight: 'rgba(249, 115, 22, 0.12)',
    borderLight: 'rgba(249, 115, 22, 0.3)',
    badgeClass: 'category-dining',
    icon: UtensilsCrossed,
    examples: '100 Montaditos, McDonald\'s, La Piadineria, Pizzerias, Bars',
  },
  'Transport & Auto': {
    name: 'Transport & Auto',
    label: 'Transport & Auto',
    labelIt: 'Transport & Auto',
    color: '#06b6d4',
    bgLight: 'rgba(6, 182, 212, 0.12)',
    borderLight: 'rgba(6, 182, 212, 0.3)',
    badgeClass: 'category-transport',
    icon: Car,
    examples: 'Repsol, Eni Station, Trenitalia, Renfe, Tolls, Subway',
  },
  Healthcare: {
    name: 'Healthcare',
    label: 'Healthcare',
    labelIt: 'Healthcare',
    color: '#ef4444',
    bgLight: 'rgba(239, 68, 68, 0.12)',
    borderLight: 'rgba(239, 68, 68, 0.3)',
    badgeClass: 'category-healthcare',
    icon: HeartPulse,
    examples: 'Pharmacies, Medical clinics, Labs, Dentists, Opticians',
  },
  Shopping: {
    name: 'Shopping',
    label: 'Shopping',
    labelIt: 'Shopping',
    color: '#a855f7',
    bgLight: 'rgba(168, 85, 247, 0.12)',
    borderLight: 'rgba(168, 85, 247, 0.3)',
    badgeClass: 'category-shopping',
    icon: ShoppingBag,
    examples: 'Zara, Mango, Decathlon, Sephora, MediaWorld, Amazon',
  },
  Utilities: {
    name: 'Utilities',
    label: 'Utilities',
    labelIt: 'Utilities',
    color: '#eab308',
    bgLight: 'rgba(234, 179, 8, 0.12)',
    borderLight: 'rgba(234, 179, 8, 0.3)',
    badgeClass: 'category-utilities',
    icon: Zap,
    examples: 'Electricity, Gas, Water, Telecom, Internet & Mobile',
  },
  Income: {
    name: 'Income',
    label: 'Income',
    labelIt: 'Income',
    color: '#22c55e',
    bgLight: 'rgba(34, 197, 94, 0.12)',
    borderLight: 'rgba(34, 197, 94, 0.3)',
    badgeClass: 'category-income',
    icon: ArrowDownLeft,
    examples: 'Salary, Transfers, Refunds, Dividends, Cash deposits',
  },
};

export const EXPENSE_CATEGORIES = [
  'Groceries',
  'Dining Out',
  'Transport & Auto',
  'Healthcare',
  'Shopping',
  'Utilities',
] as const;

export const ALL_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  'Income',
] as const;

let dynamicCategoryRegistry: Record<string, CategoryMeta> = { ...CATEGORIES_META };

export function registerDynamicCategories(defs: CategoryDefinition[]): void {
  const map: Record<string, CategoryMeta> = {};
  for (const def of defs) {
    const icon = resolveCategoryIcon(def.iconName);
    map[def.name] = {
      name: def.name,
      label: def.name,
      labelIt: def.name,
      color: def.color,
      bgLight: `${def.color}1f`,
      borderLight: `${def.color}4d`,
      badgeClass: `category-${def.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      icon,
      examples: def.examples || '',
    };
  }
  dynamicCategoryRegistry = map;
}

export function getCategoryMeta(categoryName: string): CategoryMeta {
  if (dynamicCategoryRegistry[categoryName]) {
    return dynamicCategoryRegistry[categoryName];
  }
  if (CATEGORIES_META[categoryName]) {
    return CATEGORIES_META[categoryName];
  }
  return {
    name: categoryName,
    label: categoryName,
    labelIt: categoryName,
    color: '#64748b',
    bgLight: 'rgba(100, 116, 139, 0.12)',
    borderLight: 'rgba(100, 116, 139, 0.3)',
    badgeClass: 'category-other',
    icon: HelpCircle,
    examples: 'Custom category',
  };
}

export function getConfidenceBadgeClass(confidence: number): {
  color: string;
  label: string;
  bg: string;
  border: string;
} {
  if (confidence >= 0.8) {
    return {
      color: '#10b981',
      label: 'High',
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.25)',
    };
  }
  if (confidence >= 0.5) {
    return {
      color: '#f59e0b',
      label: 'Medium',
      bg: 'rgba(245, 158, 11, 0.12)',
      border: 'rgba(245, 158, 11, 0.25)',
    };
  }
  return {
    color: '#f43f5e',
    label: 'Low',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.25)',
  };
}
