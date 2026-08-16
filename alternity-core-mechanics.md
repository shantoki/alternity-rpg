# Alternity Fastplay Core Mechanics (PDF Accurate)

## Core Mechanic: The Action Check
Every action is resolved by rolling two types of dice against a **Score**:
- **Control Die**: Always a **d20**.
- **Situation Die**: Varies based on difficulty (Steps).
- **Goal**: Roll **equal to or less than** your Score.
- **Critical Failure**: A natural **20** on the d20 is always a failure, regardless of the Situation Die result.
- **Exception — Action Checks**: An Action Check (see Action Economy below) can never produce a Failure or Critical Failure outcome. Any result that would otherwise fail — including a natural 20 — is downgraded to a Marginal success instead. A natural 20 on an Action Check still succeeds, but is tainted by the Bad Luck Rule (some negative consequence applies later).

### Success Degrees (Triple Scores)
Every skill and ability check has three levels of success:
1.  **Ordinary**: Roll ≤ Score.
2.  **Good**: Roll ≤ 1/2 Score (rounded down).
3.  **Amazing**: Roll ≤ 1/4 Score (rounded down).

## The Situation Die Steps Scale
Difficulty modifies the Situation Die by moving steps along the scale. A "bonus" moves the die to the left (Bonus), while a "penalty" moves it to the right (Penalty).

| Step | Die | Type |
| :--- | :--- | :--- |
| -5 | -d20 | Bonus |
| -4 | -d12 | Bonus |
| -3 | -d8 | Bonus |
| -2 | -d6 | Bonus |
| -1 | -d4 | Bonus |
| **0** | **+d0** | **Base (Specialty)** |
| +1 | +d4 | Base (Broad/Penalty) |
| +2 | +d6 | Penalty |
| +3 | +d8 | Penalty |
| +4 | +d12 | Penalty |
| +5 | +d20 | Penalty |
| +6 | +2d20 | Penalty |
| +7 | +3d20 | Penalty |

### Base Situation Die
- **Broad Skills & Feat Checks**: Base situation die is **+d4** (+1 step).
- **Specialty Skills & Action Checks**: Base situation die is **+d0** (0 steps).

### Situation Die Modifiers by Condition (Table P16 / Table P17 top half)
A GM picks a step shift by naming how difficult a circumstance is, rather than computing steps directly. This is the same scale in both the Player's Handbook (Table P16) and Table P17's "Conditions" column, except Table P17 adds a "Critical" tier beyond Extreme:

| Condition | Step Modifier |
| :--- | :--- |
| Critical (worst) | +4 steps |
| Extreme | +3 steps |
| Moderate | +2 steps |
| Slight | +1 step |
| Marginal | None |
| Ordinary | -1 step |
| Good | -2 steps |
| Amazing (best) | -3 steps |

The resulting total step then maps to an actual die via the Situation Die Steps Scale above.

### Situation Modifiers (Examples)
- **Weapon Range (Table P22 — Range Modifiers by Weapon Type)**:

  | Weapon | Short | Medium | Long |
  | :--- | :--- | :--- | :--- |
  | Primitive (bow/crossbow/sling)* | -1 step | +1 step | +2 steps |
  | Pistol | -1 step | +1 step | +3 steps |
  | Rifle | -1 step | None | +1 step |
  | Submachine gun | -1 step | +1 step | +3 steps |

  *Flintlocks use the Pistol or Rifle figures, as appropriate.
- **Target Cover**: Light (+1), Medium (+2), Heavy (+3) — not yet located verbatim in the scans; treat as unconfirmed until checked directly.

## Character Statistics

### Ability Scores
Humans range from **4 to 14**. These scores act as the base for Broad Skills and Feat Checks.
- **STR**: Strength
- **DEX**: Dexterity
- **CON**: Constitution
- **INT**: Intelligence
- **WIL**: Will
- **PER**: Personality

### Skills
- **Broad Skills**: Score = Ability Score.
- **Specialty Skills**: Score = Ability Score + Skill Rank.
- **Untrained**: Score = 1/2 Ability Score (rounded down).

### Resistance Modifiers (Table P2)
Alternity has no armor-class-style defense number; instead, an ability score converts to a step penalty applied to an attacker's check (already implemented as `AlternityMathService.calculateResistanceModifier`):

| Ability Score | Resistance Modifier |
| :--- | :--- |
| 4 or less | -2 steps |
| 5-6 | -1 step |
| 7-10 | 0 |
| 11-12 | +1 step |
| 13-14 | +2 steps |
| 15-16 | +3 steps |
| 17-18 | +4 steps |
| 19+ | +5 steps |

### Health & Durability
Damage comes in three forms: **Stun (s)**, **Wound (w)**, and **Mortal (m)**.
- **Stun Rating**: Equal to CON.
- **Wound Rating**: Equal to CON.
- **Mortal Rating**: Equal to 1/2 CON (rounded up).

#### Secondary Damage
Serious injuries cause secondary damage based on the **raw damage** received:
- **Wound Damage**: For every 2 points of wound damage, receive 1 point of stun damage.
- **Mortal Damage**: For every 2 points of mortal damage, receive 1 point of wound and 1 point of stun damage.

#### Armor
- Armor reduces **primary damage** (Stun, Wound, or Mortal).
- Armor has **no effect on secondary damage**. Secondary damage is calculated from the raw damage *before* armor reduction.

#### Effects of Damage
- **Knockout**: All stun or wound boxes marked results in being knocked out.
- **Dazed**: For every Mortal box marked, receive a **+1 step situation penalty** to ALL actions.
- **Death**: All mortal boxes marked results in death.

## Action Economy
Scenes are divided into **Action Rounds**, each consisting of four phases:
1.  **Amazing Phase**
2.  **Good Phase**
3.  **Ordinary Phase**
4.  **Marginal Phase**

### Action Check
At the start of a round, roll a d20 (Action Check) against your Action Check scores.
- **Amazing Success**: Can act in Amazing, Good, Ordinary, or Marginal phases.
- **Good Success**: Can act in Good, Ordinary, or Marginal phases.
- **Ordinary Success**: Can act in Ordinary or Marginal phases.
- **Marginal Success**: Can only act in the Marginal phase.

**Tie-breaking**: Characters acting in the same phase act in order of their **Action Check Scores** (highest score first).

> **Unverified — conflicting source evidence.** One pass found this rule stated in the Gamemaster Guide with a worked example; another pass found Player's Handbook text stating actions within a phase are *simultaneous regardless of roll order*, with the highest-score-first ordering actually belonging to a different rule (declaring Last Resort Point use). Do not treat this as settled — confirm against the scans (PHB ~p.38 and ~p.48-49) before changing the current implementation, which sorts by phase then by Action Check Score.

## Recovery & Healing

### Natural Healing (confirmed, PHB p.54 sidebar)
- **Stun**: Heals automatically — all stun damage disappears at the end of a scene, and anyone knocked out by stun regains consciousness.
- **Wound**: Not a flat rate. Once per week (at week's end), make a **Resolve-physical resolve** check (or an untrained Will check with a +d4 situation die if the character lacks the Resolve broad skill):
  - Critical Failure: condition worsens, patient suffers 1 additional wound.
  - Marginal: recovers 1 wound box.
  - Ordinary: recovers 2 wound boxes.
  - Good: recovers 3 wound boxes.
  - Amazing: recovers 4 wound boxes.
  - Activity modifier: total bed rest gives a -2 step bonus; normal activity applies a +2 step penalty.
- **Mortal**: Cannot be healed naturally — only Medical Science-surgery repairs mortal damage.

### First Aid (Knowledge)
- Negate stun: 2/3/4 (O/G/A).
- Revive: 1/2/3 stun (O/G/A).
- Heal wound: **not** a simple "any success" roll — it's a complex skill check (Good complexity with a first aid kit, Ordinary complexity with a trauma pack). On completion, heals 1 wound point (kit) or 2 wound points (trauma pack). Critical Failure: the check is voided and the patient instead suffers 1 additional wound point.

### Medical Science (Treatment)
- Negate stun: 2/3/4 (O/G/A).
- Revive: 2/3/4 stun (O/G/A).
- Heal wound: **not** a simple "any success" roll — it's a complex skill check (Ordinary complexity with a medical kit, Marginal complexity with a trauma pack). On completion, heals 2 wound points (kit) or 4 wound points (trauma pack or better). Critical Failure: the check is voided and the patient instead suffers 1 additional wound point.

### Medical Science (Surgery)
- An extended/complex skill check, not a single roll — complexity scales with the severity of mortal damage being treated (roughly Marginal to Amazing complexity for 1 to 4+ mortal points).
- A new check is made **every hour during the ongoing procedure**, accumulating successes rather than resolving in one roll (this is not "usable once per hour per patient" — it's one multi-hour procedure per patient). Every 2 accumulated successes heals 1 mortal point and 2 wound points.
- Surgery cannot be performed during combat.
- Critical Failure (or 3 accumulated Failures) wipes all accumulated successes, forcing the procedure to restart, **and** the patient suffers 1 additional point of mortal damage.

### Medical Science Situation Modifiers (sidebar)
Applies to First Aid and Medical Science checks:

| Condition | Modifier |
| :--- | :--- |
| Patient is a member of an alien species | +3 steps |
| Patient is same species | 0 |
| Combat conditions | +2 steps |
| Patient knocked out | +1 step |
| Patient dazed* | +1 step |
| Patient has mortal damage, per point | +1 step |
| No medical treatment items being used | +3 steps |
| First aid kit being used | 0 |
| Trauma pack being used | -1 step |
| Marginal disease | -1 step |
| Ordinary disease | 0 |
| Good disease | +1 step |
| Amazing disease | +2 steps |

*Dazed is an optional rule.

## Special Mechanics

### Complex Skill Checks / Skill Challenges (Table P17, bottom half)
For complex tasks requiring multiple checks, each individual check's degree of success contributes toward a total:
- **Ordinary Success**: 1 success.
- **Good Success**: 2 successes.
- **Amazing Success**: 3 successes.

The total successes needed to complete the task depends on the task's own complexity rating (the GM's call):

| Task Complexity | Successes Required |
| :--- | :--- |
| Marginal | 2 |
| Ordinary | 3 or 4* |
| Good | 5 or 7* |
| Amazing | 8 to 10* |

*Specific number within the range is decided by the Gamemaster.

### Environmental Hazards (Heat)
Source: Gamemaster Guide "Endurance Challenge" rules (Environments chapter, ~p.55-60) — not yet in code, needs verification against the scan for exact per-tier figures.
- Make a **Stamina-endurance** check on a schedule that depends on the specific heat tier (H0-H5) — it is **not** a flat "every hour," and cumulative +1 step penalties often apply at higher tiers.
- Stun damage by degree of success: **Amazing** none, **Good** 1, **Ordinary** 2, **Failure** 3, **Critical Failure** 4 (a 5-tier scale, not the old 2-tier Failure/Critical Failure split).
- **E-suit**: Protection depends on suit hardness and heat tier — soft e-suits reduce check *frequency* rather than granting immunity; hard e-suits grant full immunity at most tiers but can still fail at the most extreme tier (Inferno). It is **not** simply "protects until wound/mortal damage."

### Dodge Defense
A successful **Acrobatics-dodge** check adjusts the character's Strength- or Dexterity-based resistance modifier against the next attack, by degree: **Critical Failure** -2 steps, **Failure** none, **Ordinary** +1 step, **Good** +2 steps, **Amazing** +3 steps.

## Weapon Tables Reference (PHB Ch.11, "How to Read the Weapons Tables")
Column meanings for any weapon table transcribed from the book:
- **Skill**: The (often abbreviated) skill needed to avoid using the weapon untrained.
- **Acc**: Accuracy — an optional bonus/penalty applied to the wielder's check (e.g. a precise laser rifle gives -1 step, a flintlock pistol gives +2 steps).
- **Md**: Mode — Fire (single shot/phase), Burst, or Autofire. A burst uses one 3-shot burst of ammunition per use; autofire uses three bursts per use.
- **Range**: "Personal" for melee weapons (an asterisk marks a melee weapon that can also be thrown, via Athletics-throw), otherwise short/medium/long in meters — these are the ranges Table P22's step modifiers apply to.
- **Type**: Two parts — the damage form (Low Impact / High Impact / Energy) and the weapon's firepower (Ordinary/Good/Amazing). **If a weapon's firepower is inferior to the toughness of the armor it's used against, the damage it inflicts is degraded a grade** (e.g. mortal damage becomes wound damage) — this is a personal-combat counterpart to the firepower-vs-toughness grade shift already implemented for ships in `AlternityMathService.calculateFirepowerShift`, but it is **not yet implemented anywhere for personal-scale weapons/armor** in this codebase.
- **Damage**: Given in Ordinary/Good/Amazing order, applied depending on the wielder's skill check result.
- **Clip Size / Clip Cost**: Shots per clip, and average clip replacement cost.
- **Hide**: Penalty to an opponent's Awareness-perception check to spot the concealed weapon ("—" means it can't be concealed).
- **Mass**: Weapon mass in kilograms.
- **Avail**: Any / Common / Controlled / Military / Restricted — legal availability and cost-multiplier tier if acquired outside normal channels.
- **Cost**: Average listed price.

## Achievement Levels (Table P28: Achievement Level Summary)
Character-advancement point thresholds — not a core-mechanics table, included here for reference since it was cross-checked against the scan (note: previously mislabeled "P29"; the book prints it as **Table P28**):

| Level | Points Needed | Points Earned |
| :--- | :--- | :--- |
| 1 | 0 | 0 |
| 2 | 6 | 7 |
| 3 | 13 | 8 |
| 4 | 21 | 9 |
| 5 | 30 | 10 |
| 6 | 40 | 11 |
| 7 | 51 | 12 |
| 8 | 63 | 13 |
| 9 | 76 | 14 |
| 10 | 90 | 15 |
| 11 | 105 | 16 |
| 12 | 121 | 17 |
| 13 | 138 | 18 |
| 14 | 156 | 19 |
| 15 | 175 | 20 |
| 16 | 195 | 21 |
| 17 | 216 | 22 |
| 18 | 238 | (continues) |
| etc. | etc. | etc. |
