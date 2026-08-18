# Warship Actor Type — Roadmap

This document tracks the Warship actor/sheet work, based on `../alternity-md/Warships.md`
(the Warships rules expansion). It follows the same roadmap-checklist convention as
`PLANS_FOR_CHARACTER_SHEET.md`. See `DESIGN_DOCUMENTATION.md` / `alternity-core-mechanics.md`
for the base system this extends.

## Phase 1: Record/Play Sheet (done)

A static play sheet for an already-designed ship (stat block, damage track, weapons/
defenses/sensors lists, hit-location zones) — modeled after the book's own worked
"Endurance" example, not a construction wizard.

- [x] **`src/data/WarshipData.js`** — self-contained `TypeDataModel` (no `AlternityCharacterState`
      involvement, following the `VehicleData.js` pattern): hull identity/toughness/maneuver
      class, 4-tier damage track (stun/wound/mortal/critical — ships have a Critical tier
      characters don't), armor ratings by damage type, power budget, and inline `ArrayField`
      tables for systems/weapons/defenses/sensors/hit-location zones. Exports
      `SHIP_TOUGHNESS_CLASSES`, `SHIP_HULL_TYPES`, `SHIP_STATUS_EFFECTS`.
- [x] **`src/services/alternity-math.js`** — `calculateShipDamageMitigation` (armor negation
      by damage type) and `calculateFirepowerShift` (Table 1-3 Downgrading / Table 1-4
      Upgrading — firepower-class-vs-toughness-class grade shift, including the critical-damage
      multiplier for excess upgrades), both pure functions following the existing
      `buildModifier`/`modifierTrace` convention.
- [x] **`src/documents/AlternityActor.js`** — `isWarship` flag, `_prepareWarshipData()`
      dispatch branch, `_syncSystemFromState` exclusion (warships don't use
      `AlternityCharacterState`), `applyWarshipDamage()` (resolves grade shift + armor
      mitigation, applies the rulebook's 2-for-1 overflow cascade between tracks), and
      `isWarshipDisabled` getter.
- [x] **`src/client/alternity-sheet-module.js`** — `AlternityWarshipSheet`, with generic
      add/delete-row actions for the array-field tables (no embedded Item documents — see
      "Deliberate Phase 1 scope calls" below), a weapon-roll action, and a damage quick-adjust
      action.
- [x] **`templates/actor/actor-warship-sheet.hbs`** — single-page layout: header/identity,
      4 damage-track bars + status badge, armor/power/stats grid, systems/weapons/defenses/
      sensors/zones tables, GM notes.
- [x] Registration: `system.json` (`documentTypes.Actor.warship`), `src/index.js`
      (`CONFIG.Actor.dataModels.warship`, `trackableAttributes.warship`), `src/data/index.js`
      export, sheet registration.
- [x] `lang/en.json` localization keys, additive CSS in `src/client/css/alternity-sheet.css`.
- [x] Unit tests for `calculateShipDamageMitigation` / `calculateFirepowerShift` in
      `tests/test-alternity.test.js`, hand-verified against every row of Tables 1-3/1-4.
- [x] **Two enums widened when the hulls were actually transcribed** (see
      `PLANS_FOR_COMPENDIUM.md` Phase 6). `SHIP_TOUGHNESS_CLASSES` was missing the `Good`
      rung Table 5-1b prints as `(Gd)` for the launch, courier and trader — inserted at the
      bottom of the ladder, which leaves `calculateFirepowerShift` correct because only rank
      *differences* matter, and paired with a `SHIP_FIREPOWER_CLASSES` that drops it because
      no weapon has Good firepower. `hullCategory` gained `Installation` for Table 6-1's
      stations and bases. `WarshipData` now imports the ladder from the math service instead
      of keeping a second copy, and the sheet reads the category list from `WarshipData`
      instead of restating it.

### The compendium ships this sheet's content

`alternity-warships` holds 44 `warship` Actors: the 33 bare hulls of Tables 5-1a/5-1b joined
with Table 5-18, the 10 stations and bases of Table 6-1, and the *Endurance* itself with all
its system rows and its 8-zone damage diagram. So the sheet now has real content to open, and
the *Endurance* — the ship this sheet was modelled on — is a fixture as well as an example.

One thing that surfaced while transcribing it, and which is a **schema gap, not a conversion
decision**: a `WarshipData.weapons` row holds a single `damageFormula` plus `damageGrade`,
but Warships weapons print the usual three-grade run with a track letter on each grade — the
matter beam is `2d6+1w/2d8+1w/2d8m`, the plasma torpedo `3d6s/3d6w/d8+3m`. The compendium
rows carry the Ordinary code in the schema fields and the whole run in the row's name, so
nothing printed is lost, but a GM rolling the *Endurance*'s main battery gets Ordinary damage
whatever degree they rolled. `SpaceshipData.weapons` already models this correctly with
`damageOrdinary`/`damageGood`/`damageAmazing`; giving the warship array the same shape means
touching the schema, the sheet's weapon-roll action, `alternity-statblock-drops.js` (whose
comment about "the warship's single-formula row" is about exactly this) and their tests.

### Deliberate Phase 1 scope calls (revisit at Phase 2 kickoff)

- **No new Item subtypes.** Ship systems (weapons/defenses/sensors/generic hull-point rows)
  are inline `ArrayField`s on `WarshipData`, not embedded Item documents — Phase 1 is a static
  transcription of an already-built ship, not a live drag-and-drop inventory. Field names are
  kept Item-schema-compatible (`name`, `hullPoints`, `powerReq`, `cost`, ...) so a future
  migration to real Item subtypes (once Phase 2 wants compendium-driven part selection) is a
  transform, not a rewrite.
- **Hit-location zones are manual-tracking.** Zone count and per-zone hull-point limits (Table
  5-18) are GM-entered, not derived from a hull-type lookup; per-system-to-zone assignment is
  free text, matching how the book itself presents the "damage diagram." Structured
  zone/system relationships belong to Phase 2.
  *Since then:* the 44 compendium hulls arrive with their zone lists already filled in, because
  Table 5-18's count and limit plus Ch.5 Step A's names for each of the six layouts
  (2/4/6/8/12/20 zones) are a pure function of the hull. That is the hull-type lookup, stored as
  data rather than added to the runtime — a hull dragged out of the compendium needs no zone
  set-up, and a hand-built ship still needs it entered.
- **`cost` fields are display strings**, not numbers — source costs span `$300K`–`$50000M` and
  Phase 1 does no arithmetic over cost (that's a budget-validation concern for Phase 2).

## Phase 2: Ship Construction Builder (not started, sized only)

Picking a hull and spending hull-point/power budgets across the book's 13 build steps
(Class & Hull → Armor → Power Plant → Engines → FTL → Support → Weapons → Defenses →
Command/Computers → Sensors → Hangars → Misc → Adding It Up), validating that everything
fits, and producing a finished record sheet.

- [ ] Encode all ~30 hull types' stat derivations (Tables 5-1a/5-1b).
- [ ] Encode the system-cost/hull-point-percentage catalogs (Tables 5-2 through 5-17: power
      plants, engines, FTL drives, weapons, defenses, sensors, C3, hangars), each PL-gated.
- [ ] Hull-point and power budget validator.
- [ ] Likely migrate the Phase 1 inline arrays into real embedded Item subtypes
      (`shipWeapon`, `shipDefense`, `shipSensor`, `shipSystem`, ...) so a components
      compendium can be dragged onto a ship-in-progress.
- [ ] Auto-derive hit-location zone count/limits from the chosen hull (Table 5-18), and make
      per-system zone assignment a structured relationship instead of free text.

**Sizing estimate**: roughly 4-6x the code volume of Phase 1 — comparable to or larger than
the Character sheet + its 788-line `AlternityCharacterState` combined. Treat it as its own
project, not an incremental extension of Phase 1.
