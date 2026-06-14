# Alternity Fastplay Core Mechanics (PDF Accurate)

## Core Mechanic: The Action Check
Every action is resolved by rolling two types of dice against a **Score**:
- **Control Die**: Always a **d20**.
- **Situation Die**: Varies based on difficulty (Steps).
- **Goal**: Roll **equal to or less than** your Score.
- **Critical Failure**: A natural **20** on the d20 is always a failure, regardless of the Situation Die result.

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

## Recovery & Healing
- **Natural Healing**: 2 wound points per week of rest.
- **End of Scene**: All remaining stun damage disappears at the end of a scene.
- **First Aid (Knowledge)**: 
    - Negate stun: 2/3/4 (O/G/A).
    - Revive: 1/2/3 stun (O/G/A).
    - Heal wound: 1 point (any success).
- **Medical Science (Treatment)**:
    - Negate stun: 2/3/4 (O/G/A).
    - Revive: 2/3/4 stun (O/G/A).
    - Heal wound: 2 points (any success).
- **Medical Science (Surgery)**:
    - Heal 1 mortal and 2 wound points (any success).
    - Can be used once every hour per patient.
    - Critical Failure: Patient suffers 1 additional mortal damage.

## Special Mechanics

### Skill Challenges (Accumulating Successes)
For complex tasks requiring multiple steps:
- **Ordinary Success**: 1 success.
- **Good Success**: 2 successes.
- **Amazing Success**: 3 successes.

### Environmental Hazards (Heat)
- **High Heat**: Every hour, make a **Stamina-endurance** check.
- **Failure**: 1 stun damage.
- **Critical Failure**: 2 stun damage.
- **E-suit**: Protects from heat effects until the wearer suffers wound or mortal damage.

### Dodge Defense
A successful **Acrobatics-dodge** check increases the character's resistance modifier (+1/+2/+3 based on degree) against the next attack.
