# Alternity Fastplay Character Sheet Roadmap

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
- [ ] **Armor Mitigation in Rolls**: Integrate armor die rolls into the damage application flow.
      Armour values can be die ranges (`d6-1`), and `applyAlternityDamage` currently
      mitigates with a flat `damageResistance` number rather than rolling the die.
- [ ] **Skill specialty highlighting**: Ensure specialty skills are visually distinct (italics as per PDF).
- [ ] **Quick Action Buttons**: Add buttons for common actions (Recovery, First Aid check).
- [ ] **Personal-scale firepower degrade**: `calculateFirepowerDegrade` exists and the
      damage card reports it, but only when the caller knows the target's toughness.
      Personal armour has no toughness field yet, so a weapon's firepower currently
      has no effect against a person.

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

Not done, deliberately: the **vehicle** sheet has no roll buttons, because `VehicleData`
holds no skill, attack or action-check scores to roll — a vehicle is driven by a
character's own Vehicle Operation check. The **warship** sheet rolls weapon damage but
has no crew checks, for the same reason.

## Current Status
- [x] Basic Ability/Skill management.
- [x] Action Check & Durability tracking.
- [x] Weapon rolling with damage, at the grade the attack check earns.
- [x] Wound penalties (Dazed effect) logic.
- [x] Serialization/Deserialization.
- [x] Rolling from every sheet that has something to roll (see Phase 4).
