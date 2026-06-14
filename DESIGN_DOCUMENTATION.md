# Alternity Fastplay Core Module Design Document

**Date:** 2026-05-11
**Status:** Phase 3 Complete - Ready for Phase 4 Testing
**Goal:** To create a fully functional, highly modular game system module for Foundry VTT v14 based on the Alternity Fastplay core ruleset.

## I. Guiding Principles & Philosophy
The module must adhere to three primary principles:
1. **Separation of Concerns:** Game logic (the "rules") is contained in services and hooks; presentation (the "UI") is handled by client-side components, ensuring clean separation between *what* happens and *how* it looks.
2. **Data Persistence First:** All custom game structures must be defined and stored robustly within the Foundry Document layer (`Actor`, `Item`) before any UI rendering occurs.
3. **Non-Intrusiveness:** Core mechanics integration must use established Foundry hooks to **augment** existing functionality, avoiding direct replacement of core system behaviors.

## II. Data Structure Design (The Persistence Layer)
We extend native Foundry documents using custom classes and specialized fields to ensure all rules are saved reliably.

### A. Character Sheet State (`src/data/alternity-actor-data.js`)
This wrapper class extends the native `Actor` document to hold dynamic, complex state not covered by standard attributes.
*   **`AlternityCharacterState`**: Manages core abilities, special rules, and skills.
    *   **Abilities (`abilitySets`)**: Stores core abilities (e.g., Stance, Passive Trait, Action). Must track `name`, `type`, `isActive`, a detailed `triggerCondition` JSON object, and an `effectPayload` (including modifiers). Includes methods to `addAbility`, `removeAbility`, `toggleAbility`, and `getActiveModifiers(context)`.
    *   **Special Rules (`specialRules`)**: Enables modularity for rules like "Momentum Generation." Allows toggling (`isEnabled: boolean`) to activate or deactivate entire rule systems.
    *   **Skills (`skills`)**: Stores skill definitions with `name`, `ability`, `rank`, `isBroad`, and `canBeUntrained`. Includes `calculateSkillScores` for deriving Ordinary, Good, and Amazing results, and `addSkill`/`removeSkill` for dynamic management.

### B. Custom Game Elements (The Item Template - `src/data/alternity-item-template.js`)
A specialized `Item` document type (`System_Effect`) is used as a reusable template for all special effects, ensuring they are treated as templates rather than single uses.
*   **Key Attributes:** `effectType` (Damage, Buff, Modifier), `targetScope`, and an array of `requiredChecks`.

### C. Core Logic Service (`src/services/alternity-math.js`)
All calculations must pass through this centralized service to enforce consistency and auditability.
*   **Functionality**:
    *   `resolveAbilityCheck(baseDC, modifierSources, context)`: Calculates check results based on step dice. Returns `totalStep`, `modifiers`, `stepDie`, and `formula`.
    *   `resolveStepDie(step)`: Maps step modifiers to Foundry-compatible dice formulas (e.g., `1d20 + 1d6`).
    *   `calculateDegreeOfSuccess(total, scores)`: Determines success level (Critical Failure, Failure, Ordinary, Good, Amazing) based on roll total and skill scores.
    *   `calculateMitigatedDamage(rawDamage, targetState)`: Calculates final damage after applying resistance/armor.
    *   `createRollFormula(totalStep)`: Generates Foundry-compatible roll strings.

## III. Core Mechanics & Integration Hooks
The module uses Foundry's event system as its "glue" to inject custom logic without breaking core functionality.

| Mechanic               | Hook Used          | Functionality Implemented                                                                                                                                                                                                                                        |
| :--------------------- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Saving Throws/Checks** | `preUpdateActor`   | Intercepts actor updates to manage state changes. `createAbilityCheck` hook (if manually triggered) would utilize `AlternityMathService` and `AlternityCharacterState.getActiveModifiers`. (Note: `createAbilityCheck` is a custom hook, not standard Foundry). |
| **Combat Damage**      | `preUpdateActor`   | Intercepts damage application to actor's durability tracks. `processDamageMitigation` uses `AlternityCharacterState` and `AlternityMathService` to adjust damage based on resistances and armor before the update is applied.                                   |
| **Skill/Ability Rolls**| Sheet Interactions | Directly triggered via UI clicks, utilizing `AlternityMathService` and `AlternityCharacterState` to generate rolls and degrees of success sent to chat.                                                                                                                  |

## IV. User Interface/Sheet Design (`src/client/alternity-sheet-module.js`)
The UI layer is designed for usability, hiding complex mechanics until necessary and providing immediate feedback. Updated to **ApplicationV2 framework**.
*   **`AlternityActorSheet` (extends `ActorSheetV2`)**:
    *   Manages sheet rendering, data preparation (`_prepareContext`), interactivity (`_onRender`), and data persistence (`_updateObject`).
    *   Handles interactive rolls for Abilities, Skills, and Weapons, sending results to chat.
    *   Features dynamic management of Skills (add, edit rank, delete) and Abilities/Stances (add, toggle active, delete).
    *   Calculates derived stats like Action Check and Durability Max automatically.
*   **`AlternityRollComponent`**: A custom Foundry Element for specialized dice rolling (though direct sheet integration is now primary).

## V. Development Workflow & Phasing
The development followed a phased approach:
1. **Phase 1: Data Modeling** - Implemented all necessary data classes and persistence hooks (`AlternityCharacterState`, etc.).
2. **Phase 2: Logic Engine** - Built the calculation service (`alternity-math.js`) and integrated it into dummy hook listeners, ensuring calculations work independent of the UI.
3. **Phase 3: User Interface** - Built custom sheet components that read from/write to the data layer and trigger the logic engine via hooks. Migrated to ApplicationV2 framework.
4. **Phase 4: Testing & Refinement** - Comprehensive testing (unit, integration, playtesting) and documentation.

## VI. Comprehensive Testing Plan
Testing covers ideal flow, catastrophic failure states, and edge cases.
*   **Unit Tests (`tests/test-alternity.test.js`)**: Validate `AlternityMathService` (modifiers, steps, degrees of success, damage mitigation) and `AlternityCharacterState` (serialization, modifier gathering). Includes stress tests for extreme values and malformed data.
*   **Integration Tests (Hooks)**: Verify that `preUpdateActor` and `renderToken` hooks correctly intercept and process game events.
*   **End-to-End Playtesting**: Mandatory testing of core loops: basic combat, complex ability use, skill checks, and failure state handling.

This document reflects the current state of the module after completing Phases 1-3 and initial Phase 4 audits.