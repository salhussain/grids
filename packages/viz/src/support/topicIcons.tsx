import { BarChart3, Bug, CreditCard, Database, FileText, Globe2, Heart, HelpCircle, KeyRound, Lightbulb, Lock, Mail, Map as MapIcon, Settings2, ShieldCheck, Star, Tag, Users, Wrench } from 'lucide-react';
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';
import type { ComponentType } from 'react';

/** The icons a topic can wear (by name, as the help desk settings store them). */
export const TOPIC_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  question: HelpCircle,
  bug: Bug,
  wrench: Wrench,
  account: KeyRound,
  lock: Lock,
  idea: Lightbulb,
  billing: CreditCard,
  map: MapIcon,
  data: Database,
  chart: BarChart3,
  file: FileText,
  mail: Mail,
  security: ShieldCheck,
  settings: Settings2,
  people: Users,
  globe: Globe2,
  heart: Heart,
  star: Star,
  tag: Tag,
};
const custom = new Map<string, ComponentType<{ className?: string }>>();
/** Any icon of the full set, named `lucide:<name>` (it is fetched when first shown, so the page does not carry all of them). */
export function anyIcon(name: string): ComponentType<{ className?: string }> {
  let c = custom.get(name);
  if (!c) {
    c = ({ className }) => <DynamicIcon name={name as IconName} className={className} fallback={() => <span className={className} />} />;
    custom.set(name, c);
  }
  return c;
}
export const topicIcon = (icons: Record<string, string> | undefined, topic: string): ComponentType<{ className?: string }> => {
  const k = icons?.[topic] ?? '';
  return k.startsWith('lucide:') ? anyIcon(k.slice(7)) : (TOPIC_ICONS[k] ?? Tag);
};

let allIcons: Promise<Record<string, ComponentType<{ className?: string }>>> | null = null;
/** Every icon of the set, by its kebab-case name, fetched once (the picker needs them all drawn at the same time). */
export function loadAllIcons(): Promise<Record<string, ComponentType<{ className?: string }>>> {
  allIcons ??= import('lucide-react').then((m) => {
    const lib = m.icons as unknown as Record<string, ComponentType<{ className?: string }>>;
    const out: Record<string, ComponentType<{ className?: string }>> = {};
    for (const n of iconNames) {
      const Ic = lib[n.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')];
      if (Ic) out[n] = Ic;
    }
    return out;
  });
  return allIcons;
}
