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

### Situation Modifiers (Examples)
- **Weapon Range**: Short (-1), Medium (+1 for pistol/none for rifle), Long (+3 for pistol/+1 for rifle).
- **Target Cover**: Light (+1), Medium (+2), Heavy (+3).

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
- **Natural Healing**: Rate not confirmed against the scan — the Player's Handbook "Natural Healing" rate lives in a sidebar (~p.54) whose OCR text was not recovered. Verify the actual per-week wound recovery figure directly against the scan before relying on "2 wound points per week."
- **End of Scene**: All remaining stun damage disappears at the end of a scene.
- **First Aid (Knowledge)**:
    - Negate stun: 2/3/4 (O/G/A).
    - Revive: 1/2/3 stun (O/G/A).
    - Heal wound: **not** a simple "any success" roll — it's a complex skill check (Good complexity with a first aid kit, Ordinary complexity with a trauma pack). On completion, heals 1 wound point (kit) or 2 wound points (trauma pack). Critical Failure: the check is voided and the patient instead suffers 1 additional wound point.
- **Medical Science (Treatment)**:
    - Negate stun: 2/3/4 (O/G/A).
    - Revive: 2/3/4 stun (O/G/A).
    - Heal wound: **not** a simple "any success" roll — it's a complex skill check (Ordinary complexity with a medical kit, Marginal complexity with a trauma pack). On completion, heals 2 wound points (kit) or 4 wound points (trauma pack or better). Critical Failure: the check is voided and the patient instead suffers 1 additional wound point.
- **Medical Science (Surgery)**:
    - An extended/complex skill check, not a single roll — complexity scales with the severity of mortal damage being treated (roughly Marginal to Amazing complexity for 1 to 4+ mortal points).
    - A new check is made **every hour during the ongoing procedure**, accumulating successes rather than resolving in one roll (this is not "usable once per hour per patient" — it's one multi-hour procedure per patient). Every 2 accumulated successes heals 1 mortal point and 2 wound points.
    - Surgery cannot be performed during combat.
    - Critical Failure (or 3 accumulated Failures) wipes all accumulated successes, forcing the procedure to restart, **and** the patient suffers 1 additional point of mortal damage.

## Special Mechanics

### Skill Challenges (Accumulating Successes)
For complex tasks requiring multiple steps:
- **Ordinary Success**: 1 success.
- **Good Success**: 2 successes.
- **Amazing Success**: 3 successes.

### Environmental Hazards (Heat)
Source: Gamemaster Guide "Endurance Challenge" rules (Environments chapter, ~p.55-60) — not yet in code, needs verification against the scan for exact per-tier figures.
- Make a **Stamina-endurance** check on a schedule that depends on the specific heat tier (H0-H5) — it is **not** a flat "every hour," and cumulative +1 step penalties often apply at higher tiers.
- Stun damage by degree of success: **Amazing** none, **Good** 1, **Ordinary** 2, **Failure** 3, **Critical Failure** 4 (a 5-tier scale, not the old 2-tier Failure/Critical Failure split).
- **E-suit**: Protection depends on suit hardness and heat tier — soft e-suits reduce check *frequency* rather than granting immunity; hard e-suits grant full immunity at most tiers but can still fail at the most extreme tier (Inferno). It is **not** simply "protects until wound/mortal damage."

### Dodge Defense
A successful **Acrobatics-dodge** check adjusts the character's Strength- or Dexterity-based resistance modifier against the next attack, by degree: **Critical Failure** -2 steps, **Failure** none, **Ordinary** +1 step, **Good** +2 steps, **Amazing** +3 steps.
