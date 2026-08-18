# Plans for the compendium

Running roadmap for the compendium packs, in the same spirit as
`PLANS_FOR_CHARACTER_SHEET.md`: what is done, what was deliberately left out, and what
the next pass has to pick up. Check here before assuming a gap is an oversight.

## What exists

Eleven packs. Nine are built from the Alternity character generator's data set; the two ship
packs are built from the books, because the generator data set has no starships in it (see
Phase 6). The pipeline is two steps and the middle is committed:

```
external/json/**            npm run convert:source     packs/_source/**       npm run build:packs     packs/**
(gitignored source data) ------------------------->  (JSON, one file/doc)  ------------------------> (LevelDB)
                                                       ^ committed                                     ^ gitignored
```

**`npm install` then `npm run build:packs` is a setup step.** Only `packs/_source` is
committed, so a fresh clone has no loadable compendia until the build is run — and it needs running again after any
pull that touched `packs/_source`. The compiled packs are excluded because a LevelDB is a
live database: Foundry rewrites `CURRENT` and spawns a new `MANIFEST-*` every time it
opens one, so a committed pack collides with the local Foundry on every pull. Ignoring
just the churn does not work, because `CURRENT` and `MANIFEST-*` are what make the store
readable.

This is a *contributor's* step only. A player installs the system from a manifest URL and
gets a zip with the compiled packs already inside it, built by `.github/workflows/
release.yml` on a `v*` tag. Nobody installing the system runs npm.

| Pack | Documents | Item / Document types |
| --- | --- | --- |
| `alternity-weapons` | 252 | `weapon` |
| `alternity-armor` | 90 | `armor` |
| `alternity-equipment` | 224 | `personalEquipment`, `computer` |
| `alternity-skills` | 208 | `skill` |
| `alternity-fx` | 228 | `fx` |
| `alternity-cybertech` | 57 | `cybertech` |
| `alternity-achievements` | 185 | `achievementBenefit` |
| `alternity-species` | 18 | `species` |
| `alternity-templates` | 54 | `character` Actors |
| `alternity-spaceships` | 18 | `spaceship` Actors |
| `alternity-warships` | 44 | `warship` Actors |

Each pack folders its contents by source book, except `alternity-achievements`, which
folders by profession because every achievement comes from the same book, and
`alternity-warships`, which folders by what a record *is* (military hulls, civilian hulls,
stations and bases, sample ships) because it all comes from one book too.

Two rules the tooling depends on:

- **Ids are hashed, not drawn.** `stableId(pack, type, name)` means re-running the
  converter against unchanged data rewrites identical bytes, so a source fix diffs only
  the records that changed and an item already dragged onto an actor keeps pointing at
  the same compendium entry. Renaming a document *does* change its id, and that is the
  one edit that breaks existing links.
- **Nothing printed is thrown away.** Columns with no schema field land on the item's
  `flags['alternity'].provenance` and are rendered into the description inside
  `<dl class="alternity-source-stats">`. The prose pass prepends to that element rather
  than replacing the description.

`tests/test-pack-source.test.js` validates every document against the choice lists and
bounds its TypeDataModel declares, because `compilePack` writes whatever it is handed and
Foundry only complains when a GM opens the offending row.

## Phase 1: mechanical conversion - done

- [x] **Weapons carry the whole attack line.** Damage form and firepower split out of the
      Type column (`HI/O`), the three damage grades out of the Damage column, accuracy
      into `attackBonus` unflipped (Alternity step modifiers and this codebase's
      modifiers share the positive-is-a-penalty convention), and the range bands into
      `range`. `rangeClass` is derived from the governing skill rather than from
      `weaponType`, because Table P22 keys off what kind of gun a weapon is.
- [x] **`weaponType` is read off the record's flags, not its `@Type` code.** That code
      conflates thrown weapons with the class they were thrown from - grenades are
      `@Type=2` with `@Throw=True`, a thrown knife is `@Type=0` with the same flag.
- [x] **Ten weapons get no damage codes at all.** The launchers print "As Load" and a
      handful of effect weapons print "Special"; a guessed run would let
      `selectDamageGrade` roll damage the book does not define. The printed word is in
      the description instead.
- [x] **Armour's `@AP` column is the Action Penalty**, confirmed against the Star Drive
      Arms & Equipment Guide (the Tiger Mod 6 prints "Action Penalty: +2" and carries
      `@AP="2"`). It lands on `skillPenalty`. `resistanceModifierBonus` stays 0 on
      everything - it is a property of specific field gear, not of armour thickness.
- [x] **Equipment is categorised by `@Class`, not `@Category`.** The Arms & Equipment
      Guide files gear under brand lines ("Terra X", "TrailTech EcoTour Gear"); `@Class`
      says what the gear actually is.
- [x] **The Computers category becomes `computer` items**, not generic gear, and reads
      its processor quality off the name suffix ("Microcomputer, Good").
- [x] **The source data's numeric skill ids are bridged onto `SKILL_DEFINITIONS`** by
      matching names, with an alias table for the ~30 entries the two lists abbreviate
      differently ("Law Enforcement" vs "Law enforc."). A skill that resolves to nothing
      still becomes an item, with a blank `skillId`.
- [x] **FX traditions are decoded from `@FXSource`** - 0 Arcane Magic, 1 Faith, 2 Super
      Power - which the broad skills under each value confirm. The real broad skill
      (Necromancy, Voodoo, Chi) goes to `category`, because `FXData.broadSkill` only
      admits the eight canonical ones.
- [x] **Achievements are one item per profession.** The same +1 Strength costs a Combat
      Spec 10 points at level 3 and a Mindwalker 15 at level 9, and the schema holds one
      profession, cost and minimum level. Profession slots 5 and 6 in the source data sit
      permanently at minimum level 99, its "never available" sentinel, and are skipped.
- [x] **Career templates write both actor data layers**, as `saveAltState` would: the
      `characterState` flag is built by instantiating the real `AlternityCharacterState`
      (it imports nothing Foundry-specific, so it runs under Node) and the mirrored
      `system` fields come from the same numbers.

Not done, deliberately: **descriptions are stat blocks, not rules text.** The character
generator's data set carries no prose at all - every record is columns. The rules text
lives in the Markdown conversions of the books, and matching 1,300 items against it is a
separate pass with a different failure mode (see Phase 2).

## Phase 2: rules text from the books - not started

The books are Markdown conversions of OCR'd scans, and the OCR is rough - the Player's
Handbook renders "Battle jacket d6-1 (LI), d4+1 (HI), d4+1 (En)" as "Battle jacket 6-1
(LI), d4+1 (HN), d44 (En)". So this pass has to be checkable rather than trusted.

- [ ] Match each item to its entry in the Markdown by name, and write the prose *above*
      the existing `<dl class="alternity-source-stats">` element rather than replacing
      the description.
- [ ] Record what matched and how confidently on `provenance.prose`, so a bad match can
      be found without re-reading 1,300 items.
- [ ] Report the unmatched. A silent 60% match rate reads exactly like a 100% one.
- [ ] The Arms & Equipment Guide entries carry fields the tables do not - environmental
      tolerances, effective Strength, composition. Decide whether those become schema
      fields or stay prose before writing any of them anywhere.

## Phase 3: fields with no home - mostly done

An audit comparing every generated document against its TypeDataModel's declared
initials turned up two kinds of gap: source columns the schemas had no field for at all,
and one block of source data the converter simply skipped.

- [x] **Nothing priced.** `WeaponData`, `ArmorData` and `ComputerData` had no `cost`
      field, so the converter read the credit price out of the source data — 400 for a
      9mm pistol, 9,000 for a Tiger Mod 6 — and had nowhere to put it. Every weapon,
      suit of armour and computer in the compendium shipped priceless. Progress level and
      availability were missing the same way.
- [x] **`item-acquisition.js`** now declares Progress Level, Cost, Availability and
      Concealment once, and `WeaponData`, `ArmorData`, `ComputerData` and
      `PersonalEquipmentData` share them. Five copies of an availability list is how it
      ends up meaning one thing on a rifle and another on a program.
- [x] **Concealment is nullable.** The tables print a dash for what cannot be hidden at
      all, which is a different statement from a modifier of 0 — and for armour the
      attribute stores both as a plain `0`, so the rendered element is the only place the
      distinction survives.
- [x] **The rest of the weapon table**: firing modes, actions to ready, clip size and
      clip cost.
- [x] **`SkillData.baseCost`**, the skill point price, mirroring `FXData.baseCost`.
- [x] **Cyberware durability bonuses were being dropped.** Six records — CF Skinweave and
      the Exoskeleton at each quality — state their effect mechanically in a
      `SpecialItems` block the converter skipped, so `durabilityBonus` was zero on all 57
      pieces. `@Context="6"` marks a durability bonus and `@Op` names the track (1 stun,
      2 wound, 3 mortal), the same encoding the achievement records use.
- [x] Each new field has a row on `templates/item/item-sheet.hbs`. The availability
      selects use inline `<option>` markup rather than `{{selectOptions config.x}}`,
      following the rule that file's own comments set out: an undefined config key makes
      `selectOptions` throw, which aborts the render of the whole shared sheet for every
      item type.

Still open, because the source data has no column for them:

- [ ] **`ComputerData`**: active memory and storage. Printed in Dataware and the Arms &
      Equipment Guide. (Progress level is present but zero on all 27 computers, which is
      what the source data carries, not a conversion loss.)
- [ ] **`CybertechData`**: `requiresExoskeleton` and `requiresCyberlimb`, stated in the
      Dataware entries themselves rather than in any column.
- [ ] **`ArmorData.speedPenalty`** and **`techPointCost`** — the latter matters, since
      powered armour costs tech points per scene by its own schema's description.

Correctly left at their defaults, and not to be "fixed": catalogue skills at rank 0,
`isEquipped` false, `quantity` 1, `timesPurchased` 0, and `resistanceModifierBonus` 0 on
every suit of armour. The achievement `effectValue` of 1 was checked against the source
data's own `SpecialItems` encoding and agrees with it, ability mappings included.

## Phase 4: species as a real Item subtype - done

The 18 species are `species` Items, and a hero's species is the Item they carry rather
than a string on their sheet. That matters because a species is the only thing in this
system whose numbers reach outside itself:

| What it sets | Where it lands |
| --- | --- |
| `durabilityMultiplier` | Constitution, before the stun/wound/mortal/fatigue run is figured |
| `psionicMultiplier` | Willpower, on the way to psionic energy points |
| `abilityRanges` | The span each score may be bought within |
| `actionCheckStep` | The action check die (T'sa: -1) |
| `specialAbilities[].effectTarget` | `collectTargetModifiers`, for the ones that state a step |

- [x] **`SpeciesData` holds all of it**, plus `bonusSkillPoints`, `bonusBroadSkills`,
      the psionic/glide/fly flags, `naturalArmor` as printed die expressions, and the
      free skills by name. `specialAbilities` is `{name, description, effectTarget,
      effectValue, attackKind}` — the description is always the whole printed note, and
      the mechanical fields are filled only where the note states something the system
      can apply on its own.
- [x] **The `isWeren` name test is retired.** Durability used to ask whether
      `state.species` contained the string "weren", which was wrong twice over: it
      missed the **Sasquatch**, which carries exactly the same CON x1.5, and it would
      have fired on any hero whose species name merely mentioned one.
      `calculateDurabilityRatings` now takes `durabilityMultiplier`; `isWeren` survives
      as a documented alias for 1.5, because supporting cast state it as a flag
      (`NpcData.isSuperiorDurability`) rather than as a number.
      `legacyDurabilityMultiplier` runs the old guess exactly once, for a state saved
      before the Item type existed, and the guess is written out by the next save.
- [x] **Ability scores clamp to the species' range, not to a flat 4-14.** That constant
      put the Weren's printed Strength maximum of 16 and the Sandman's Willpower minimum
      of 2 out of reach and rewrote them silently on the way in. The hero sheet's number
      inputs read the same range.
- [x] **The mechanical notes are parsed where they are mechanical.** One is, in the whole
      data set: "Weren Camouflage: +1 step to ranged attacks vs. weren", which
      `AlternityRollService.collectTargetModifiers` now applies beside the target's
      resistance modifier. The T'sa's natural armour is lifted out of its note into
      `naturalArmor`. The pattern is deliberately narrow — a looser one would turn a
      sentence that merely mentions steps into a modifier applied behind the player's
      back.
- [x] **The item sheet has a species tab**, and the hero sheet shows the carried species
      with its trait summary on the Hero tab. Dropping one runs
      `AlternityActor.syncSpeciesFromItems`; dropping a second replaces the first
      (`removeOtherSpecies`), because two would mean two multipliers with no rule for
      which wins.
- [x] **Each of the 54 career templates carries its species Item.** Every one is Human,
      and each template file repeats the whole `Species` record inline, so they are built
      from the record rather than from an assumption.

**The document ids changed, and no id would have prevented that.** A compendium UUID
names the document type, so `Compendium.alternity.alternity-species.JournalEntry.<id>`
cannot resolve to an Item whatever id it is given. The pack's ids are hashed from
`(pack, 'species', name)` like every other item and are stable from here on.

What is still prose and not mechanics, in the four Core species that carry notes at all
(the Star\*Drive, Dark\*Matter and Traveller species carry none):

- [ ] The T'sa's natural armour is stored but not yet applied — the state's `armor`
      block is filled from worn gear, and a species' rating should stack into it.
- [ ] "Sesheyan Light Sensitivity: +1/+2/+3 step penalty for ordinary/good/amazing
      illumination" is a circumstance modifier keyed to a condition the system does not
      model.
- [ ] "Weren Primitive Culture: +2 step penalty when using any items of PL4 or higher"
      could be read off the item's `progressLevel`, which every gear item now carries.
- [ ] "Weren Natural Weapon: claws do d4w/d4+2w/d4m (LI/O)" is a weapon, and could be
      embedded as one rather than described.

## Phase 5: career templates - partly done

The 54 templates convert, but they are career *packages* rather than finished heroes:
every ability sits at 10, there is no gear, and the only attack form is Unarmed. That is
what the character generator shipped, not something the conversion lost.

- [ ] **`system.details.career` still admits only `Soldier | Explorer | Expert`**, a
      legacy d20-shaped list that no Alternity career fits. The templates put their real
      career and profession on the character state and in the biography, and leave the
      system field at its default. The choice list should become the five professions -
      or the field should be free text and the profession a separate one.
- [ ] Templates carry no equipment. The Player's Handbook prints "Signature Equipment"
      for each career ("Assault rifle, battle jacket, rations, survival gear") - those
      could be resolved against the weapons, armour and equipment packs and embedded as
      real Items, which is the first thing that would make a template usable as-is.
- [ ] The profession and species benefits arrive as prose notes and become special rules
      that are enabled but do nothing. Several are mechanical ("Free Agent Action Check
      Increase: action check score increased by 2") and could be real modifiers.

## Phase 6: starships from the books - done

Two packs of Actors, and the first content in the compendium that does not come from the
character generator data set at all. The generator has no ships in it; the ship rules only
ever existed in the books, so `tools/convert/warships.mjs` and `tools/convert/spaceships.mjs`
carry their tables inline as literal data and export `NEEDS_SOURCE_DATA = false`. The driver
checks that flag per converter, so a clone with no `external/` can still rebuild the ships.

They are two packs because they are two rules systems. `spaceship` is the core rules -
compartments, each with its own stun/wound/mortal track, and a d20 hit table that picks which
one eats a hit. `warship` is the supplement - one whole-ship hull point pool, a ship-level
stun/wound/mortal/critical track, a per-ship toughness class, and hit *zones*. Every published
statblock is printed in one form or the other, never both.

### `alternity-warships` - 44 records

- [x] **33 bare hulls**, Tables 5-1a and 5-1b joined with Table 5-18: hull points and their
      economy-of-scale bonus, toughness class, target modifier, manoeuvre class, the s/w/m/c
      damage track, typical crew, cost, and the zone count with its per-zone hull point limit.
      The systems/weapons/defenses/sensors tables stay empty - a hull is where a design starts.
- [x] **10 stations and bases**, Table 6-1, in the same shape. Ch.6 was never finished before
      the line was cancelled; that table is the whole of what exists, and the book publishes it
      as "a good starting point".
- [x] **The *Endurance***, the survey cruiser Ch.5 builds step by step and prints on p.106 -
      all 26 system rows, 3 weapon batteries, 2 defences, 6 sensors and the 8-zone damage
      diagram. Its own arithmetic is the proof the transcription is complete: the hull point
      column sums to exactly 480 (400 plus the 80 bonus, nothing left over) and the continuous
      power draw to exactly 294, which is what the four mass reactors generate. Both are
      asserted in `tests/test-pack-source.test.js`.
- [x] **Zone lists are pre-filled**, because zone count and limit are a pure function of the
      hull (Table 5-18) and Ch.5 Step A names every zone for each of the six layouts
      (2/4/6/8/12/20). `PLANS_FOR_WARSHIP_SHEET.md` deferred a hull-type lookup to Phase 2;
      this is that lookup as data rather than as code, which needs no runtime table.

Two schema gaps had to be closed first, both from the books rather than from convenience:

- [x] **`SHIP_TOUGHNESS_CLASSES` was missing `Good`.** Table 5-1b prints `(Gd)` for the launch,
      courier and trader, and its own note says "some ships have Good toughness, one step less
      than Small Craft". Mapping those three onto `SmallCraft` would have been a play-affecting
      error, since toughness is what the firepower-versus-toughness ladder measures against.
      `Good` is inserted at the bottom of the ladder, which leaves `calculateFirepowerShift`
      correct because only the *difference* between two ranks means anything. Weapons list one
      rung fewer - nothing shoots with Good firepower - so `SHIP_FIREPOWER_CLASSES` is the
      ladder minus its bottom rung, and that is what a weapon row's `firepowerClass` admits.
- [x] **`hullCategory` admitted only `Military | Civilian`.** Table 6-1's installations are
      neither, so `Installation` is a third value, `SHIP_HULL_TYPES` gained the group, and the
      list is now exported from `WarshipData` instead of being restated in the sheet.
      `WarshipData` also stopped keeping its own copy of the toughness ladder and imports the
      math service's.

### `alternity-spaceships` - 18 records

- [x] **9 Player's Handbook Ch.12 stock hulls** (STG shuttle, system liner, cutter, escape pod,
      launch, trader, transport, yacht, space fighter) with compartments, d20 hit bands, armour,
      the weapon's full three-grade damage run and the drivespace rating.
- [x] **3 Solar X Shipyards ships** from the Arms & Equipment Guide (Hermes-class courier,
      Nike-class gunboat, Solar X Gull), fully itemised down to the durability and power cost of
      every airlock, and with printed prices.
- [x] **6 named ships of the Verge** from the Campaign Setting (*Blackguard*, *Sirocco*,
      Blade-class scout, Lucre-class escort, CSS *Stingray*, klick attack ship), likewise
      itemised, with each system assigned to the compartment it sits in.

**The statblocks were reconstructed, not just typed.** The scans render `4/4/2` as `4/8/2`,
`13-16` as `18-16` and `C6` as `CE`, so two invariants were used to pin every number down:

1. **A printed triple is one number.** "A compartment's mortal rating is the same as its number
   of durability points, and its stun and wound ratings are twice that number" - so `8/8/4` is
   durability 4 and any triple that is not 2n/2n/n is corrupt. That is how the *Blackguard*'s
   "8/6/3" resolved to 6/6/3.
2. **The compartments account for the hull.** Every StarDrive statblock prints its armour's
   durability cost, and its compartments sum to exactly `Dur` minus that cost. That identity
   supplied the *Stingray*'s missing engineering compartment (9 points - exactly its induction
   engine plus its stardrive, the engine row having been lost with it), the yacht's missing
   command compartment, the *Sirocco*'s command compartment and the split of its systems, and
   both unreadable compartments on the *Lucre*-class escort.

Both invariants, plus the d20 bands tiling 1-20 exactly once and no compartment holding more
systems than it has durability for, are asserted for all 18 ships in
`tests/test-pack-source.test.js`. Eight ships needed reconstruction and each names what was
reconstructed on `provenance.scanDamage`; the *Blade*-class scout, whose durability column was
destroyed outright, carries the sums of its printed system costs rather than a guess, and says
so on the sheet.

Two differences between the books are transcribed rather than smoothed over:

- **The Player's Handbook does not charge durability for armour.** Its five Moderate-armoured
  ships assign exactly the armour's cost more than the GM Guide's budget allows, so their sheets
  read as over-budget. Each says why in its own description, and the test pins the list of five
  closed so a real transcription error cannot hide behind it.
- **Ships whose statblock prints no power rating show a deficit.** The *Blackguard* is the
  clearest case. That is the source, not a conversion loss, and the ship says so.

### What Phase 6 left for later

- [ ] **A warship weapon row holds one damage code, not three.** Warships weapons print the
      usual Ordinary/Good/Amazing run with a track letter on each grade (the matter beam is
      `2d6+1w/2d8+1w/2d8m`), but `WarshipData.weapons` has a single `damageFormula` plus
      `damageGrade`. The *Endurance*'s rows carry the Ordinary code and the full run in the row
      name, so nothing printed is lost - but a GM rolling its matter beam gets the Ordinary
      damage whatever degree they achieved. Giving that array the three-grade run
      `SpaceshipData.weapons` already has is a schema change and its own piece of work; see
      `PLANS_FOR_WARSHIP_SHEET.md`.
- [ ] **No prose.** Like every other pack, a ship's description is its stat block. The books
      carry a paragraph for every hull and a page for several of the named ships, and that text
      belongs to the Phase 2 pass along with everything else - the OCR damage that made the
      numbers checkable makes the prose exactly as unreliable as it is for the 1,300 items.
- [ ] **The GM Guide's own hull table (G34) is unrecoverable.** Its durability and cost columns
      are destroyed in the scan; only six compartment counts survive. So there are no bare
      *spaceship* hulls to match the 33 bare warship hulls - the named ships are all the
      core-rules ship data that exists. Every published design uses its hull's full compartment
      allowance, so `compartmentLimit` is set from each ship's own compartment count, which
      agrees with all six readable values.
- [ ] **Crew stations are empty.** `SpaceshipData.stations` models the Ship Status Record Form's
      command crew, and no published statblock names its officers with skill scores. The
      *Stingray* and the Blade-class scout state crew *numbers*, which are in their notes.

## Sources not yet mined

- `external/json/Reports/*.json` are the generator's XSL report stylesheets, not data.
  They are worth keeping as a decoder ring - `walter_weapons.xsl` is where the numeric
  availability codes were confirmed - but there is nothing in them to convert.
- Vehicles and creatures have actor types and sheets in this system but no records in the
  character generator data set. Vehicles are in the Player's Handbook Ch.12 table, whose
  scan is destroyed; creatures are in the Gamemaster Guide. Starships are done - see
  Phase 6.
- `PerkFlawData`, `ProgramData` and `MutationData` have no source records either. Perks
  and flaws are in the Player's Handbook, programs in Dataware, mutations in Gamma World.
