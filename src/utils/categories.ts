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

export function getCategoryMeta(categoryName: string): CategoryMeta {
  return (
    CATEGORIES_META[categoryName] || {
      name: categoryName,
      label: categoryName,
      labelIt: categoryName,
      color: '#64748b',
      bgLight: 'rgba(100, 116, 139, 0.12)',
      borderLight: 'rgba(100, 116, 139, 0.3)',
      badgeClass: 'category-other',
      icon: HelpCircle,
      examples: 'Unmapped category',
    }
  );
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
