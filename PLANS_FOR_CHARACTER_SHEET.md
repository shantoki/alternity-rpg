# Alternity Fastplay Character Sheet Roadmap

This document outlines the missing features and planned improvements for the Alternity Fastplay character sheet, based on the `Alternity_-_Fastplay_-_Core_-_Player_Rules.pdf`.

## Phase 1: Missing Derived Stats & Data Model Alignment
These are core mechanics that should be automated in the data layer and displayed on the sheet.

- [x] **Resistance Modifiers**: Implement calculation for STR, DEX, INT, and WIL.
    - 1-10: 0
    - 11-12: +1
    - 13-14: +2
- [x] **Untrained Scores**: Display `Ability / 2` (rounded down) next to each Ability score.
- [x] **Action Check Profession Bonus**: Automate the Marginal Action Check score.
    - Formula: `(DEX + INT) / 2 + Profession Bonus`
    - Bonuses: Combat Spec (+4), Free Agent (+3), Diplomat (+2), Tech Op (+2).
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
- [ ] **Skill specialty highlighting**: Ensure specialty skills are visually distinct (italics as per PDF).
- [ ] **Quick Action Buttons**: Add buttons for common actions (Recovery, First Aid check).

## Current Status
- [x] Basic Ability/Skill management.
- [x] Action Check & Durability tracking.
- [x] Weapon rolling with damage.
- [x] Wound penalties (Dazed effect) logic.
- [x] Serialization/Deserialization.
