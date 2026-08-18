# Alternity Character Sheet Roadmap

This document outlines the missing features and planned improvements for the Alternity Fastplay character sheet, based on the `Alternity_-_Fastplay_-_Core_-_Player_Rules.pdf`.

## Phase 1: Missing Derived Stats & Data Model Alignment
These are core mechanics that should be automated in the data layer and displayed on the sheet.

- [x] **Resistance Modifiers**: Implement calculation for STR, DEX, INT, and WIL.
    - Player's Handbook Table P2 (transcribed from the printed table, 2026-08-15):
      4 or less: −2, 5-6: −1, 7-10: 0, 11-12: +1, 13-14: +2, 15-16: +3, 17-18: +4, 19+: +5.
    - This entry previously listed only "1-10: 0 / 11-12: +1 / 13-14: +2", which is the
      middle of the table — the negative bands and everything past +2 were missing.
      The bands above +2 are reachable once cybertech is in play (a cyberlimb and
      MusclePlus add up to +3 STR each).
    - CON and PER have no resistance modifier; the book is explicit that they are
      used actively instead.
- [x] **Untrained Scores**: Display `Ability / 2` (rounded down) next to each Ability score.
- [x] **Action Check Profession Bonus**: Automate the Marginal Action Check score.
    - Formula: `floor((DEX + INT) / 2) + Profession Bonus`; Marginal = Ordinary + 1,
      Good = half Ordinary, Amazing = a quarter (both rounded down).
    - Bonuses (Player's Handbook Ch.2 "Special Benefits", verified 2026-08-15):
      **Combat Spec +3, Free Agent +2, Diplomat +1, Tech Op +1.**
    - This entry previously said +4/+3/+2/+2, which is wrong — every value was one too
      high. `AlternityCharacterState.getActionCheckData()` has always used the correct
      numbers, checked against the book's own worked templates (e.g. DEX 11 / INT 9
      Combat Spec → Marginal 14+, Ordinary 13, Good 6, Amazing 3).
- [x] **Actions per Round**: Calculate and display this stat (Fastplay default is 2, but should be derived from CON/WIL for future-proofing).
- [x] **Secondary Damage Refinement**: Ensure `applyDamage` perfectly matches the 2:1 conversion rules and trigger UI updates.

## Phase 2: UI & UX Enhancements
Improve the layout and interactivity of the sheet.

- [x] **Dedicated Background Field**: Add a narrative section in the Header or a "Character" tab to match the template.
- [x] **Armor Die Ranges**: Update the Armor section to support die ranges (e.g., `d6-1`) instead of just flat numbers.
- [x] **Dazed Effect Visualization**: Highlight the +1 step penalty per mortal box in the UI.
- [ ] **Action Check Phasing UI**: Add a tracker or visual aid for the Amazing/Good/Ordinary/Marginal phases during combat.
- [x] **Profession & Career Selection**: Use a dropdown or similar for professions to automate bonuses.

## Phase 3: Advanced Automation & Integration
- [x] **Armor Mitigation in Rolls**: armour dice are rolled and subtracted. The Apply button
      on a damage card now rolls the target's protection for the form that hit
      (`AlternityRollService.rollArmorProtection`), applies the layering rule, and posts a
      mitigation card so the roll is visible rather than hidden inside the handler.
- [x] **Reconcile the two armour models**: there is now one model. `ArmorData` carries a
      `protection` `{li, hi, en}` triple of die ranges — the shape the book prints, and the
      same shape `CybertechData.armorProtection`, `CreatureData.naturalArmor` and
      `AlternityCharacterState.armor` already used. The flat `damageResistance` and its
      `resistedTypes` list are gone, migrated into `protection` (world migration v2).
      `armorBonus` — a d20 armour-class number that was being added to the wearer's
      resistance modifier, so every suit bought its wearer a dodge bonus — became
      `resistanceModifierBonus`, documented as being for the deflection harness and
      displacer softsuit only.
- [x] **Personal-scale firepower degrade**: armour, supporting cast and creatures carry a
      `toughness` grade (Ordinary/Good/Amazing), worn armour raises its wearer's, and the
      degrade runs *before* the armour roll and *before* secondary damage, as the Gamemaster
      Guide specifies. The Guide's three worked examples are asserted in the test suite.
- [ ] **Skill specialty highlighting**: Ensure specialty skills are visually distinct (italics as per PDF).
      Note the conflict to resolve first: italic is currently the *locked* style
      (`.alt-skill-item.is-locked`), and specialties are distinguished by indentation.
- [ ] **Quick Action Buttons**: Add buttons for common actions (Recovery, First Aid check).
- [ ] **Armor Operation stun absorption**: ranks in the Armor Operation specialty let a hero
      absorb stun points *including secondary* — the one place anything reduces secondary
      damage. It is a skill benefit rather than an armour property, so it was left out of the
      armour work above.

## Phase 4: Rolling from the sheets — done
Every sheet can now roll what it prints. The pipeline is:
`sheet action → AlternityRollComponent (the inline panel) → AlternityRollService →
AlternityMathService`, with the dice and the chat cards owned by the roll service and
all arithmetic owned by the math service.

- [x] **Skill checks** from the hero, creature, robot and AI sheets, and station
      checks from the spaceship sheet.
- [x] **Ability (feat) checks** — every ability label on every sheet is a roll button.
- [x] **Action Checks** — hero, supporting cast, creature, robot and AI, with the
      "an Action Check can never fail" rule and the Bad Luck Rule on a natural 20.
- [x] **Attacks** — the check rolls the weapon's *governing specialty*, and the degree
      it achieves picks which of three damage codes fires (PHB Ch.11). Weapons gained
      `damageOrdinary`/`damageGood`/`damageAmazing` to make this possible; the old
      single `damageFormula` is migrated into the Ordinary column.
- [x] **Defence** — an Acrobatics-dodge check whose degree is stored on the defender
      and spent by the next attack against them, plus the target's resistance modifier
      entering the attacker's check automatically when a token is targeted.
- [x] **Damage** — rolled at the achieved grade from the attack card, with the track
      read off the code's own `s`/`w`/`m` letter, and an Apply button that writes to
      the target's tracks (including secondary damage).
- [x] **The situation die is actually rolled.** It previously was not: modifiers were
      assembled after the dice were cast, so a wound penalty appeared in the trace and
      changed nothing. See the notes in `alt-mechanics.js` and `AlternityActor.rollSkill`.
- [x] **Damage forms are LI / HI / En.** `WeaponData`, `ArmorData`, `EffectData` and the
      effect-template class all carried a d20 list (Ballistic, Slashing, Piercing, Laser…).
      `applyAlternityDamage` compares a weapon's damage type against an armour's resisted
      types, so those two agreed with each other while neither could ever match the LI/HI/En
      ratings the sheets show and the rules use — armour mitigation was inert for every
      weapon in the system. Migrated via `LEGACY_DAMAGE_TYPE_MAP`, which logs each
      conversion: nothing in the old list means High Impact, so an armour-piercing weapon
      has to be re-marked by hand.
- [x] **Damage form and damage grade are separate axes.** `applyAlternityDamage` used to
      guess the track from the type by substring — `includes('s')` classified 'Ballistic'
      and 'Slashing' as *stun* damage. The grade now comes only from the damage code's own
      trailing s/w/m letter.

Not done, deliberately: the **vehicle** sheet has no roll buttons, because `VehicleData`
holds no skill, attack or action-check scores to roll — a vehicle is driven by a
character's own Vehicle Operation check. The **warship** sheet rolls weapon damage but
has no crew checks, for the same reason.

## Phase 5: Drag and drop — done

- [x] **Items drop onto the hero sheet.** Anywhere on the sheet accepts an Item dragged
      from a compendium, the Items sidebar or another actor's sheet; the copy is appended
      to the bottom of the list for its type and the sheet switches to the tab that shows
      it. Dropping a **Folder** of Items copies the whole folder, subfolders included, so
      a kit built in a compendium moves across in one drag.
- [x] **Items drag out of the hero sheet**, onto another sheet or back to the sidebar.
- [x] **Rows re-order by dragging** within their own list. Each list is one item type, so
      a drop onto a row of a different type is treated as no instruction rather than as a
      cross-list move. The lists are now ordered by the `sort` field for this to stick.

- [x] **Statblock sheets translate a drop into a schema row.** They hold their attacks
      and gear as `ArrayField`s rather than as embedded items, so an Item dropped on one
      is *mapped* rather than copied (`alternity-statblock-drops.js`):

      | sheet | item type | lands in |
      | --- | --- | --- |
      | npc | weapon | `attacks` |
      | creature | weapon, skill | `attacks`, `skills` |
      | robot | weapon, perkFlaw, skill | `systems` (as Weapon Support), `perksFlaws`, `skills` |
      | ai | weapon, armor, program, skill | `physicalForm` (Weapon / CPU Armor), `gridPrograms`, `skills` |
      | spaceship | weapon | `weapons` |
      | warship | weapon | `weapons` |

      Nothing is guessed at. A field with no honest source on the item keeps the same
      default the sheet's own "+ Add row" button gives it — most importantly the attack
      **score**, which is the NPC's skill score and not a property of the gun; the
      governing skill and the Acc modifier go into the row's notes so the Gamemaster
      knows what to score it from. Damage forms are translated across scales
      (`LI`/`HI`/`En` → `lowImpact`/`highImpact`/`energy`), and the warship's
      single-formula row is split out of the Ordinary code through
      `parseDamageCode` so the trailing s/w/m never reaches a formula field.
      An item type with no home on a sheet is **refused out loud** rather than silently
      swallowed. Rows are grouped and written one array at a time, because an
      `ArrayField` update replaces the array rather than merging into it.

Not done, deliberately: the **vehicle** sheet accepts nothing, because `VehicleData` has
no attack or gear arrays at all — a vehicle is driven by a character's own Vehicle
Operation check. It is still wired up, so a drop there says so rather than looking as
though it worked.

## Current Status
- [x] Basic Ability/Skill management.
- [x] Action Check & Durability tracking.
- [x] Weapon rolling with damage, at the grade the attack check earns.
- [x] Wound penalties (Dazed effect) logic.
- [x] Serialization/Deserialization.
- [x] Rolling from every sheet that has something to roll (see Phase 4).
- [x] Drag and drop of items on every sheet that has somewhere to put one (see Phase 5).

## Phase 6: Armour actually stops damage — done

Armour was the last part of a combat round that was wired up in name only. `ArmorData`
could not express a die range, so no suit could be entered as the book prints it; the
one number it did have was subtracted flat; `AlternityCharacterState.armor` and
`CreatureData.naturalArmor` were read by nobody at all; and `armorBonus` was quietly
making heavy armour harder to hit. What exists now:

- One armour model — a `{li, hi, en}` triple of die ranges — shared by worn armour,
  cybertech plating, natural armour and the hero sheet's own ratings box.
- `AlternityMathService.parseArmorValue`, `selectBestArmorRoll`, `selectHighestToughness`
  and `resolvePersonalDamage` (pure); `AlternityRollService.collectArmorRatings` and
  `rollArmorProtection` (the dice). The Gamemaster Guide's order of operations —
  degrade, then secondary off the degraded primary, then armour — lives in exactly one
  function, and its three worked examples are the tests.
- The layering rule: protections compete, the best roll wins, and the discarded rolls
  are reported on the mitigation card rather than vanishing.
- A `toughness` grade on armour, supporting cast and creatures, so a pistol against a
  body tank loses a grade before the armour is even rolled.

See `alternity-core-mechanics.md` ("Armor" / "Firepower vs. Toughness") for the sourced
rules, and Phase 3 for the two armour-adjacent items deliberately left open.
