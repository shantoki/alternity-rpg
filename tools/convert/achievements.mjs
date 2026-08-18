/**
 * @file tools/convert/achievements.mjs
 * @description `Achievement` records -> `achievementBenefit` Items.
 *
 * An achievement is priced per profession: the same +1 to Strength costs a Combat Spec
 * 10 points at level 3 and a Mindwalker 15 at level 9. `AchievementBenefitData` holds
 * one profession, one cost and one minimum level, so each achievement becomes one item
 * per profession that can actually buy it - 37 achievements x 5 professions.
 *
 * The source data reserves seven profession slots and leaves the last two permanently
 * at minimum level 99, which is its "never available" sentinel; only slots 0-4 are real,
 * and they run in the order the Player's Handbook prints the professions.
 */

import { makeItem, statBlock } from '../lib/fvtt.mjs';
import { readRecords, asArray, attr, int, str, bookLabel } from '../lib/source-data.mjs';

export const PACK = 'alternity-achievements';

/** `AchievementProf @ID` -> profession, in Player's Handbook order. */
const PROFESSIONS = ['Combat Spec', 'Diplomat', 'Free Agent', 'Tech Op', 'Mindwalker'];

/** The source data's "this profession can never buy it" sentinel. */
const NEVER_AVAILABLE = 99;

/** Achievement name -> `{benefitType, effectTarget, effectAbility}`. */
function classify(name) {
    const abilityIncrease = name.match(/^(STR|DEX|CON|INT|WIL|PER) Increase/i);
    if (abilityIncrease) {
        return {
            benefitType: 'Ability Score Increase',
            effectTarget: 'AbilityScore',
            effectAbility: abilityIncrease[1].toUpperCase(),
        };
    }

    const durability = name.match(/^(Stun|Wound|Mortal|Fatigue) Rating Increase$/i);
    if (durability) {
        const track = durability[1];
        return {
            benefitType: 'Durability Increase',
            effectTarget: `${track.charAt(0).toUpperCase()}${track.slice(1).toLowerCase()}Rating`,
            effectAbility: 'None',
        };
    }

    if (/^New Perk:/i.test(name)) {
        return { benefitType: 'New Perk', effectTarget: 'None', effectAbility: 'None' };
    }

    switch (name) {
        case 'Action Check Bonus':
            return { benefitType: 'Action Check Bonus', effectTarget: 'ActionCheckStep', effectAbility: 'None' };
        case 'Action Check Increase':
            return { benefitType: 'Action Check Increase', effectTarget: 'ActionCheckScore', effectAbility: 'None' };
        case 'Extra Action':
            return { benefitType: 'Extra Action', effectTarget: 'ActionsPerRound', effectAbility: 'None' };
        case 'Monetary Award':
            return { benefitType: 'Monetary Award', effectTarget: 'None', effectAbility: 'None' };
        case 'Remove Flaw':
            return { benefitType: 'Remove Flaw', effectTarget: 'None', effectAbility: 'None' };
        case 'Acquire Contact':
            return { benefitType: 'Acquire Contact', effectTarget: 'None', effectAbility: 'None' };
        default:
            return { benefitType: 'Ability Score Increase', effectTarget: 'None', effectAbility: 'None' };
    }
}

export function convert() {
    const records = readRecords('data/achieve.json', ['Achievements', 'Achievement']);
    const items = [];

    for (const record of records) {
        const achievement = str(attr(record, 'Name')) || 'Unnamed Achievement';
        const book = bookLabel(attr(record, 'Source'), record._sourceFile);
        const maxPurchases = int(attr(record, 'Max'), 1);
        const { benefitType, effectTarget, effectAbility } = classify(achievement);

        for (const entry of asArray(record.AchievementProf)) {
            const slot = int(attr(entry, 'ID'), -1);
            const profession = PROFESSIONS[slot];
            const minLevel = int(attr(entry, 'MinLevel'), NEVER_AVAILABLE);
            if (!profession || minLevel >= NEVER_AVAILABLE) continue;

            const cost = int(attr(entry, 'Price'), 0);
            const provenance = {
                book,
                sourceFile: record._sourceFile,
                achievement,
                profession,
                minLevel,
                cost,
                maxPurchases,
                folder: profession,
            };

            const description = statBlock([
                ['Benefit', benefitType],
                ['Profession', profession],
                ['Minimum level', minLevel],
                ['Cost', achievement === 'Remove Flaw'
                    ? 'Double the flaw&#39;s value'
                    : (cost ? `${cost} achievement points` : '')],
                ['Times purchasable', maxPurchases >= NEVER_AVAILABLE ? 'Unlimited' : maxPurchases],
                ['Source', book],
            ]);

            items.push(makeItem({
                pack: PACK,
                name: `${achievement} (${profession})`,
                type: 'achievementBenefit',
                img: 'icons/svg/lightning.svg',
                provenance,
                system: {
                    benefitType,
                    profession,
                    cost,
                    // The data prices Remove Flaw at 0 because the real price is a
                    // function of the flaw being removed, which the schema flags
                    // rather than stores.
                    costIsDoubleFlawValue: achievement === 'Remove Flaw',
                    minLevel: Math.max(1, minLevel),
                    maxPurchases,
                    timesPurchased: 0,
                    // The Monetary Award's level list (3/6/9/...) is printed in the
                    // Gamemaster Guide, not carried in this data.
                    allowedLevels: [],
                    onePerLevel: false,
                    effectTarget,
                    effectAbility,
                    effectValue: 1,
                    prerequisites: '',
                    description,
                },
            }));
        }
    }

    return items;
}
