/**
 * The options a customer picked on a dish, checked against the stored menu (S10).
 *
 * Quote, checkout and reorder each walked the selections on their own and
 * silently skipped anything they did not recognise. So an unknown option id
 * vanished from the bill without a word, the same option could be sent ten
 * times, a "choose one" group took three, and a required group could be left
 * out. Worst, a stored NEGATIVE price change ("Half plate −₹80") was added
 * once per repeat to the kitchen's share while the customer's price ignored
 * it, so repeating it moved money on every order.
 *
 * One function now decides, and the three paths call it:
 *   - an unknown group or option is refused (the dish changed: add it again)
 *   - the same option twice is refused
 *   - a group takes no more than its maximum
 *   - a required group with nothing picked takes its CHEAPEST option when it
 *     is a single choice (the dish's base price, so no money moves; the
 *     kitchen still sees which size), and is refused otherwise
 *   - a negative price change counts as zero; they are refused at menu time
 */
import { AppError } from '../../utils/AppError.ts';

export interface OptionSelection {
  groupId: string;
  optionId: string;
}

export interface ResolvedOption {
  groupId: string;
  groupTitle: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
  /** True when the customer picked nothing and the cheapest choice was used. */
  defaulted?: boolean;
}

export function resolveDishOptions(
  dish: { name: string; optionGroups?: any[] },
  selections: OptionSelection[] | undefined
): { options: ResolvedOption[]; addonsTotal: number } {
  const groups: any[] = dish.optionGroups || [];
  const picked = selections || [];
  const options: ResolvedOption[] = [];
  const seen = new Set<string>();

  for (const sel of picked) {
    const group = groups.find(g => g.id === sel.groupId);
    const opt = group?.options?.find((o: any) => o.id === sel.optionId);
    if (!group || !opt) {
      throw new AppError(
        `"${dish.name}" has changed since it was added. Remove it from the cart and add it again.`,
        400,
        'UNKNOWN_OPTION'
      );
    }
    const key = `${group.id}:${opt.id}`;
    if (seen.has(key)) {
      throw new AppError(`"${opt.name}" was chosen twice on "${dish.name}".`, 400, 'DUPLICATE_OPTION');
    }
    seen.add(key);
    options.push({
      groupId: group.id,
      groupTitle: group.title,
      optionId: opt.id,
      optionName: opt.name,
      priceDelta: Math.max(0, Number(opt.priceDelta) || 0)
    });
  }

  for (const group of groups) {
    const count = options.filter(o => o.groupId === group.id).length;
    const max = Number(group.maxSelections) || 0;
    if (max > 0 && count > max) {
      throw new AppError(
        `Choose at most ${max} in "${group.title}" on "${dish.name}".`,
        400,
        'TOO_MANY_OPTIONS'
      );
    }
    const min = Math.max(Number(group.minSelections) || 0, group.isRequired ? 1 : 0);
    if (count >= min) continue;

    const choices: any[] = group.options || [];
    if (count === 0 && min === 1 && choices.length > 0) {
      const cheapest = choices.reduce((a, b) =>
        (Number(b.priceDelta) || 0) < (Number(a.priceDelta) || 0) ? b : a
      );
      options.push({
        groupId: group.id,
        groupTitle: group.title,
        optionId: cheapest.id,
        optionName: cheapest.name,
        priceDelta: Math.max(0, Number(cheapest.priceDelta) || 0),
        defaulted: true
      });
      continue;
    }
    throw new AppError(`Choose ${min} in "${group.title}" on "${dish.name}".`, 400, 'OPTION_REQUIRED');
  }

  const addonsTotal = Math.round(options.reduce((t, o) => t + o.priceDelta, 0) * 100) / 100;
  return { options, addonsTotal };
}

/* ------------------------------------------------------------------------ *
 *  F05: what a partner types, turned into option groups at approval.      *
 * ------------------------------------------------------------------------ */

export interface PartnerChoice {
  name: string;
  price: number;
}

/**
 * The partner types each size's REAL price ("Half 120, Full 200") and each
 * extra's price. The cheapest size becomes the dish price and the others
 * positive price changes on a required single choice, so the markup, the
 * kitchen's share and our margin all price the same way they do for a plain
 * dish. No negative change can come out of this.
 *
 * `undefined` leaves a dish's groups alone (an edit that does not touch
 * them); an empty list removes that group.
 */
export function optionGroupsFromChoices(
  input: { sizes?: PartnerChoice[]; extras?: PartnerChoice[] },
  existing: any[] = []
): { price?: number; optionGroups?: any[] } {
  if (input.sizes === undefined && input.extras === undefined) return {};
  const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  // An edit keeps the ids of choices it keeps (matched by name), so a customer
  // with the dish already in their cart is not refused for nothing.
  const reuse = (group: any, name: string, prefix: string) =>
    group?.options?.find((o: any) => String(o.name).toLowerCase() === name.toLowerCase())?.id || id(prefix);

  const keptSize = existing.find(g => g.kind === 'SIZE');
  const keptExtras = existing.find(g => g.kind === 'EXTRAS');
  const groups: any[] = [];
  let price: number | undefined;

  const sizes = input.sizes === undefined ? null : input.sizes;
  if (sizes && sizes.length > 0) {
    const sorted = [...sizes].sort((a, b) => a.price - b.price);
    price = sorted[0].price;
    groups.push({
      id: keptSize?.id || id('grp_size'),
      kind: 'SIZE',
      title: 'Choose a size',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      options: sorted.map(s => ({
        id: reuse(keptSize, s.name, 'opt'),
        name: s.name,
        priceDelta: Math.round((s.price - price!) * 100) / 100
      }))
    });
  } else if (sizes === null && keptSize) {
    groups.push(keptSize);
  }

  const extras = input.extras === undefined ? null : input.extras;
  if (extras && extras.length > 0) {
    groups.push({
      id: keptExtras?.id || id('grp_extra'),
      kind: 'EXTRAS',
      title: 'Add extras',
      isRequired: false,
      minSelections: 0,
      maxSelections: extras.length,
      options: extras.map(e => ({ id: reuse(keptExtras, e.name, 'opt'), name: e.name, priceDelta: e.price }))
    });
  } else if (extras === null && keptExtras) {
    groups.push(keptExtras);
  }

  /*
   * No option may LOWER a dish's price. The customer's price counts a negative
   * change as zero while the kitchen's share would subtract it, so a negative
   * option would price the two sides differently (and the current customer app
   * adds it raw in the cart). The request schema already refuses a price at or
   * below zero; this is the same rule where option groups are actually MADE,
   * so a request stored before that schema, or any future caller, cannot slip
   * one through.
   */
  for (const g of groups) {
    for (const o of g.options || []) {
      if (!(Number(o.priceDelta) >= 0)) {
        throw new AppError(
          `"${o.name}" would lower the dish's price. Every size and extra must cost at least as much as the dish.`,
          400,
          'NEGATIVE_OPTION_PRICE'
        );
      }
    }
  }

  // Groups made some other way (the seeded menus) are kept as they are.
  for (const g of existing) if (g.kind !== 'SIZE' && g.kind !== 'EXTRAS') groups.push(g);

  return { ...(price !== undefined ? { price } : {}), optionGroups: groups };
}
